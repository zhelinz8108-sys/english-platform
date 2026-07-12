import { hash as hashPassword } from '@node-rs/argon2';
import { Pool } from 'pg';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const connectionString = required('DATABASE_ADMIN_URL');
const tenantName = required('BOOTSTRAP_TENANT_NAME');
const tenantSlug = required('BOOTSTRAP_TENANT_SLUG').toLowerCase();
const ownerEmail = required('BOOTSTRAP_OWNER_EMAIL').toLowerCase();
const ownerPassword = required('BOOTSTRAP_OWNER_PASSWORD');
const ownerDisplayName = process.env.BOOTSTRAP_OWNER_DISPLAY_NAME?.trim() || '机构管理员';

if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/u.test(tenantSlug)) {
  throw new Error('BOOTSTRAP_TENANT_SLUG must be 3-64 lowercase letters, digits or hyphens');
}
if (!/^\S+@\S+\.\S+$/u.test(ownerEmail)) {
  throw new Error('BOOTSTRAP_OWNER_EMAIL must be a valid email address');
}
if (ownerPassword.length < 12) {
  throw new Error('BOOTSTRAP_OWNER_PASSWORD must contain at least 12 characters');
}

const pool = new Pool({ connectionString, max: 1, application_name: 'production-bootstrap' });
const client = await pool.connect();

try {
  const passwordHash = await hashPassword(ownerPassword, {
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
  await client.query('BEGIN');

  const tenant = await client.query<{ id: string }>(
    `insert into tenants(code, slug, name, status, timezone, locale, settings)
     values ($1, $2, $3, 'active', 'Asia/Shanghai', 'zh-CN',
             '{"previewWindowDays":7,"defaultLatePolicy":"allow"}'::jsonb)
     on conflict (slug) do update set name=excluded.name, status='active', updated_at=now()
     returning id`,
    [tenantSlug.replaceAll('-', '_'), tenantSlug, tenantName],
  );
  const tenantId = tenant.rows[0]!.id;

  const user = await client.query<{ id: string }>(
    `insert into users(email_normalized, password_hash, display_name, status, platform_role)
     values ($1::citext, $2, $3, 'active', 'none')
     on conflict (email_normalized) where email_normalized is not null
     do update set password_hash=excluded.password_hash, display_name=excluded.display_name,
                   status='active', updated_at=now()
     returning id`,
    [ownerEmail, passwordHash, ownerDisplayName],
  );
  const userId = user.rows[0]!.id;

  const membership = await client.query<{ id: string }>(
    `insert into tenant_memberships(tenant_id, user_id, status, joined_at)
     values ($1::uuid, $2::uuid, 'active', now())
     on conflict (tenant_id, user_id)
     do update set status='active', joined_at=coalesce(tenant_memberships.joined_at, now()),
                   suspended_at=null, left_at=null, updated_at=now()
     returning id`,
    [tenantId, userId],
  );
  const membershipId = membership.rows[0]!.id;

  const roles = [
    ['owner', '机构所有者', ['tenant:*']],
    ['admin', '管理员', ['tenant:manage', 'catalog:manage', 'assignment:manage']],
    ['teacher', '教师', ['class:manage', 'assignment:create', 'assessment:grade']],
    ['student', '学生', ['task:read', 'attempt:write', 'progress:read']],
    ['content_editor', '内容编辑', ['catalog:write', 'catalog:publish']],
    ['analyst', '分析员', ['progress:aggregate']],
  ] as const;

  for (const [code, name, permissions] of roles) {
    await client.query(
      `insert into membership_roles(tenant_id, code, name, permissions, is_system)
       values ($1::uuid, $2, $3, $4::jsonb, true)
       on conflict (tenant_id, code)
       do update set name=excluded.name, permissions=excluded.permissions,
                     is_system=true, updated_at=now()`,
      [tenantId, code, name, JSON.stringify(permissions)],
    );
  }

  await client.query(
    `insert into membership_role_assignments(
       tenant_id, membership_id, role_id, granted_by_membership_id
     )
     select $1::uuid, $2::uuid, role.id, $2::uuid
     from membership_roles role
     where role.tenant_id=$1::uuid and role.code='owner'
     on conflict (tenant_id, membership_id, role_id) do nothing`,
    [tenantId, membershipId],
  );

  await client.query('COMMIT');
  console.log(JSON.stringify({ tenantId, tenantSlug, ownerEmail }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
