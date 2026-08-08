import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/u, '')
    .split(/\r?\n/u)
    .filter(Boolean);
  const headers = lines[0].split(',').map((value) => value.trim().replace(/^"|"$/gu, ''));
  const values = lines[1].split(',').map((value) => value.trim().replace(/^"|"$/gu, ''));
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const outputRoot = path.resolve(
  argument('output', path.join(repositoryRoot, 'output/alevel-library')),
);
const sourceRoot = path.resolve(argument('source', 'D:\\留学\\Alevel-CIE'));
const credentialPath = path.resolve(
  argument('credentials', path.join(repositoryRoot, 'AccessKey_Ali/AccessKey.csv')),
);
const concurrency = Number.parseInt(argument('concurrency', '5'), 10);
const dryRun = argument('dry-run', 'false') === 'true';
const verifyExisting = argument('verify-existing', 'false') === 'true';
const kind = argument('kind', 'all');
const logEvery = Number.parseInt(argument('log-every', '500'), 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
  throw new Error('Concurrency must be 1-12.');
}
if (!['all', 'original', 'generated'].includes(kind)) {
  throw new Error('Kind must be all, original, or generated.');
}

const credentials = parseCsv(await readFile(credentialPath, 'utf8'));
const accessKeyId =
  process.env.S3_ACCESS_KEY ?? credentials['AccessKey ID'] ?? credentials.AccessKeyId;
const secretAccessKey =
  process.env.S3_SECRET_KEY ?? credentials['AccessKey Secret'] ?? credentials.AccessKeySecret;
if (!accessKeyId || !secretAccessKey) throw new Error('Alibaba Cloud credentials are missing.');

const bucket = process.env.S3_BUCKET ?? 'aurelis-english-assets-386928';
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'https://oss-cn-hangzhou.aliyuncs.com',
  region: process.env.S3_REGION ?? 'oss-cn-hangzhou',
  forcePathStyle: false,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId, secretAccessKey },
});

const manifest = JSON.parse(await readFile(path.join(outputRoot, 'upload-manifest.json'), 'utf8'));
const entries = manifest.entries
  .filter((entry) => kind === 'all' || entry.kind === kind)
  .map((entry) => ({
    ...entry,
    file:
      entry.kind === 'original'
        ? path.resolve(sourceRoot, ...entry.relativePath.split('/'))
        : path.resolve(outputRoot, ...entry.relativePath.split('/')),
  }));
const statePath = path.join(outputRoot, 'upload-state.json');
let state = { releaseVersion: manifest.releaseVersion, completed: {}, uploadedBytes: 0 };
try {
  const previous = JSON.parse(await readFile(statePath, 'utf8'));
  if (previous.releaseVersion === manifest.releaseVersion) state = previous;
} catch {}

let cursor = 0;
let completed = entries.filter((entry) => state.completed[entry.key] !== undefined).length;
let uploaded = 0;
let reused = 0;
let lastWrite = Date.now();

async function exists(entry, size) {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: entry.key }));
    return Number(result.ContentLength) === size;
  } catch (error) {
    if ([403, 404].includes(error?.$metadata?.httpStatusCode)) return false;
    throw error;
  }
}

async function saveState(force = false) {
  if (!force && Date.now() - lastWrite < 5_000) return;
  lastWrite = Date.now();
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

async function upload(entry) {
  const info = await stat(entry.file);
  if (!info.isFile()) throw new Error(`Missing A Level source: ${entry.file}`);
  if (state.completed[entry.key] === info.size) {
    state.completed[entry.key] = info.size;
    reused += 1;
    return;
  }
  if (dryRun) return;
  if (verifyExisting && (await exists(entry, info.size))) {
    state.completed[entry.key] = info.size;
    reused += 1;
    return;
  }
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: entry.key,
          Body: createReadStream(entry.file),
          ContentLength: info.size,
          ContentType: entry.mediaType,
          CacheControl:
            entry.kind === 'generated' ? 'private, max-age=86400' : 'private, max-age=3600',
          ...(entry.sha256 ? { Metadata: { sha256: entry.sha256 } } : {}),
        }),
      );
      state.completed[entry.key] = info.size;
      state.uploadedBytes += info.size;
      uploaded += 1;
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw lastError;
}

async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= entries.length) return;
    await upload(entries[index]);
    completed += 1;
    if (completed % logEvery === 0 || completed === entries.length) {
      console.log(
        JSON.stringify({
          completed,
          total: entries.length,
          uploaded,
          reused,
          uploadedGiB: (state.uploadedBytes / 1024 ** 3).toFixed(2),
        }),
      );
    }
    await saveState();
  }
}

console.log(
  JSON.stringify({
    releaseVersion: manifest.releaseVersion,
    files: entries.length,
    bucket,
    dryRun,
    verifyExisting,
    kind,
  }),
);
await Promise.all(Array.from({ length: concurrency }, () => worker()));
await saveState(true);
console.log(JSON.stringify({ status: 'complete', completed, uploaded, reused }));
