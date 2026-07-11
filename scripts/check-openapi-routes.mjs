import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const apiSource = join(root, 'apps', 'api', 'src');
const contractPath = join(root, 'outputs', 'english-platform-v1-1', 'openapi-v1.yaml');
const httpDecorators = new Map([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.controller.ts')) files.push(path);
  }
  return files;
}

function normalizePath(prefix, suffix) {
  const path = `/${prefix}/${suffix}`
    .replaceAll(/\/+/gu, '/')
    .replace(/\/$/u, '')
    .replace(/:([A-Za-z0-9_]+)/gu, '{$1}');
  return path || '/';
}

const implementation = new Set();
for (const file of await sourceFiles(apiSource)) {
  const text = await readFile(file, 'utf8');
  const controller = /@Controller\(\s*['"]([^'"]+)['"]\s*\)/u.exec(text);
  if (!controller) continue;
  const prefix = controller[1];
  const routePattern = /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/gu;
  for (const route of text.matchAll(routePattern)) {
    const method = httpDecorators.get(route[1]);
    if (method) implementation.add(`${method} ${normalizePath(prefix, route[2] ?? '')}`);
  }
}

const contract = new Set();
let currentPath = null;
for (const line of (await readFile(contractPath, 'utf8')).split(/\r?\n/u)) {
  const pathMatch = /^  (\/api\/v1\/[^:]+(?:\{[^}]+\}[^:]*)*):\s*$/u.exec(line);
  if (pathMatch) {
    currentPath = pathMatch[1];
    continue;
  }
  const methodMatch = /^    (get|post|put|patch|delete):\s*$/u.exec(line);
  if (currentPath && methodMatch) contract.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
}

const missing = [...contract].filter((route) => !implementation.has(route)).sort();
const extra = [...implementation]
  .filter((route) => route.includes('/api/v1/') && !contract.has(route))
  .sort();

if (missing.length || extra.length) {
  if (missing.length) console.error(`Missing OpenAPI operations:\n${missing.join('\n')}`);
  if (extra.length) console.error(`Undocumented API operations:\n${extra.join('\n')}`);
  process.exit(1);
}

console.log(`OpenAPI route parity passed: ${contract.size} operations.`);
