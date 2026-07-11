import { Inject, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import type { PlatformRole, SessionUser, TenantRole } from '@english/shared';
import { jwtVerify, SignJWT } from 'jose';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { createOpaqueRefreshToken, parseOpaqueRefreshToken, sha256 } from '../common/domain.js';
import { CursorService, cursorKey } from '../common/cursor.js';
import type { AccessPrincipal } from '../common/request.js';
import { ProblemException } from '../common/problem.js';
import { AppConfig } from '../config.js';
import { DatabaseService } from '../infrastructure/database.service.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  platform_role: PlatformRole;
  status: 'active' | 'locked' | 'disabled';
  created_at: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  refresh_token_hash: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  reuse_detected_at: Date | null;
}

interface AccessClaims {
  sub: string;
  sid: string;
  pr: PlatformRole;
}

export interface IssuedSession {
  user: SessionUser & { createdAt: string };
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly accessSecret: Uint8Array;
  private readonly accessVerifications = new Map<string, Promise<AccessPrincipal>>();

  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {
    this.accessSecret = new TextEncoder().encode(config.values.JWT_ACCESS_SECRET);
  }

  async login(
    emailInput: string,
    password: string,
    ip: string,
    userAgent: string,
  ): Promise<IssuedSession> {
    const email = emailInput.trim().toLowerCase();
    const result = await sql<UserRow>`
      select id, email_normalized::text as email, password_hash, display_name,
             platform_role, status, created_at
      from users where email_normalized = ${email}::citext
    `.execute(this.database.db);
    const user = result.rows[0];
    if (!user || !(await verify(user.password_hash, password))) {
      throw ProblemException.unauthorized('invalid_credentials', '邮箱或密码错误。');
    }
    if (user.status !== 'active') {
      throw ProblemException.unauthorized('user_inactive', '账号已锁定或停用。');
    }

    return this.database.withGlobal(async (transaction) => {
      const now = new Date();
      const sessionId = uuidv7();
      const familyId = uuidv7();
      const refreshExpiresAt = new Date(
        now.getTime() + this.config.values.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
      );
      const refresh = createOpaqueRefreshToken(sessionId);
      await sql`
        insert into auth_sessions (
          id, user_id, family_id, refresh_token_hash, expires_at, ip_hash,
          user_agent_hash, created_at
        ) values (
          ${sessionId}::uuid, ${user.id}::uuid, ${familyId}::uuid, ${refresh.hash},
          ${refreshExpiresAt}, ${sha256(ip)}, ${sha256(userAgent)}, ${now}
        )
      `.execute(transaction);
      await sql`update users set last_login_at = ${now}, updated_at = ${now} where id = ${user.id}::uuid`.execute(
        transaction,
      );
      return this.issue(user, sessionId, refresh.token, refreshExpiresAt);
    });
  }

  async refresh(token: string | undefined, ip: string, userAgent: string): Promise<IssuedSession> {
    if (!token) throw ProblemException.unauthorized('refresh_missing', '缺少 Refresh Cookie。');
    const parsed = parseOpaqueRefreshToken(token);
    if (!parsed)
      throw ProblemException.unauthorized('refresh_invalid', 'Refresh Cookie 格式无效。');

    let reuseDetected = false;
    const issued = await this.database.withGlobal<IssuedSession | null>(async (transaction) => {
      const sessions = await sql<SessionRow>`
        select id, user_id, family_id, refresh_token_hash, expires_at,
               rotated_at, revoked_at, reuse_detected_at
        from auth_sessions where id = ${parsed.sessionId}::uuid for update
      `.execute(transaction);
      const current = sessions.rows[0];
      if (!current) throw ProblemException.unauthorized('refresh_invalid', 'Refresh Cookie 无效。');
      const reused = current.refresh_token_hash !== parsed.hash || current.rotated_at !== null;
      if (reused) {
        await sql`
          update auth_sessions set revoked_at = coalesce(revoked_at, now()), reuse_detected_at = now()
          where family_id = ${current.family_id}::uuid
        `.execute(transaction);
        reuseDetected = true;
        return null;
      }
      if (
        current.revoked_at ||
        current.reuse_detected_at ||
        current.expires_at.getTime() <= Date.now()
      ) {
        throw ProblemException.unauthorized('refresh_expired', 'Refresh Session 已过期或撤销。');
      }
      const users = await sql<UserRow>`
        select id, email_normalized::text as email, password_hash, display_name,
               platform_role, status, created_at
        from users where id = ${current.user_id}::uuid
      `.execute(transaction);
      const user = users.rows[0];
      if (!user || user.status !== 'active') throw ProblemException.unauthorized('user_inactive');

      const nextId = uuidv7();
      const next = createOpaqueRefreshToken(nextId);
      const now = new Date();
      await sql`update auth_sessions set rotated_at = ${now} where id = ${current.id}::uuid`.execute(
        transaction,
      );
      await sql`
        insert into auth_sessions (
          id, user_id, family_id, refresh_token_hash, expires_at, ip_hash,
          user_agent_hash, created_at
        ) values (
          ${nextId}::uuid, ${user.id}::uuid, ${current.family_id}::uuid, ${next.hash},
          ${current.expires_at}, ${sha256(ip)}, ${sha256(userAgent)}, ${now}
        )
      `.execute(transaction);
      return this.issue(user, nextId, next.token, current.expires_at);
    });
    if (reuseDetected || !issued) {
      throw ProblemException.unauthorized(
        'refresh_reuse_detected',
        '检测到 Refresh Token 复用，令牌族已撤销。',
      );
    }
    return issued;
  }

  async revokeFamily(sessionId: string, userId: string): Promise<void> {
    await this.database.withGlobal(async (transaction) => {
      const result = await sql<{ family_id: string }>`
        select family_id from auth_sessions where id = ${sessionId}::uuid and user_id = ${userId}::uuid
      `.execute(transaction);
      const familyId = result.rows[0]?.family_id;
      if (familyId) {
        await sql`update auth_sessions set revoked_at = coalesce(revoked_at, now()) where family_id = ${familyId}::uuid`.execute(
          transaction,
        );
      }
    });
  }

  async verifyAccess(token: string | undefined): Promise<AccessPrincipal> {
    if (!token) throw ProblemException.unauthorized();
    const key = sha256(token);
    const existing = this.accessVerifications.get(key);
    if (existing) return existing;
    const verification = this.verifyAccessUncached(token).finally(() => {
      if (this.accessVerifications.get(key) === verification) {
        this.accessVerifications.delete(key);
      }
    });
    this.accessVerifications.set(key, verification);
    return verification;
  }

  private async verifyAccessUncached(token: string): Promise<AccessPrincipal> {
    try {
      const verified = await jwtVerify(token, this.accessSecret, {
        issuer: 'english-platform-api',
        audience: 'english-platform-web',
      });
      const payload = verified.payload as unknown as AccessClaims;
      if (!payload.sub || !payload.sid || !['none', 'super_admin'].includes(payload.pr))
        throw new Error('claims');
      const sessions = await sql<{ active: boolean }>`
        select exists(
          select 1 from auth_sessions
          where id = ${payload.sid}::uuid and user_id = ${payload.sub}::uuid
            and revoked_at is null and reuse_detected_at is null and expires_at > now()
        ) as active
      `.execute(this.database.db);
      if (!sessions.rows[0]?.active) throw new Error('revoked');
      return { userId: payload.sub, sessionId: payload.sid, platformRole: payload.pr };
    } catch {
      throw ProblemException.unauthorized();
    }
  }

  async currentUser(userId: string): Promise<SessionUser & { createdAt: string }> {
    const result = await sql<Omit<UserRow, 'password_hash' | 'status'>>`
      select id, email_normalized::text as email, display_name, platform_role, created_at
      from users where id = ${userId}::uuid and status = 'active'
    `.execute(this.database.db);
    const row = result.rows[0];
    if (!row) throw ProblemException.unauthorized();
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      platformRole: row.platform_role,
      createdAt: row.created_at.toISOString(),
    };
  }

  async listTenants(
    userId: string,
    cursor?: string,
    rawPageSize?: string,
  ): Promise<{
    data: Array<{
      membershipId: string;
      tenant: { id: string; name: string; slug: string };
      roles: TenantRole[];
      status: string;
    }>;
    page: { nextCursor: string | null; hasMore: boolean };
  }> {
    const pageSize = this.cursors.pageSize(rawPageSize);
    const cursorContext = { scope: `me.tenants:${userId}`, filters: {} };
    const after = this.cursors.read(cursor, cursorContext, cursorKey.stringAndUuid);
    return this.database.withUser(userId, async (transaction) => {
      const result = await sql<{
        membership_id: string;
        tenant_id: string;
        tenant_name: string;
        tenant_code: string;
        status: string;
        roles: TenantRole[];
      }>`
        select tm.id as membership_id, t.id as tenant_id, t.name as tenant_name,
               t.slug as tenant_code, tm.status,
               coalesce(array_agg(mr.code order by mr.code) filter (where mr.code is not null), '{}') as roles
        from tenant_memberships tm
        join tenants t on t.id = tm.tenant_id and t.status = 'active'
        left join membership_role_assignments mra
          on mra.tenant_id = tm.tenant_id and mra.membership_id = tm.id
        left join membership_roles mr on mr.tenant_id = mra.tenant_id and mr.id = mra.role_id
        where tm.user_id = ${userId}::uuid and tm.status = 'active'
          and (${after?.[0] ?? null}::text is null
            or (t.name, t.id) > (${after?.[0] ?? null}, ${after?.[1] ?? null}::uuid))
        group by tm.id, t.id, t.name, t.code, tm.status
        order by t.name, t.id
        limit ${pageSize + 1}
      `.execute(transaction);
      const page = this.cursors.page(result.rows, pageSize, cursorContext, (row) => [
        row.tenant_name,
        row.tenant_id,
      ]);
      return {
        data: page.items.map((row) => ({
          membershipId: row.membership_id,
          tenant: { id: row.tenant_id, name: row.tenant_name, slug: row.tenant_code },
          roles: row.roles,
          status: row.status,
        })),
        page: page.page,
      };
    });
  }

  private async issue(
    user: UserRow,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<IssuedSession> {
    const accessExpiresAt = new Date(
      Date.now() + this.config.values.ACCESS_TOKEN_TTL_SECONDS * 1_000,
    );
    const accessToken = await new SignJWT({ sid: sessionId, pr: user.platform_role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer('english-platform-api')
      .setAudience('english-platform-web')
      .setJti(uuidv7())
      .setIssuedAt()
      .setExpirationTime(Math.floor(accessExpiresAt.getTime() / 1_000))
      .sign(this.accessSecret);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        platformRole: user.platform_role,
        createdAt: user.created_at.toISOString(),
      },
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
    };
  }
}
