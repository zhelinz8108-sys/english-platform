import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath = path.join(repositoryRoot, 'cloud-assets-manifest.json');
const action = process.argv[2] ?? 'verify';

if (!['upload', 'verify', 'download'].includes(action)) {
  throw new Error('Usage: pnpm archive:sync -- <upload|verify|download>');
}

const requiredEnvironment = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});
const bucket = process.env.S3_BUCKET;
const encryption = process.env.ARCHIVE_S3_SSE ?? 'AES256';
const encryptionOptions =
  encryption && encryption !== 'none' ? { ServerSideEncryption: encryption } : {};

async function remoteMetadata(asset) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.objectKey }));
    return {
      size: Number(head.ContentLength ?? -1),
      sha256: head.Metadata?.sha256,
    };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
    throw error;
  }
}

async function upload(asset) {
  const existing = await remoteMetadata(asset);
  if (existing?.size === asset.size && existing.sha256 === asset.sha256) {
    console.log(`verified ${asset.objectKey}`);
    return;
  }

  const absolutePath = path.join(repositoryRoot, ...asset.localPath.split('/'));
  const details = await stat(absolutePath);
  if (details.size !== asset.size) {
    throw new Error(`Local size changed; regenerate the manifest: ${asset.localPath}`);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: asset.objectKey,
      Body: createReadStream(absolutePath),
      ContentLength: details.size,
      ContentType: 'application/octet-stream',
      Metadata: { sha256: asset.sha256 },
      ...encryptionOptions,
    }),
  );
  console.log(`uploaded ${asset.objectKey}`);
}

async function verify(asset) {
  const existing = await remoteMetadata(asset);
  if (!existing) throw new Error(`Missing remote object: ${asset.objectKey}`);
  if (existing.size !== asset.size || existing.sha256 !== asset.sha256) {
    throw new Error(`Remote verification failed: ${asset.objectKey}`);
  }
  console.log(`verified ${asset.objectKey}`);
}

async function download(asset) {
  const absolutePath = path.join(repositoryRoot, ...asset.localPath.split('/'));
  const temporaryPath = `${absolutePath}.cloud-download`;
  await mkdir(path.dirname(absolutePath), { recursive: true });

  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: asset.objectKey }),
  );
  if (!response.Body) throw new Error(`Empty object body: ${asset.objectKey}`);
  await pipeline(response.Body, createWriteStream(temporaryPath));

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(temporaryPath)) hash.update(chunk);
  if (hash.digest('hex') !== asset.sha256) {
    await unlink(temporaryPath);
    throw new Error(`Downloaded checksum failed: ${asset.objectKey}`);
  }
  await rename(temporaryPath, absolutePath);
  console.log(`downloaded ${asset.localPath}`);
}

for (const asset of manifest.assets) {
  if (action === 'upload') await upload(asset);
  if (action === 'verify') await verify(asset);
  if (action === 'download') await download(asset);
}

console.log(`${action} complete: ${manifest.assetCount} assets.`);
