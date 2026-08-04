import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function objectKey(entry, tenantId) {
  return `tenants/${tenantId}/toefl/listening/${entry.collection}/${String(entry.sequence).padStart(4, '0')}${entry.extension}`;
}

function archiveKey(entry, tenantId) {
  return `tenants/${tenantId}/toefl/listening/original-v1/${entry.collection}/${String(entry.sequence).padStart(4, '0')}${entry.extension}`;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const manifestPath = path.resolve(argument('manifest', ''));
if (!manifestPath) throw new Error('Pass --manifest=<batch manifest JSON>.');
const tenantId = argument('tenant', '019f8d4f-c7ce-77b8-979a-206f28f8fda4');
const bucket = process.env.S3_BUCKET ?? 'aurelis-english-assets-386928';
const concurrency = Number.parseInt(argument('concurrency', '2'), 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error('Concurrency must be an integer from 1 to 8.');
}
const dryRun = argument('dry-run', 'false') === 'true';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'https://oss-cn-hangzhou.aliyuncs.com',
  region: process.env.S3_REGION ?? 'cn-hangzhou',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'false') === 'true',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

async function head(key, { tolerateForbidden = false } = {}) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey' ||
      (tolerateForbidden && error?.$metadata?.httpStatusCode === 403)
    ) {
      return null;
    }
    throw error;
  }
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
  throw new Error(`Unsupported denoise manifest: ${manifestPath}`);
}
if (!manifest.version || !manifest.model) {
  throw new Error('Manifest must include version and model.');
}

for (const entry of manifest.entries) {
  if (!entry.collection || !Number.isInteger(entry.sequence) || !entry.processedPath) {
    throw new Error('Manifest contains an invalid entry.');
  }
  const info = await stat(entry.processedPath).catch(() => null);
  if (!info?.isFile() || info.size !== entry.processedSizeBytes) {
    throw new Error(`Processed file is missing or changed: ${entry.processedPath}`);
  }
  const sha256 = await sha256File(entry.processedPath);
  if (sha256 !== entry.processedSha256) {
    throw new Error(`Processed SHA-256 mismatch: ${entry.processedPath}`);
  }
}

if (dryRun) {
  console.log(`Validated ${manifest.entries.length} denoised files; no OSS changes made.`);
  process.exit(0);
}
if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
  throw new Error('Set S3_ACCESS_KEY and S3_SECRET_KEY before uploading.');
}

let nextIndex = 0;
let completed = 0;
let uploaded = 0;
let reused = 0;

async function uploadNext() {
  while (nextIndex < manifest.entries.length) {
    const entry = manifest.entries[nextIndex++];
    const currentKey = objectKey(entry, tenantId);
    const originalKey = archiveKey(entry, tenantId);
    const current = await head(currentKey);
    if (!current) throw new Error(`Current production object is missing: ${currentKey}`);
    let archived = await head(originalKey, { tolerateForbidden: true });

    if (!archived) {
      const currentIsDenoised = current.Metadata?.['denoise-version'] === manifest.version;
      const currentMatchesLocalSource =
        Number(current.ContentLength) === entry.sourceSizeBytes &&
        (!current.Metadata?.sha256 || current.Metadata.sha256 === entry.sourceSha256);
      if (!currentIsDenoised && !currentMatchesLocalSource) {
        throw new Error(`Local source does not match current production original: ${currentKey}`);
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: originalKey,
          Body: createReadStream(entry.sourcePath),
          ContentType: currentIsDenoised ? entry.mediaType : current.ContentType,
          ContentLength: entry.sourceSizeBytes,
          Metadata: {
            sha256: entry.sourceSha256,
            'tenant-id': tenantId,
            'archived-from': currentKey,
            'archive-version': 'original-v1',
          },
        }),
      );
      archived = await head(originalKey);
    }
    if (
      !archived ||
      Number(archived.ContentLength) !== entry.sourceSizeBytes ||
      archived.Metadata?.sha256 !== entry.sourceSha256
    ) {
      throw new Error(`Original archive verification failed: ${originalKey}`);
    }

    if (current.Metadata?.['denoise-version'] === manifest.version) {
      reused += 1;
    } else {
      const fileId = current.Metadata?.['file-id'];
      if (!fileId) throw new Error(`Production object has no file-id metadata: ${currentKey}`);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: currentKey,
          Body: createReadStream(entry.processedPath),
          ContentType: entry.mediaType,
          ContentLength: entry.processedSizeBytes,
          CacheControl: current.CacheControl,
          ContentDisposition: current.ContentDisposition,
          Metadata: {
            sha256: entry.processedSha256,
            'tenant-id': tenantId,
            'file-id': fileId,
            'denoise-version': manifest.version,
            'denoise-model': manifest.model,
            'original-key': originalKey,
            'original-sha256': current.Metadata?.sha256 ?? entry.sourceSha256,
          },
        }),
      );
      const verified = await head(currentKey);
      if (
        !verified ||
        Number(verified.ContentLength) !== entry.processedSizeBytes ||
        verified.Metadata?.['denoise-version'] !== manifest.version ||
        verified.Metadata?.sha256 !== entry.processedSha256
      ) {
        throw new Error(`Denoised upload verification failed: ${currentKey}`);
      }
      uploaded += 1;
    }

    completed += 1;
    console.log(
      `[${completed}/${manifest.entries.length}] ${entry.collection} ${String(entry.sequence).padStart(4, '0')} ready`,
    );
  }
}

await Promise.all(Array.from({ length: concurrency }, () => uploadNext()));
console.log(
  `Denoised listening upload complete: ${completed} records, ${uploaded} uploaded, ${reused} reused.`,
);
