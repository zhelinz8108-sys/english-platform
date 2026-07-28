import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'cloud-assets-manifest.json');
const archivePrefix = 'private-archive/workstation';

const includes = [
  'source',
  'output/pdf/the-black-cat-article-only.pdf',
  'outputs/commonlit-book-overlap-20260721/CommonLit-托福-GRE交集词汇-6708.xlsx',
  'outputs/commonlit-book-overlap-20260721/list-preview.png',
  'outputs/commonlit-book-overlap-20260721/qa.json',
  'outputs/commonlit-book-overlap-20260721/status-preview.png',
  'outputs/commonlit-book-overlap-20260721/summary-preview.png',
];

async function collectFiles(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const details = await stat(absolutePath);
  if (details.isFile()) return [relativePath];

  const files = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

async function sha256(absolutePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
  return hash.digest('hex');
}

const relativePaths = (await Promise.all(includes.map(collectFiles)))
  .flat()
  .map((value) => value.split(path.sep).join('/'))
  .sort((left, right) => left.localeCompare(right, 'zh-CN'));

const assets = [];
for (const relativePath of relativePaths) {
  const absolutePath = path.join(repositoryRoot, ...relativePath.split('/'));
  const details = await stat(absolutePath);
  assets.push({
    localPath: relativePath,
    objectKey: `${archivePrefix}/${relativePath}`,
    size: details.size,
    sha256: await sha256(absolutePath),
  });
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  archivePrefix,
  assetCount: assets.length,
  totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
  assets,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${assets.length} assets to ${path.relative(repositoryRoot, manifestPath)}.`);
