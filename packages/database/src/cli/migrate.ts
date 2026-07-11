import { runMigrations } from '../migration-runner.js';

const connectionString = process.env['DATABASE_ADMIN_URL'];
if (!connectionString) {
  throw new Error('DATABASE_ADMIN_URL is required');
}

const result = await runMigrations({ connectionString });
console.log(JSON.stringify(result, null, 2));
