import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hash as hashPassword } from '@node-rs/argon2';
import { Pool, type PoolClient } from 'pg';

const MIGRATION_LOCK_KEY = 7_042_026_011;
const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const seedDirectory = fileURLToPath(new URL('../seeds/', import.meta.url));

export interface RunMigrationsOptions {
  connectionString: string;
  directory?: string;
}

export interface RunSeedsOptions {
  connectionString: string;
  directory?: string;
  demoPassword?: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

interface AppliedMigration {
  name: string;
  checksum: string;
}

async function sqlFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((entry) => /^\d+.*\.sql$/u.test(entry))
    .sort((left, right) => left.localeCompare(right));
}

function checksum(sqlText: string): string {
  return createHash('sha256').update(sqlText).digest('hex');
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS platform');
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationResult> {
  const pool = new Pool({ connectionString: options.connectionString, max: 1 });
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await ensureMigrationTable(client);

    const appliedRows = await client.query<AppliedMigration>(
      'SELECT name, checksum FROM platform.schema_migrations',
    );
    const applied = new Map(appliedRows.rows.map((row) => [row.name, row.checksum]));
    const directory = options.directory ?? migrationDirectory;

    for (const fileName of await sqlFiles(directory)) {
      const sqlText = await readFile(join(directory, fileName), 'utf8');
      const fileChecksum = checksum(sqlText);
      const existingChecksum = applied.get(fileName);

      if (existingChecksum) {
        if (existingChecksum !== fileChecksum) {
          throw new Error(`Migration checksum mismatch: ${fileName}`);
        }
        result.skipped.push(fileName);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query(
          'INSERT INTO platform.schema_migrations (name, checksum) VALUES ($1, $2)',
          [fileName, fileChecksum],
        );
        await client.query('COMMIT');
        result.applied.push(fileName);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
    await pool.end();
  }

  return result;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function runSeeds(options: RunSeedsOptions): Promise<MigrationResult> {
  const pool = new Pool({ connectionString: options.connectionString, max: 1 });
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  const passwordHash = await hashPassword(options.demoPassword ?? 'Demo123!', {
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });

  try {
    const directory = options.directory ?? seedDirectory;
    for (const fileName of await sqlFiles(directory)) {
      const sqlText = (await readFile(join(directory, fileName), 'utf8')).replaceAll(
        '__DEMO_PASSWORD_HASH__',
        sqlLiteral(passwordHash),
      );

      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query('COMMIT');
        result.applied.push(fileName);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  return result;
}
