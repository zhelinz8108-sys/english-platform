import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoots = ['apps', 'packages'];
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (['node_modules', 'dist', '.next', 'coverage'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (['.ts', '.tsx', '.mts'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const sourceRoot of sourceRoots) {
  for (const file of await walk(join(root, sourceRoot))) {
    const path = relative(root, file).replaceAll('\\', '/');
    const text = await readFile(file, 'utf8');
    const imports = [...text.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    for (const specifier of imports) {
      if (!specifier) continue;
      if (path.startsWith('apps/') && specifier.startsWith('../') && specifier.includes('/apps/')) {
        violations.push(`${path}: app-to-app relative import ${specifier}`);
      }
      if (path.startsWith('packages/shared/') && specifier === '@english/database') {
        violations.push(`${path}: shared must not depend on database`);
      }
      if (path.startsWith('packages/database/') && specifier.startsWith('../../apps/')) {
        violations.push(`${path}: database must not depend on an app`);
      }
    }
  }
}

if (violations.length) {
  console.error('Architecture boundary violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Architecture boundaries: OK');
