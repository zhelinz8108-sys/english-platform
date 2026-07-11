import { Inject, Injectable } from '@nestjs/common';
import { getQuestionVersionsForAuthoring, publishQuestionVersion } from '@english/database';
import { sql } from 'kysely';
import { hash as hashPassword } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';
import { canonicalJson, sha256 } from '../common/domain.js';
import { CursorService, cursorKey } from '../common/cursor.js';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { DatabaseService, type TenantTransaction } from '../infrastructure/database.service.js';
import { EventsService, type EventActor } from '../infrastructure/events.service.js';
import { IdempotencyService } from '../infrastructure/idempotency.service.js';

export type CatalogKind = 'content' | 'question' | 'task' | 'path';
export interface MembershipListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  role?: string | undefined;
  status?: string | undefined;
}
export interface CatalogListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  ownership?: 'platform' | 'tenant' | undefined;
  kind?: string | undefined;
  status?: string | undefined;
  track?: 'general' | 'toefl' | undefined;
}
export interface AuditListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  actorMembershipId?: string | undefined;
  action?: string | undefined;
  occurredAfter?: string | undefined;
}
const catalog = {
  content: { table: 'contents', versions: 'content_versions', fk: 'content_id' },
  question: { table: 'questions', versions: 'question_versions', fk: 'question_id' },
  task: { table: 'tasks', versions: 'task_versions', fk: 'task_id' },
  path: { table: 'learning_paths', versions: 'learning_path_versions', fk: 'learning_path_id' },
} as const;
function actorFrom(r: ApiRequest): EventActor {
  const p = requirePrincipal(r),
    t = requireTenant(r);
  return {
    tenantId: t.tenantId,
    userId: p.userId,
    membershipId: t.membershipId,
    requestId: r.requestId,
  };
}
function context(a: EventActor) {
  return { tenantId: a.tenantId, userId: a.userId, membershipId: a.membershipId };
}

export function roleProfilePlan(roles: readonly string[]) {
  return {
    student: roles.includes('student') ? ('active' as const) : ('inactive' as const),
    teacher: roles.includes('teacher') ? ('active' as const) : ('inactive' as const),
  };
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {}

  async memberships(r: ApiRequest, input: MembershipListQuery = {}) {
    const a = actorFrom(r),
      pageSize = this.cursors.pageSize(input.pageSize);
    const filters = { role: input.role ?? null, status: input.status ?? null };
    const cursorContext = { scope: `admin.memberships:${a.tenantId}:${a.membershipId}`, filters };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.stringAndUuid);
    return this.db.withTenant(context(a), async (trx) => {
      const q = await sql<any>`
    select tm.id,tm.tenant_id,tm.user_id,u.email_normalized::text email,u.display_name,
      tm.status,tm.joined_at,tm.suspended_at,tm.left_at,
      coalesce(array_agg(mr.code order by mr.code) filter(where mr.code is not null),'{}') roles
    from tenant_memberships tm join users u on u.id=tm.user_id
    left join membership_role_assignments mra on mra.tenant_id=tm.tenant_id and mra.membership_id=tm.id
    left join membership_roles mr on mr.tenant_id=mra.tenant_id and mr.id=mra.role_id
    where (${input.status ?? null}::membership_status is null or tm.status=${input.status ?? null}::membership_status)
      and (${input.role ?? null}::text is null or exists(
        select 1 from membership_role_assignments filter_assignment
        join membership_roles filter_role on filter_role.tenant_id=filter_assignment.tenant_id
          and filter_role.id=filter_assignment.role_id
        where filter_assignment.tenant_id=tm.tenant_id and filter_assignment.membership_id=tm.id
          and filter_role.code=${input.role ?? null}
      ))
      and (${after?.[0] ?? null}::text is null
        or (u.display_name,tm.id)>(${after?.[0] ?? null},${after?.[1] ?? null}::uuid))
    group by tm.id,u.id order by u.display_name,tm.id limit ${pageSize + 1}
   `.execute(trx);
      const page = this.cursors.page(q.rows, pageSize, cursorContext, (row: any) => [
        row.display_name,
        row.id,
      ]);
      return { data: page.items.map(this.membershipJson), page: page.page };
    });
  }
  createMembership(
    r: ApiRequest,
    key: string | undefined,
    input: {
      userId?: string | undefined;
      email?: string | undefined;
      roles: string[];
      displayName?: string | null | undefined;
    },
  ) {
    const a = actorFrom(r);
    return this.idem.execute(context(a), 'admin.membership.create', key, input, async (trx) => {
      let userId = input.userId;
      if (!userId && input.email) {
        const found = await sql<{
          id: string;
        }>`select id from users where email_normalized=${input.email.toLowerCase()}::citext`.execute(
          trx,
        );
        userId = found.rows[0]?.id;
        if (!userId) {
          userId = uuidv7();
          await sql`insert into users(id,email_normalized,password_hash,display_name,status,platform_role,created_at,updated_at) values(${userId}::uuid,${input.email.toLowerCase()}::citext,${await hashPassword(uuidv7())},${input.displayName ?? input.email},'locked','none',now(),now())`.execute(
            trx,
          );
        }
      }
      if (!userId)
        throw ProblemException.badRequest('user_identifier_required', 'userId 或 email 必填。');
      const id = uuidv7();
      await sql`insert into tenant_memberships(id,tenant_id,user_id,status,invited_by_membership_id,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${userId}::uuid,'invited',${a.membershipId}::uuid,now(),now())`.execute(
        trx,
      );
      await this.replaceRoles(trx, a, id, input.roles);
      await this.syncRoleProfiles(trx, a, id, input.roles);
      await this.events.append(trx, a, {
        action: 'membership.create',
        resourceType: 'tenant_membership',
        resourceId: id,
        eventType: 'membership.created.v1',
        payload: { roles: input.roles },
      });
      return {
        status: 201,
        body: {
          id,
          tenantId: a.tenantId,
          userId,
          email: input.email ?? '',
          displayName: input.displayName ?? input.email ?? '',
          status: 'invited',
          roles: input.roles,
          joinedAt: null,
          suspendedAt: null,
          leftAt: null,
        },
      };
    });
  }
  async updateMembership(
    r: ApiRequest,
    id: string,
    input: { status?: string | undefined; roles?: string[] | undefined },
  ) {
    const a = actorFrom(r);
    return this.db.withTenant(context(a), async (trx) => {
      if (input.status)
        await sql`update tenant_memberships set status=${input.status},joined_at=case when ${input.status}='active' then coalesce(joined_at,now()) else joined_at end,suspended_at=case when ${input.status}='suspended' then now() else null end,left_at=case when ${input.status}='left' then now() else null end,updated_at=now() where id=${id}::uuid`.execute(
          trx,
        );
      if (input.roles) {
        await this.replaceRoles(trx, a, id, input.roles);
        await this.syncRoleProfiles(trx, a, id, input.roles);
      }
      await this.events.append(trx, a, {
        action: 'membership.update',
        resourceType: 'tenant_membership',
        resourceId: id,
        eventType: 'membership.updated.v1',
        payload: input,
      });
      const q =
        await sql<any>`select tm.id,tm.tenant_id,tm.user_id,u.email_normalized::text email,u.display_name,tm.status,tm.joined_at,tm.suspended_at,tm.left_at,coalesce(array_agg(mr.code order by mr.code) filter(where mr.code is not null),'{}') roles from tenant_memberships tm join users u on u.id=tm.user_id left join membership_role_assignments mra on mra.tenant_id=tm.tenant_id and mra.membership_id=tm.id left join membership_roles mr on mr.tenant_id=mra.tenant_id and mr.id=mra.role_id where tm.id=${id}::uuid group by tm.id,u.id`.execute(
          trx,
        );
      if (!q.rows[0]) throw ProblemException.notFound();
      return this.membershipJson(q.rows[0]);
    });
  }

  async listCatalog(r: ApiRequest, kind: CatalogKind, input: CatalogListQuery = {}) {
    const a = actorFrom(r),
      m = catalog[kind],
      pageSize = this.cursors.pageSize(input.pageSize);
    const filters = {
      ownership: input.ownership ?? null,
      kind: input.kind ?? null,
      status: input.status ?? null,
      track: input.track ?? null,
    };
    const cursorContext = {
      scope: `admin.catalog.${kind}:${a.tenantId}:${a.membershipId}`,
      filters,
    };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.dateAndUuid);
    const afterDate = after ? new Date(after[0]) : null;
    const kindFilter =
      (kind === 'content' || kind === 'question') && input.kind
        ? sql`and e.kind::text=${input.kind}`
        : sql``;
    const platformKindFilter =
      (kind === 'content' || kind === 'question') && input.kind
        ? sql`and p.kind::text=${input.kind}`
        : sql``;
    const statusFilter = input.status ? sql`and e.status::text=${input.status}` : sql``;
    const platformStatusFilter = input.status ? sql`and p.status::text=${input.status}` : sql``;
    const trackFilter =
      kind === 'path' && input.track ? sql`and e.track::text=${input.track}` : sql``;
    const platformTrackFilter =
      kind === 'path' && input.track ? sql`and p.track::text=${input.track}` : sql``;
    return this.db.withTenant(context(a), async (trx) => {
      const rows: any[] = [];
      if (input.ownership !== 'platform') {
        const title = kind === 'question' ? sql<string>`null::text` : sql<string>`v.title`;
        const tenant = await sql<any>`select e.*,${title} display_title
      from ${sql.raw(m.table)} e
      left join ${sql.raw(m.versions)} v on v.tenant_id=e.tenant_id and v.id=e.current_published_version_id
      where (${afterDate}::timestamptz is null or (date_trunc('milliseconds',e.created_at),e.id)<(${afterDate},${after?.[1] ?? null}::uuid))
      ${kindFilter} ${statusFilter} ${trackFilter}
      order by date_trunc('milliseconds',e.created_at) desc,e.id desc limit ${pageSize + 1}`.execute(
          trx,
        );
        rows.push(...tenant.rows);
      }
      if (input.ownership !== 'tenant') {
        const views = {
          content: 'platform.published_contents',
          question: 'platform.published_questions',
          task: 'platform.published_tasks',
          path: 'platform.published_learning_paths',
        } as const;
        const title = kind === 'question' ? sql<string>`null::text` : sql<string>`p.title`;
        const platform = await sql<any>`select p.*,null::uuid as tenant_id,${title} display_title
      from ${sql.raw(views[kind])} p
      where (${afterDate}::timestamptz is null or (date_trunc('milliseconds',p.created_at),p.id)<(${afterDate},${after?.[1] ?? null}::uuid))
      ${platformKindFilter} ${platformStatusFilter} ${platformTrackFilter}
      order by date_trunc('milliseconds',p.created_at) desc,p.id desc limit ${pageSize + 1}`.execute(
          trx,
        );
        rows.push(...platform.rows);
      }
      rows.sort((left, right) => {
        const time = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        return time || String(right.id).localeCompare(String(left.id));
      });
      const page = this.cursors.page(rows, pageSize, cursorContext, (row: any) => [
        new Date(row.created_at).toISOString(),
        row.id,
      ]);
      return { data: page.items.map((x: any) => this.entityJson(kind, x)), page: page.page };
    });
  }
  createEntity(r: ApiRequest, kind: CatalogKind, key: string | undefined, input: any) {
    const a = actorFrom(r);
    return this.idem.execute(context(a), `admin.${kind}.create`, key, input, async (trx) => {
      if (input.cloneFromPlatformVersionId) return this.clonePlatform(trx, a, kind, input);
      const id = uuidv7(),
        now = new Date();
      if (kind === 'content')
        await sql`insert into contents(id,tenant_id,kind,slug,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${input.kind},${input.slug},'active',${a.membershipId}::uuid,${now},${now})`.execute(
          trx,
        );
      if (kind === 'question')
        await sql`insert into questions(id,tenant_id,kind,slug,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${input.kind},${input.slug},'active',${a.membershipId}::uuid,${now},${now})`.execute(
          trx,
        );
      if (kind === 'task')
        await sql`insert into tasks(id,tenant_id,slug,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${input.slug},'active',${a.membershipId}::uuid,${now},${now})`.execute(
          trx,
        );
      if (kind === 'path') {
        let examId: string | null = null;
        if (input.track === 'toefl') {
          const exam = await sql<{
            id: string;
          }>`select id from platform.published_exams where lower(code)='toefl' limit 1`.execute(
            trx,
          );
          examId = exam.rows[0]?.id ?? null;
          if (!examId)
            throw ProblemException.badRequest('exam_not_supported', 'TOEFL 考试目录尚未发布。');
        }
        await sql`insert into learning_paths(id,tenant_id,slug,track,exam_id,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${input.slug},${input.track},${examId}::uuid,'active',${a.membershipId}::uuid,${now},${now})`.execute(
          trx,
        );
      }
      await this.events.append(trx, a, {
        action: `${kind}.create`,
        resourceType: kind,
        resourceId: id,
        eventType: `${kind}.created.v1`,
      });
      return {
        status: 201,
        body: this.entityJson(kind, {
          id,
          tenant_id: a.tenantId,
          slug: input.slug,
          kind: input.kind,
          track: input.track,
          status: 'active',
          current_published_version_id: null,
          display_title: null,
          created_at: now,
          updated_at: now,
        }),
      };
    });
  }
  async getCatalog(r: ApiRequest, kind: CatalogKind, id: string) {
    const a = actorFrom(r),
      m = catalog[kind];
    return this.db.withTenant(context(a), async (trx) => {
      const e = await sql<any>`select * from ${sql.raw(m.table)} where id=${id}::uuid`.execute(trx);
      if (e.rows[0]) {
        const versions =
          kind === 'question'
            ? await getQuestionVersionsForAuthoring(trx, id)
            : (
                await sql<any>`select * from ${sql.raw(m.versions)} where ${sql.raw(m.fk)}=${id}::uuid order by version_no desc`.execute(
                  trx,
                )
              ).rows;
        return {
          [kind === 'path' ? 'path' : kind]: this.entityJson(kind, e.rows[0]),
          versions: await Promise.all(versions.map((x: any) => this.hydrateVersion(trx, kind, x))),
        };
      }
      const views = {
        content: 'platform.published_contents',
        question: 'platform.published_questions',
        task: 'platform.published_tasks',
        path: 'platform.published_learning_paths',
      } as const;
      const title = kind === 'question' ? sql<string>`null::text` : sql<string>`p.title`;
      const platform =
        await sql<any>`select p.*,null::uuid tenant_id,${title} display_title from ${sql.raw(views[kind])} p where p.id=${id}::uuid`.execute(
          trx,
        );
      const official = platform.rows[0];
      if (!official) throw ProblemException.notFound();
      return {
        [kind === 'path' ? 'path' : kind]: this.entityJson(kind, official),
        versions: [await this.hydrateVersion(trx, kind, this.platformVersionRow(kind, official))],
      };
    });
  }
  createVersion(
    r: ApiRequest,
    kind: CatalogKind,
    entityId: string,
    key: string | undefined,
    input: any,
  ) {
    const a = actorFrom(r);
    return this.idem.execute(
      context(a),
      `admin.${kind}.version.create`,
      key,
      { entityId, ...input },
      async (trx) => {
        const id = uuidv7(),
          now = new Date();
        const n = await this.nextVersion(trx, kind, entityId);
        if (kind === 'content') {
          await this.assertContentAttachments(trx, input.attachmentFileIds ?? []);
          const questionPoints = await this.assertPublishedQuestionItems(trx, input.items ?? []);
          await sql`insert into content_versions(id,tenant_id,content_id,version_no,publication_state,title,locale,body,metadata,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${entityId}::uuid,${n},'draft',${input.title},${input.locale},${JSON.stringify(input.body)}::jsonb,${JSON.stringify(input.metadata)}::jsonb,${now},${now})`.execute(
            trx,
          );
          for (const item of input.items ?? [])
            await sql`insert into content_version_items(id,tenant_id,content_version_id,question_version_id,section_key,position,points,settings,created_at) values(${uuidv7()}::uuid,${a.tenantId}::uuid,${id}::uuid,${item.questionVersionId}::uuid,${item.sectionKey ?? null},${item.position},${item.points ?? questionPoints.get(item.questionVersionId)},${JSON.stringify(item.settings ?? {})}::jsonb,${now})`.execute(
              trx,
            );
          for (const [position, fileId] of (input.attachmentFileIds ?? []).entries())
            await sql`insert into content_version_files(id,tenant_id,content_version_id,file_object_id,usage,position,created_at) values(${uuidv7()}::uuid,${a.tenantId}::uuid,${id}::uuid,${fileId}::uuid,'attachment',${position},${now})`.execute(
              trx,
            );
        }
        if (kind === 'question')
          await sql`insert into question_versions(id,tenant_id,question_id,version_no,publication_state,prompt,options,answer_key,scoring_rule,max_score,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${entityId}::uuid,${n},'draft',${JSON.stringify(input.prompt)}::jsonb,${JSON.stringify(input.options)}::jsonb,${JSON.stringify(input.answerKey)}::jsonb,${JSON.stringify(input.scoringRule)}::jsonb,${input.maxScore},${now},${now})`.execute(
            trx,
          );
        if (kind === 'task')
          await sql`insert into task_versions(id,tenant_id,task_id,version_no,publication_state,task_kind,title,instructions,content_version_id,completion_rule,grading_policy,estimated_minutes,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${entityId}::uuid,${n},'draft',${input.kind},${input.title},${JSON.stringify(input.instructions)}::jsonb,${input.contentVersionId}::uuid,${JSON.stringify(input.completionRule)}::jsonb,${JSON.stringify(input.gradingPolicy)}::jsonb,${input.estimatedMinutes},${now},${now})`.execute(
            trx,
          );
        if (kind === 'path') {
          await sql`insert into learning_path_versions(id,tenant_id,learning_path_id,version_no,publication_state,title,description,completion_rule,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${entityId}::uuid,${n},'draft',${input.title},${input.description},${JSON.stringify(input.completionRule)}::jsonb,${now},${now})`.execute(
            trx,
          );
          const nodes = new Map<string, string>();
          for (const node of input.nodes) {
            const nid = uuidv7();
            nodes.set(node.nodeKey, nid);
            await sql`insert into path_nodes(id,tenant_id,learning_path_version_id,node_key,task_version_id,position,slot_key_template,available_offset_days,due_offset_days,close_offset_days,is_required,unlock_rule,created_at) values(${nid}::uuid,${a.tenantId}::uuid,${id}::uuid,${node.nodeKey},${node.taskVersionId}::uuid,${node.position},${node.slotKeyTemplate},${node.availableOffsetDays},${node.dueOffsetDays},${node.closeOffsetDays},${node.isRequired},${JSON.stringify(node.unlockRule)}::jsonb,${now})`.execute(
              trx,
            );
          }
          for (const p of input.prerequisites) {
            const node = nodes.get(p.nodeKey),
              pre = nodes.get(p.prerequisiteNodeKey);
            if (!node || !pre)
              throw ProblemException.badRequest(
                'path_prerequisite_invalid',
                '前置节点 key 不存在。',
              );
            await sql`insert into path_prerequisites(id,tenant_id,learning_path_version_id,path_node_id,prerequisite_node_id,condition,threshold,created_at) values(${uuidv7()}::uuid,${a.tenantId}::uuid,${id}::uuid,${node}::uuid,${pre}::uuid,${p.condition},${p.threshold},${now})`.execute(
              trx,
            );
          }
        }
        await this.events.append(trx, a, {
          action: `${kind}.version.create`,
          resourceType: `${kind}_version`,
          resourceId: id,
          eventType: `${kind}.version_created.v1`,
        });
        const version =
          kind === 'question'
            ? (await getQuestionVersionsForAuthoring(trx, entityId)).find((row) => row.id === id)
            : (
                await sql<any>`select * from ${sql.raw(catalog[kind].versions)} where id=${id}::uuid`.execute(
                  trx,
                )
              ).rows[0];
        if (!version) throw ProblemException.notFound();
        return { status: 201, body: await this.hydrateVersion(trx, kind, version) };
      },
    );
  }
  publish(r: ApiRequest, kind: CatalogKind, versionId: string, key: string | undefined) {
    const a = actorFrom(r),
      m = catalog[kind];
    return this.idem.execute(
      context(a),
      `admin.${kind}.version.publish`,
      key,
      { versionId },
      async (trx) => {
        if (kind === 'question') {
          const current = await sql<{
            question_id: string;
            publication_state: string;
          }>`select question_id,publication_state from question_versions where id=${versionId}::uuid for update`.execute(
            trx,
          );
          const before = current.rows[0];
          if (!before) throw ProblemException.notFound();
          if (before.publication_state !== 'draft')
            throw ProblemException.conflict('version_not_publishable', '版本不是 draft。');
          const publication = await publishQuestionVersion(trx, versionId);
          const version = (await getQuestionVersionsForAuthoring(trx, publication.questionId)).find(
            (row) => row.id === versionId,
          );
          if (!version) throw ProblemException.notFound();
          await this.events.append(trx, a, {
            action: 'question.publish',
            resourceType: 'question_version',
            resourceId: versionId,
            eventType: 'question.published.v1',
            payload: { contentHash: publication.contentHash },
          });
          return { status: 200, body: await this.hydrateVersion(trx, kind, version) };
        }
        const q =
          await sql<any>`select * from ${sql.raw(m.versions)} where id=${versionId}::uuid for update`.execute(
            trx,
          );
        const v = q.rows[0];
        if (!v) throw ProblemException.notFound();
        if (v.publication_state !== 'draft')
          throw ProblemException.conflict('version_not_publishable', '版本不是 draft。');
        if (kind === 'path') await this.assertAcyclic(trx, versionId);
        const digest = sha256(
            canonicalJson(
              kind === 'content'
                ? {
                    version: v,
                    items: (
                      await sql<any>`select question_version_id,section_key,position,points::float8 points,settings from content_version_items where content_version_id=${versionId}::uuid order by position,id`.execute(
                        trx,
                      )
                    ).rows,
                    attachmentFileIds: (
                      await sql<any>`select file_object_id from content_version_files where content_version_id=${versionId}::uuid order by position,id`.execute(
                        trx,
                      )
                    ).rows.map((file: any) => file.file_object_id),
                  }
                : v,
            ),
          ),
          now = new Date();
        await sql`update ${sql.raw(m.versions)} set publication_state='published',content_hash=${digest},published_at=${now},published_by_membership_id=${a.membershipId}::uuid,updated_at=${now} where id=${versionId}::uuid`.execute(
          trx,
        );
        await sql`update ${sql.raw(m.table)} set current_published_version_id=${versionId}::uuid,updated_at=${now} where id=${v[m.fk]}::uuid`.execute(
          trx,
        );
        await this.events.append(trx, a, {
          action: `${kind}.publish`,
          resourceType: `${kind}_version`,
          resourceId: versionId,
          eventType: `${kind}.published.v1`,
          payload: { contentHash: digest },
        });
        return {
          status: 200,
          body: await this.hydrateVersion(trx, kind, {
            ...v,
            publication_state: 'published',
            content_hash: digest,
            published_at: now,
            published_by_membership_id: a.membershipId,
            updated_at: now,
          }),
        };
      },
    );
  }
  async audit(r: ApiRequest, input: AuditListQuery = {}) {
    const a = actorFrom(r),
      pageSize = this.cursors.pageSize(input.pageSize);
    const filters = {
      actorMembershipId: input.actorMembershipId ?? null,
      action: input.action ?? null,
      occurredAfter: input.occurredAfter ?? null,
    };
    const cursorContext = { scope: `admin.audit:${a.tenantId}:${a.membershipId}`, filters };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.dateAndUuid);
    const occurredAfter = input.occurredAfter ? new Date(input.occurredAfter) : null;
    return this.db.withTenant(context(a), async (trx) => {
      const q = await sql<any>`select * from audit_logs
    where (${input.actorMembershipId ?? null}::uuid is null or actor_membership_id=${input.actorMembershipId ?? null}::uuid)
      and (${input.action ?? null}::text is null or action=${input.action ?? null})
      and (${occurredAfter}::timestamptz is null or created_at>${occurredAfter})
      and (${after?.[0] ? new Date(after[0]) : null}::timestamptz is null
        or (date_trunc('milliseconds',created_at),id)<(${after?.[0] ? new Date(after[0]) : null},${after?.[1] ?? null}::uuid))
    order by date_trunc('milliseconds',created_at) desc,id desc limit ${pageSize + 1}`.execute(trx);
      const page = this.cursors.page(q.rows, pageSize, cursorContext, (row: any) => [
        new Date(row.created_at).toISOString(),
        row.id,
      ]);
      return {
        data: page.items.map((x: any) => ({
          id: x.id,
          tenantId: x.tenant_id,
          actorType: x.actor_type,
          actorUserId: x.actor_user_id,
          actorMembershipId: x.actor_membership_id,
          action: x.action,
          resourceType: x.resource_type,
          resourceId: x.resource_id,
          occurredAt: new Date(x.created_at).toISOString(),
          requestId: x.request_id,
          metadata: x.details,
        })),
        page: page.page,
      };
    });
  }

  private membershipJson = (x: any) => ({
    id: x.id,
    tenantId: x.tenant_id,
    userId: x.user_id,
    email: x.email,
    displayName: x.display_name,
    status: x.status,
    roles: x.roles,
    joinedAt: x.joined_at ? new Date(x.joined_at).toISOString() : null,
    suspendedAt: x.suspended_at ? new Date(x.suspended_at).toISOString() : null,
    leftAt: x.left_at ? new Date(x.left_at).toISOString() : null,
  });
  private async assertContentAttachments(trx: TenantTransaction, fileIds: string[]) {
    if (fileIds.length === 0) return;
    const unique = [...new Set(fileIds)];
    if (unique.length !== fileIds.length)
      throw ProblemException.badRequest('duplicate_attachment', 'attachmentFileIds 不能重复。');
    const files = await sql<{
      id: string;
      status: string;
      category: string;
      media_type: string;
    }>`select id,status,category,media_type from file_objects where id=any(${unique}::uuid[])`.execute(
      trx,
    );
    if (files.rows.length !== unique.length) throw ProblemException.notFound();
    const invalid = files.rows.find(
      (file) =>
        file.status !== 'ready' ||
        file.category !== 'content_attachment' ||
        !['application/pdf', 'image/jpeg', 'image/png'].includes(file.media_type),
    );
    if (invalid)
      throw ProblemException.conflict(
        'content_attachment_not_ready',
        '内容附件必须已完成上传，且为 PDF/JPEG/PNG 内容附件。',
      );
  }
  private async assertPublishedQuestionItems(
    trx: TenantTransaction,
    items: Array<{ questionVersionId: string; points?: number | undefined }>,
  ) {
    const ids = items.map((item) => item.questionVersionId);
    const points = new Map<string, number>();
    if (ids.length === 0) return points;
    const versions = await sql<{
      id: string;
      max_score: number;
    }>`select id,max_score::float8 max_score from question_versions where id=any(${ids}::uuid[]) and publication_state='published'`.execute(
      trx,
    );
    for (const version of versions.rows) points.set(version.id, Number(version.max_score));
    if (points.size !== ids.length)
      throw ProblemException.conflict(
        'content_question_unavailable',
        '内容项引用的题目版本不存在或尚未发布。',
      );
    return points;
  }
  private async syncRoleProfiles(
    trx: TenantTransaction,
    a: EventActor,
    id: string,
    roles: string[],
  ) {
    const plan = roleProfilePlan(roles);
    if (plan.student === 'active')
      await sql`insert into student_profiles(id,tenant_id,membership_id,status,created_at,updated_at) values(${uuidv7()}::uuid,${a.tenantId}::uuid,${id}::uuid,'active',now(),now()) on conflict(tenant_id,membership_id) do update set status='active',updated_at=now()`.execute(
        trx,
      );
    else
      await sql`update student_profiles set status='inactive',updated_at=now() where membership_id=${id}::uuid and status<>'inactive'`.execute(
        trx,
      );
    if (plan.teacher === 'active')
      await sql`insert into teacher_profiles(id,tenant_id,membership_id,status,created_at,updated_at) values(${uuidv7()}::uuid,${a.tenantId}::uuid,${id}::uuid,'active',now(),now()) on conflict(tenant_id,membership_id) do update set status='active',updated_at=now()`.execute(
        trx,
      );
    else
      await sql`update teacher_profiles set status='inactive',updated_at=now() where membership_id=${id}::uuid and status<>'inactive'`.execute(
        trx,
      );
  }
  private async replaceRoles(trx: TenantTransaction, a: EventActor, id: string, roles: string[]) {
    await sql`delete from membership_role_assignments where membership_id=${id}::uuid`.execute(trx);
    for (const code of roles) {
      const role = await sql<{
        id: string;
      }>`select id from membership_roles where code=${code}`.execute(trx);
      if (!role.rows[0]) throw ProblemException.badRequest('role_invalid', `未知角色 ${code}`);
      await sql`insert into membership_role_assignments(id,tenant_id,membership_id,role_id,granted_by_membership_id,created_at) values(${uuidv7()}::uuid,${a.tenantId}::uuid,${id}::uuid,${role.rows[0].id}::uuid,${a.membershipId}::uuid,now())`.execute(
        trx,
      );
    }
  }
  private entityJson(k: CatalogKind, x: any) {
    return {
      id: x.id,
      tenantId: x.tenant_id ?? null,
      ownership: x.tenant_id ? 'tenant' : 'platform',
      ...(k === 'content' || k === 'question' ? { kind: x.kind } : {}),
      ...(k === 'task' ? { currentKind: x.task_kind ?? null } : {}),
      ...(k === 'path' ? { track: x.track } : {}),
      slug: x.slug,
      displayTitle: x.display_title ?? null,
      status: x.status,
      latestPublishedVersionId: x.current_published_version_id ?? null,
      createdAt: new Date(x.created_at).toISOString(),
      updatedAt: new Date(x.updated_at).toISOString(),
    };
  }
  private platformVersionRow(k: CatalogKind, x: any) {
    const base = {
      id: x.version_id,
      version_no: x.version_no,
      publication_state: 'published',
      content_hash: x.content_hash,
      created_at: x.published_at,
      published_at: x.published_at,
    };
    if (k === 'content')
      return {
        ...base,
        content_id: x.id,
        title: x.title,
        locale: x.locale,
        body: x.body,
        metadata: x.metadata,
      };
    if (k === 'question')
      return {
        ...base,
        question_id: x.id,
        prompt: x.prompt,
        options: x.options,
        answer_key: null,
        scoring_rule: x.scoring_rule,
        max_score: x.max_score,
      };
    if (k === 'task')
      return {
        ...base,
        task_id: x.id,
        title: x.title,
        instructions: x.instructions,
        task_kind: x.task_kind,
        content_version_id: x.content_version_id,
        completion_rule: x.completion_rule,
        grading_policy: x.grading_policy,
        estimated_minutes: x.estimated_minutes,
      };
    return {
      ...base,
      learning_path_id: x.id,
      title: x.title,
      description: x.description,
      completion_rule: x.completion_rule,
    };
  }
  private async hydrateVersion(trx: TenantTransaction, k: CatalogKind, x: any) {
    const base = this.versionJson(k, x);
    if (k === 'content') {
      const files = await sql<{
        file_object_id: string;
      }>`select file_object_id from content_version_files where content_version_id=${x.id}::uuid order by position,id`.execute(
        trx,
      );
      const items = await sql<{
        question_version_id: string;
        section_key: string | null;
        position: number;
        points: number;
        settings: Record<string, unknown>;
      }>`select question_version_id,section_key,position,points::float8 points,settings from content_version_items where content_version_id=${x.id}::uuid order by position,id`.execute(
        trx,
      );
      return {
        ...base,
        attachmentFileIds: files.rows.map((file) => file.file_object_id),
        items: items.rows.map((item) => ({
          questionVersionId: item.question_version_id,
          position: item.position,
          points: item.points,
          sectionKey: item.section_key,
          settings: item.settings,
        })),
      };
    }
    if (k === 'path') {
      const nodes =
        await sql<any>`select id,node_key,task_version_id,position,slot_key_template,available_offset_days,due_offset_days,close_offset_days,is_required,unlock_rule from path_nodes where learning_path_version_id=${x.id}::uuid order by position,id`.execute(
          trx,
        );
      const prerequisites =
        await sql<any>`select node.node_key,required.node_key prerequisite_node_key,link.condition,link.threshold::float8 threshold from path_prerequisites link join path_nodes node on node.tenant_id=link.tenant_id and node.id=link.path_node_id join path_nodes required on required.tenant_id=link.tenant_id and required.id=link.prerequisite_node_id where link.learning_path_version_id=${x.id}::uuid order by node.position,required.position,link.id`.execute(
          trx,
        );
      return {
        ...base,
        nodes: nodes.rows.map((node) => ({
          nodeKey: node.node_key,
          taskVersionId: node.task_version_id,
          position: node.position,
          slotKeyTemplate: node.slot_key_template,
          availableOffsetDays: node.available_offset_days,
          dueOffsetDays: node.due_offset_days,
          closeOffsetDays: node.close_offset_days,
          isRequired: node.is_required,
          unlockRule: node.unlock_rule,
        })),
        prerequisites: prerequisites.rows.map((link) => ({
          nodeKey: link.node_key,
          prerequisiteNodeKey: link.prerequisite_node_key,
          condition: link.condition,
          threshold: link.threshold,
        })),
      };
    }
    return base;
  }
  private versionJson(k: CatalogKind, x: any) {
    const base = {
      id: x.id,
      versionNumber: x.version_no,
      publicationState: x.publication_state,
      contentHash: x.content_hash ?? null,
      createdAt: new Date(x.created_at).toISOString(),
      publishedAt: x.published_at ? new Date(x.published_at).toISOString() : null,
    };
    if (k === 'content')
      return {
        ...base,
        contentId: x.content_id,
        title: x.title,
        locale: x.locale,
        body: x.body,
        metadata: x.metadata,
        attachmentFileIds: [],
        items: [],
      };
    if (k === 'question')
      return {
        ...base,
        questionId: x.question_id,
        prompt: x.prompt,
        options: x.options ?? [],
        answerKey: x.answer_key,
        scoringRule: x.scoring_rule,
        maxScore: Number(x.max_score),
      };
    if (k === 'task')
      return {
        ...base,
        taskId: x.task_id,
        title: x.title,
        instructions: x.instructions,
        kind: x.task_kind,
        contentVersionId: x.content_version_id,
        completionRule: x.completion_rule,
        gradingPolicy: x.grading_policy,
        estimatedMinutes: x.estimated_minutes,
      };
    return {
      ...base,
      pathId: x.learning_path_id,
      title: x.title,
      description: x.description,
      completionRule: x.completion_rule,
      nodes: [],
      prerequisites: [],
    };
  }
  private async nextVersion(trx: TenantTransaction, k: CatalogKind, id: string) {
    const m = catalog[k];
    const r = await sql<{
      n: number;
    }>`select coalesce(max(version_no),0)::int+1 n from ${sql.raw(m.versions)} where ${sql.raw(m.fk)}=${id}::uuid`.execute(
      trx,
    );
    return r.rows[0]!.n;
  }
  private async assertAcyclic(trx: TenantTransaction, id: string) {
    const r = await sql<{
      cycle: boolean;
    }>`with recursive walk(path_node_id,prerequisite_node_id,trail,cycle) as(select path_node_id,prerequisite_node_id,array[path_node_id],false from path_prerequisites where learning_path_version_id=${id}::uuid union all select w.path_node_id,p.prerequisite_node_id,w.trail||p.prerequisite_node_id,p.prerequisite_node_id=any(w.trail) from walk w join path_prerequisites p on p.path_node_id=w.prerequisite_node_id where not w.cycle) select coalesce(bool_or(cycle),false) cycle from walk`.execute(
      trx,
    );
    if (r.rows[0]?.cycle) throw ProblemException.conflict('path_cycle', '学习路径存在循环依赖。');
  }
  private async clonePlatform(trx: TenantTransaction, a: EventActor, k: CatalogKind, input: any) {
    if (k !== 'content')
      throw ProblemException.badRequest(
        'clone_dependency_graph_required',
        '该官方目录类型需通过完整依赖图导入。',
      );
    const src =
      await sql<any>`select kind,version_id as source_version_id,title,locale,body,metadata from platform.published_contents where version_id=${input.cloneFromPlatformVersionId}::uuid`.execute(
        trx,
      );
    const v = src.rows[0];
    if (!v) throw ProblemException.notFound();
    const id = uuidv7(),
      vid = uuidv7(),
      now = new Date();
    await sql`insert into contents(id,tenant_id,kind,slug,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${v.kind},${input.slug},'active',${a.membershipId}::uuid,${now},${now})`.execute(
      trx,
    );
    await sql`insert into content_versions(id,tenant_id,content_id,version_no,publication_state,title,locale,body,metadata,source_platform_content_version_id,created_at,updated_at) values(${vid}::uuid,${a.tenantId}::uuid,${id}::uuid,1,'draft',${v.title},${v.locale},${JSON.stringify(v.body)}::jsonb,${JSON.stringify(v.metadata)}::jsonb,${v.source_version_id}::uuid,${now},${now})`.execute(
      trx,
    );
    return {
      status: 201,
      body: this.entityJson(k, {
        id,
        tenant_id: a.tenantId,
        kind: v.kind,
        slug: input.slug,
        status: 'active',
        current_published_version_id: null,
        display_title: v.title,
        created_at: now,
        updated_at: now,
      }),
    };
  }
}
