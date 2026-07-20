import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

export interface DatabaseSecurityCheckOptions {
  connectionString: string;
}

export interface DatabaseSecurityCheckResult {
  name: string;
  detail: string;
}

interface PgErrorLike {
  code?: string;
  message?: string;
}

function isPgErrorLike(error: unknown): error is PgErrorLike {
  return typeof error === 'object' && error !== null;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectSqlState(
  client: PoolClient,
  savepoint: string,
  statement: string,
  parameters: readonly unknown[],
  expectedCode: string,
): Promise<void> {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(statement, [...parameters]);
    throw new Error(`Expected PostgreSQL error ${expectedCode}`);
  } catch (error) {
    if (!isPgErrorLike(error) || error.code !== expectedCode) {
      throw error;
    }
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

async function clearContext(client: PoolClient): Promise<void> {
  await client.query(
    `select
       set_config('app.tenant_id', '', true),
       set_config('app.user_id', '', true),
       set_config('app.membership_id', '', true),
       set_config('app.worker_id', '', true)`,
  );
}

export async function runDatabaseSecurityChecks(
  options: DatabaseSecurityCheckOptions,
): Promise<DatabaseSecurityCheckResult[]> {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: 1,
    application_name: 'english-platform-security-check',
  });
  const client = await pool.connect();
  const results: DatabaseSecurityCheckResult[] = [];

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const studentA = randomUUID();
  const studentB = randomUUID();
  const classA = randomUUID();
  const classB = randomUUID();
  const questionA = randomUUID();
  const questionVersionA = randomUUID();
  const vocabularyItemA = randomUUID();
  const vocabularyCalibrationA = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);

  try {
    await client.query('BEGIN');

    await client.query(
      `insert into tenants(id, code, slug, name)
       values ($1, $2, $3, 'Security Tenant A'), ($4, $5, $6, 'Security Tenant B')`,
      [
        tenantA,
        `security_a_${suffix}`,
        `security-a-${suffix}`,
        tenantB,
        `security_b_${suffix}`,
        `security-b-${suffix}`,
      ],
    );
    await client.query(
      `insert into users(id, email_normalized, password_hash, display_name)
       values ($1, $2, '$test$', 'Security User A'), ($3, $4, '$test$', 'Security User B')`,
      [userA, `security-a-${suffix}@example.test`, userB, `security-b-${suffix}@example.test`],
    );
    await client.query(
      `insert into tenant_memberships(id, tenant_id, user_id, status, joined_at)
       values ($1, $2, $3, 'active', now()), ($4, $5, $6, 'active', now())`,
      [membershipA, tenantA, userA, membershipB, tenantB, userB],
    );
    await client.query(
      `insert into student_profiles(id, tenant_id, membership_id, locale, timezone)
       values ($1, $2, $3, 'zh-CN', 'Asia/Shanghai'),
              ($4, $5, $6, 'zh-CN', 'Asia/Shanghai')`,
      [studentA, tenantA, membershipA, studentB, tenantB, membershipB],
    );
    await client.query(
      `insert into classes(id, tenant_id, code, name, status, created_by_membership_id)
       values ($1, $2, 'SEC-A', 'Security Class A', 'active', $3),
              ($4, $5, 'SEC-B', 'Security Class B', 'active', $6)`,
      [classA, tenantA, membershipA, classB, tenantB, membershipB],
    );
    await client.query(
      `insert into questions(id, tenant_id, kind, slug, created_by_membership_id)
       values ($1, $2, 'single_choice', $3, $4)`,
      [questionA, tenantA, `security-question-${suffix}`, membershipA],
    );
    await client.query(
      `insert into question_versions(
         id, tenant_id, question_id, version_no, publication_state, prompt, options,
         answer_key, scoring_rule, max_score
       ) values (
         $1, $2, $3, 1, 'draft', '{"text":"security"}',
         '[{"option_id":"a","text":"A"}]', '{"correct_option_ids":["a"]}',
         '{"type":"exact_option_set"}', 1
       )`,
      [questionVersionA, tenantA, questionA],
    );
    await client.query(
      `insert into vocabulary_assessment_items(
         id, tenant_id, item_key, band, target_word, sentence, options,
         correct_option_index, status, content_version, source_list_version
       ) values ($1, $2, $3, 1, 'abate', 'The storm began to abate.',
         '["增强","减弱","测量","拒绝"]', 1, 'draft', 'security-v1', 'security-list-v1')`,
      [vocabularyItemA, tenantA, `security-vocabulary-${suffix}`],
    );
    await client.query(
      `insert into vocabulary_assessment_calibrations(
         id, tenant_id, version, model, status, sample_size, external_validation_size,
         fit_summary, acceptance_gates, source_checksum, created_by_membership_id
       ) values ($1, $2, $3, 'rasch', 'draft', 500, 200, '{}', '{}', $4, $5)`,
      [
        vocabularyCalibrationA,
        tenantA,
        `security-calibration-${suffix}`,
        '0'.repeat(64),
        membershipA,
      ],
    );
    await client.query(
      `insert into vocabulary_assessment_item_parameters(
         tenant_id, item_id, calibration_id, difficulty, discrimination,
         guessing, standard_error, sample_size
       ) values ($1, $2, $3, 0.25, 1, 0, 0.1, 500)`,
      [tenantA, vocabularyItemA, vocabularyCalibrationA],
    );

    const roles = await client.query<{
      rolname: string;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `select rolname, rolbypassrls, rolcanlogin
       from pg_roles where rolname in ('english_app', 'english_worker')
       order by rolname`,
    );
    requireCondition(roles.rowCount === 2, 'runtime roles are missing');
    requireCondition(
      roles.rows.every((role) => role.rolcanlogin && !role.rolbypassrls),
      'english_app/english_worker must be LOGIN NOBYPASSRLS',
    );
    results.push({
      name: 'runtime_roles_nobypassrls',
      detail: roles.rows.map((role) => `${role.rolname}:NOBYPASSRLS`).join(', '),
    });

    const tenantTables = await client.query<{
      total: number;
      forced: number;
      nullable_tenant_ids: number;
    }>(
      `with tenant_tables as (
         select distinct columns.table_name, class.relrowsecurity, class.relforcerowsecurity,
           columns.is_nullable
         from information_schema.columns columns
         join pg_class class on class.relname = columns.table_name
         join pg_namespace namespace
           on namespace.oid = class.relnamespace and namespace.nspname = 'public'
         where columns.table_schema = 'public'
           and columns.column_name = 'tenant_id'
           and class.relkind in ('r', 'p')
       )
       select
         count(*)::int as total,
         count(*) filter (where relrowsecurity and relforcerowsecurity)::int as forced,
         count(*) filter (where is_nullable <> 'NO')::int as nullable_tenant_ids
       from tenant_tables`,
    );
    const tableResult = tenantTables.rows[0];
    requireCondition(Boolean(tableResult), 'tenant table inventory returned no row');
    requireCondition(
      tableResult!.total > 0 &&
        tableResult!.total === tableResult!.forced &&
        tableResult!.nullable_tenant_ids === 0,
      'every tenant table must FORCE RLS and tenant_id must be NOT NULL',
    );
    const tenantsRoot = await client.query<{ secured: boolean }>(
      `select relrowsecurity and relforcerowsecurity as secured
       from pg_class class join pg_namespace namespace on namespace.oid = class.relnamespace
       where namespace.nspname = 'public' and class.relname = 'tenants'`,
    );
    requireCondition(tenantsRoot.rows[0]?.secured === true, 'tenants root table must FORCE RLS');
    results.push({
      name: 'all_tenant_tables_force_rls',
      detail: `${tableResult!.forced}/${tableResult!.total} tables; nullable tenant_id=0`,
    });

    await clearContext(client);
    await client.query('SET LOCAL ROLE english_app');
    const noContext = await client.query<{ count: number }>(
      `select count(*)::int as count from classes where id in ($1, $2)`,
      [classA, classB],
    );
    requireCondition(noContext.rows[0]?.count === 0, 'english_app saw tenant data without context');
    await client.query('RESET ROLE');
    results.push({
      name: 'no_context_denies_tenant_rows',
      detail: 'english_app returned zero fixture rows',
    });

    await client.query('SET LOCAL ROLE english_app');
    await client.query(
      `select
         set_config('app.tenant_id', $1, true),
         set_config('app.user_id', $2, true),
         set_config('app.membership_id', $3, true)`,
      [tenantA, userA, membershipA],
    );
    const tenantAVisibility = await client.query<{ own_count: number; other_count: number }>(
      `select
         count(*) filter (where id = $1)::int as own_count,
         count(*) filter (where id = $2)::int as other_count
       from classes where id in ($1, $2)`,
      [classA, classB],
    );
    requireCondition(
      tenantAVisibility.rows[0]?.own_count === 1 && tenantAVisibility.rows[0]?.other_count === 0,
      'tenant A context crossed the tenant boundary',
    );
    await client.query('RESET ROLE');
    results.push({
      name: 'tenant_a_cannot_read_tenant_b',
      detail: 'A own rows=1; B rows=0',
    });

    await client.query('SET LOCAL ROLE english_app');
    await client.query(
      `select
         set_config('app.tenant_id', $1, true),
         set_config('app.user_id', $2, true),
         set_config('app.membership_id', $3, true)`,
      [tenantB, userA, membershipA],
    );
    const mismatchedPrincipal = await client.query<{ count: number }>(
      'select count(*)::int as count from classes where id = $1',
      [classB],
    );
    requireCondition(
      mismatchedPrincipal.rows[0]?.count === 0,
      'mismatched membership and tenant context was accepted',
    );
    await client.query('RESET ROLE');
    results.push({
      name: 'mismatched_principal_denied',
      detail: 'tenant B + membership A returned zero rows',
    });

    await clearContext(client);
    await client.query('SET LOCAL ROLE english_worker');
    const workerNoContext = await client.query<{ count: number }>(
      `select count(*)::int as count from classes where id in ($1, $2)`,
      [classA, classB],
    );
    requireCondition(
      workerNoContext.rows[0]?.count === 0,
      'english_worker saw tenant rows without worker context',
    );
    await client.query('RESET ROLE');
    results.push({
      name: 'worker_without_context_denied',
      detail: 'english_worker returned zero fixture rows',
    });

    await expectSqlState(
      client,
      'cross_tenant_fk',
      `insert into class_students(
         id, tenant_id, class_id, student_profile_id, joined_at
       ) values ($1, $2, $3, $4, now())`,
      [randomUUID(), tenantA, classB, studentA],
      '23503',
    );
    results.push({
      name: 'composite_fk_blocks_cross_tenant_reference',
      detail: 'cross-tenant ClassStudent rejected with SQLSTATE 23503',
    });

    await client.query('SAVEPOINT answer_key_permission');
    try {
      await client.query('SET LOCAL ROLE english_app');
      await client.query(
        `select
           set_config('app.tenant_id', $1, true),
           set_config('app.user_id', $2, true),
           set_config('app.membership_id', $3, true)`,
        [tenantA, userA, membershipA],
      );
      await client.query('select answer_key from question_versions where id = $1', [
        questionVersionA,
      ]);
      throw new Error('english_app unexpectedly read question_versions.answer_key');
    } catch (error) {
      if (!isPgErrorLike(error) || error.code !== '42501') {
        throw error;
      }
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT answer_key_permission');
      await client.query('RELEASE SAVEPOINT answer_key_permission');
    }
    results.push({
      name: 'answer_key_column_denied',
      detail: 'english_app rejected with SQLSTATE 42501',
    });

    await expectSqlState(
      client,
      'vocabulary_parameter_immutable',
      `update vocabulary_assessment_item_parameters
       set difficulty = 0.5
       where tenant_id = $1 and item_id = $2 and calibration_id = $3`,
      [tenantA, vocabularyItemA, vocabularyCalibrationA],
      '55000',
    );
    results.push({
      name: 'vocabulary_parameters_version_frozen',
      detail: 'difficulty mutation rejected with SQLSTATE 55000',
    });

    await expectSqlState(
      client,
      'vocabulary_activation_gate',
      `update vocabulary_assessment_calibrations
       set status = 'active', activated_at = now()
       where tenant_id = $1 and id = $2`,
      [tenantA, vocabularyCalibrationA],
      '23514',
    );
    results.push({
      name: 'vocabulary_calibration_activation_gated',
      detail: 'insufficient bank/evidence rejected with SQLSTATE 23514',
    });

    await client.query('ROLLBACK');
    return results;
  } catch (error) {
    await client.query('RESET ROLE').catch(() => undefined);
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
