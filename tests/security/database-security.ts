import { runDatabaseSecurityChecks } from '../../packages/database/src/security-check.js';

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_ADMIN_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_ADMIN_URL is required');
  }

  const results = await runDatabaseSecurityChecks({ connectionString });
  for (const result of results) {
    console.log(`PASS ${result.name}: ${result.detail}`);
  }
  console.log(`Database security checks passed: ${results.length}`);
}

void main();
