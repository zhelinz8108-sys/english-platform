import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

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

const bucket = process.env.S3_BUCKET;
const prefix = (process.env.BACKUP_S3_PREFIX ?? 'private-archive/database-backups').replace(
  /^\/+|\/+$/g,
  '',
);
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function latestBackup() {
  let continuationToken;
  let latest;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key?.endsWith('.dump') || !object.LastModified) continue;
      if (!latest || object.LastModified > latest.LastModified) latest = object;
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  if (!latest?.Key) throw new Error(`No database dump found below ${prefix}/.`);
  return latest;
}

const workingDirectory = await mkdtemp(path.join(tmpdir(), 'english-platform-restore-check-'));
const dumpPath = path.join(workingDirectory, 'latest.dump');
try {
  const object = await latestBackup();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
  if (!response.Body) throw new Error(`Empty backup body: ${object.Key}`);
  await pipeline(response.Body, createWriteStream(dumpPath));

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(dumpPath)) hash.update(chunk);
  const digest = hash.digest('hex');
  if (response.Metadata?.sha256 && response.Metadata.sha256 !== digest) {
    throw new Error(`SHA-256 mismatch for ${object.Key}.`);
  }
  await run('pg_restore', ['--list', dumpPath]);
  console.log(`Verified latest PostgreSQL backup ${object.Key} (sha256 ${digest}).`);
} finally {
  await rm(workingDirectory, { recursive: true, force: true });
}
