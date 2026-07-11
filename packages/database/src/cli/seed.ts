import { runMigrations, runSeeds } from '../migration-runner.js';

const connectionString = process.env['DATABASE_ADMIN_URL'];
if (!connectionString) {
  throw new Error('DATABASE_ADMIN_URL is required');
}

await runMigrations({ connectionString });
const result = await runSeeds({
  connectionString,
  demoPassword: process.env['DEMO_PASSWORD'] ?? 'Demo123!',
});
console.log(JSON.stringify(result, null, 2));
