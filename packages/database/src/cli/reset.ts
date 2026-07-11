import { Pool } from 'pg';

import { runMigrations, runSeeds } from '../migration-runner.js';

if (process.env['NODE_ENV'] === 'production' || process.env['ALLOW_DATABASE_RESET'] !== 'true') {
  throw new Error('Reset refused. Set ALLOW_DATABASE_RESET=true outside production.');
}

const connectionString = process.env['DATABASE_ADMIN_URL'];
if (!connectionString) {
  throw new Error('DATABASE_ADMIN_URL is required');
}

const pool = new Pool({ connectionString, max: 1 });
try {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS app CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS platform CASCADE');
  await pool.query('CREATE SCHEMA public');
} finally {
  await pool.end();
}

await runMigrations({ connectionString });
await runSeeds({
  connectionString,
  demoPassword: process.env['DEMO_PASSWORD'] ?? 'Demo123!',
});
console.log('Database reset complete.');
