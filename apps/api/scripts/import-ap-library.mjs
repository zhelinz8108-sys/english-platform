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
const catalogPath = path.resolve(
  argument('catalog', path.join(repositoryRoot, 'output/ap-library/catalog.json')),
);
const sourceRoot = path.resolve(argument('source', 'D:\\留学\\AP'));
const outputRoot = path.dirname(catalogPath);
const credentialPath = path.resolve(
  argument('credentials', path.join(repositoryRoot, 'AccessKey_Ali/AccessKey.csv')),
);
const concurrency = Number.parseInt(argument('concurrency', '5'), 10);
const dryRun = argument('dry-run', 'false') === 'true';
const originalsOnly = argument('originals-only', 'false') === 'true';
const nativeOnly = argument('native-only', 'false') === 'true';
if (originalsOnly && nativeOnly)
  throw new Error('Choose either --originals-only or --native-only.');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12)
  throw new Error('Concurrency must be 1-12.');

const credentials = parseCsv(await readFile(credentialPath, 'utf8'));
const accessKeyId = process.env.S3_ACCESS_KEY ?? credentials['AccessKey ID'];
const secretAccessKey = process.env.S3_SECRET_KEY ?? credentials['AccessKey Secret'];
if (!accessKeyId || !secretAccessKey) throw new Error('Alibaba Cloud credentials are missing.');

const endpoint = process.env.S3_ENDPOINT ?? 'https://oss-cn-hangzhou.aliyuncs.com';
const bucket = process.env.S3_BUCKET ?? 'aurelis-english-assets-386928';
const s3 = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? 'oss-cn-hangzhou',
  forcePathStyle: false,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId, secretAccessKey },
});

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const unique = new Map();
for (const item of [...catalog.documents, ...catalog.media]) {
  if (!nativeOnly && !unique.has(item.originalStorageKey)) {
    unique.set(item.originalStorageKey, {
      key: item.originalStorageKey,
      file: path.resolve(sourceRoot, ...item.relativePath.split('/')),
      mediaType: item.mediaType,
      sha256: item.sha256,
    });
  }
}
for (const item of originalsOnly ? [] : catalog.documents) {
  if (!item.nativeStorageKey || unique.has(item.nativeStorageKey)) continue;
  unique.set(item.nativeStorageKey, {
    key: item.nativeStorageKey,
    file: path.join(outputRoot, 'native', `${item.sha256}.json.gz`),
    mediaType: 'application/gzip',
    sha256: item.sha256,
  });
}

const statePath = path.join(outputRoot, 'upload-state.json');
let state = { completed: {}, uploadedBytes: 0 };
try {
  state = JSON.parse(await readFile(statePath, 'utf8'));
} catch {}
const entries = [...unique.values()];
let cursor = 0;
let completed = Object.keys(state.completed).length;
let uploaded = 0;
let reused = 0;
let uploadedBytes = state.uploadedBytes ?? 0;
let lastStateWrite = Date.now();

async function exists(entry, size) {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: entry.key }));
    return Number(result.ContentLength) === size;
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 403 ||
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey'
    )
      return false;
    throw error;
  }
}

async function saveState(force = false) {
  if (!force && Date.now() - lastStateWrite < 5_000) return;
  lastStateWrite = Date.now();
  await writeFile(statePath, JSON.stringify({ ...state, uploadedBytes }, null, 2), 'utf8');
}

async function upload(entry) {
  const info = await stat(entry.file);
  if (!info.isFile()) throw new Error(`Missing AP source: ${entry.file}`);
  if (state.completed[entry.key] === info.size || (await exists(entry, info.size))) {
    state.completed[entry.key] = info.size;
    reused += 1;
    return;
  }
  if (dryRun) return;
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
          CacheControl: entry.key.includes('/ap/native/')
            ? 'private, max-age=86400'
            : 'private, max-age=3600',
          Metadata: { sha256: entry.sha256 },
        }),
      );
      state.completed[entry.key] = info.size;
      uploaded += 1;
      uploadedBytes += info.size;
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
    const entry = entries[index];
    await upload(entry);
    completed += 1;
    if (completed % 25 === 0 || completed === entries.length) {
      console.log(
        JSON.stringify({
          completed,
          total: entries.length,
          uploaded,
          reused,
          uploadedGiB: (uploadedBytes / 1024 ** 3).toFixed(2),
        }),
      );
    }
    await saveState();
  }
}

console.log(
  JSON.stringify({
    files: entries.length,
    sourceFiles: catalog.summary.sourceFileCount,
    bucket,
    dryRun,
  }),
);
await Promise.all(Array.from({ length: concurrency }, () => worker()));
await saveState(true);
console.log(JSON.stringify({ status: 'complete', completed, uploaded, reused, uploadedBytes }));
