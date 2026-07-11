import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, process.env.ENV_FILE ?? '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-with-env.mjs <pnpm arguments...>');
  process.exit(2);
}

const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) throw new Error('npm_execpath is unavailable; run this script through pnpm');

const child = spawn(process.execPath, [pnpmEntrypoint, ...args], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
