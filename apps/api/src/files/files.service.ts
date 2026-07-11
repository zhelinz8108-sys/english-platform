import { Inject, Injectable } from '@nestjs/common';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import { EventsService, type EventActor } from '../infrastructure/events.service.js';
import { IdempotencyService } from '../infrastructure/idempotency.service.js';

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
type FilePurpose = 'content_attachment' | 'submission_attachment' | 'profile_image' | 'bulk_import';
export function mayReserveFile(roles: readonly string[], purpose: FilePurpose) {
  if (roles.some((role) => ['owner', 'admin', 'content_editor'].includes(role))) return true;
  if (roles.includes('teacher'))
    return purpose === 'submission_attachment' || purpose === 'content_attachment';
  if (roles.includes('student'))
    return purpose === 'submission_attachment' || purpose === 'profile_image';
  return false;
}
export function mayCompleteFile(
  roles: readonly string[],
  ownerMembershipId: string,
  currentMembershipId: string,
) {
  return (
    ownerMembershipId === currentMembershipId ||
    roles.some((role) => ['owner', 'admin', 'content_editor'].includes(role))
  );
}

@Injectable()
export class FilesService {
  private readonly internalS3: S3Client;
  private readonly publicS3: S3Client;
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {
    const common = {
      region: config.values.S3_REGION,
      forcePathStyle: config.values.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.values.S3_ACCESS_KEY,
        secretAccessKey: config.values.S3_SECRET_KEY,
      },
    };
    this.internalS3 = new S3Client({ ...common, endpoint: config.values.S3_ENDPOINT });
    this.publicS3 = new S3Client({ ...common, endpoint: config.s3PublicEndpoint });
  }
  presign(
    r: ApiRequest,
    key: string | undefined,
    input: {
      purpose: 'content_attachment' | 'submission_attachment' | 'profile_image' | 'bulk_import';
      fileName: string;
      contentType: string;
      sizeBytes: number;
      sha256: string;
    },
  ) {
    const a = actorFrom(r);
    if (!mayReserveFile(requireTenant(r).roles, input.purpose))
      throw ProblemException.forbidden('file_purpose_forbidden', '当前角色不能预留该类型文件。');
    return this.idem.execute(context(a), 'file.presign', key, input, async (trx) => {
      const id = uuidv7(),
        safe = input.fileName.replace(/[^A-Za-z0-9._-]/g, '_'),
        storageKey = `tenants/${a.tenantId}/${id}/${safe}`,
        now = new Date();
      await sql`insert into file_objects(id,tenant_id,storage_key,category,media_type,size_bytes,sha256,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${a.tenantId}::uuid,${storageKey},${input.purpose},${input.contentType},${input.sizeBytes},${input.sha256},'pending',${a.membershipId}::uuid,${now},${now})`.execute(
        trx,
      );
      const command = new PutObjectCommand({
        Bucket: this.config.values.S3_BUCKET,
        Key: storageKey,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
        Metadata: { sha256: input.sha256, 'tenant-id': a.tenantId, 'file-id': id },
      });
      const uploadUrl = await getSignedUrl(this.publicS3, command, { expiresIn: 900 });
      await this.events.append(trx, a, {
        action: 'file.reserve',
        resourceType: 'file_object',
        resourceId: id,
        eventType: 'file.upload_reserved.v1',
        payload: { category: input.purpose, sizeBytes: input.sizeBytes },
      });
      return {
        status: 201,
        body: {
          fileId: id,
          method: 'PUT',
          uploadUrl,
          requiredHeaders: { 'content-type': input.contentType },
          expiresAt: new Date(Date.now() + 900000).toISOString(),
        },
      };
    });
  }
  complete(
    r: ApiRequest,
    fileId: string,
    key: string | undefined,
    input: { sizeBytes: number; sha256: string; storageEtag: string },
  ) {
    const a = actorFrom(r),
      roles = requireTenant(r).roles;
    return this.idem.execute(
      context(a),
      'file.complete',
      key,
      { fileId, ...input },
      async (trx) => {
        const q =
          await sql<any>`select * from file_objects where id=${fileId}::uuid for update`.execute(
            trx,
          );
        const f = q.rows[0];
        if (!f || !mayCompleteFile(roles, f.created_by_membership_id, a.membershipId))
          throw ProblemException.notFound();
        if (f.status === 'ready') return { status: 200, body: this.json(f) };
        if (Number(f.size_bytes) !== input.sizeBytes || f.sha256 !== input.sha256)
          throw ProblemException.conflict('file_metadata_mismatch', '完成信息与预留元数据不一致。');
        let head;
        try {
          head = await this.internalS3.send(
            new HeadObjectCommand({ Bucket: this.config.values.S3_BUCKET, Key: f.storage_key }),
          );
        } catch {
          throw ProblemException.conflict('object_not_uploaded', '对象存储中尚未找到上传文件。');
        }
        if (head.ContentLength !== input.sizeBytes || head.Metadata?.sha256 !== input.sha256) {
          await sql`update file_objects set status='quarantined',updated_at=now() where id=${fileId}::uuid`.execute(
            trx,
          );
          throw ProblemException.conflict(
            'object_integrity_mismatch',
            '对象长度或 SHA-256 不匹配，文件已隔离。',
          );
        }
        const etag = head.ETag?.replaceAll('"', '');
        if (etag && input.storageEtag.replaceAll('"', '') !== etag)
          throw ProblemException.conflict('object_etag_mismatch', '对象 ETag 不匹配。');
        const now = new Date();
        await sql`update file_objects set status='ready',updated_at=${now} where id=${fileId}::uuid`.execute(
          trx,
        );
        await this.events.append(trx, a, {
          action: 'file.complete',
          resourceType: 'file_object',
          resourceId: fileId,
          eventType: 'file.ready.v1',
          payload: { sha256: input.sha256 },
        });
        return { status: 200, body: this.json({ ...f, status: 'ready', updated_at: now }) };
      },
    );
  }
  private json(f: any) {
    return {
      id: f.id,
      tenantId: f.tenant_id,
      purpose: f.category,
      fileName: String(f.storage_key).split('/').at(-1),
      contentType: f.media_type,
      sizeBytes: Number(f.size_bytes),
      sha256: f.sha256,
      status: f.status,
      createdAt: new Date(f.created_at).toISOString(),
      readyAt: f.status === 'ready' ? new Date(f.updated_at).toISOString() : null,
    };
  }
}
