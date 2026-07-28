import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const requiredEnvironment = [
  'DATABASE_ADMIN_URL',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const databaseUrl = new URL(process.env.DATABASE_ADMIN_URL);
const bucket = process.env.S3_BUCKET;
const prefix = (process.env.BACKUP_S3_PREFIX ?? 'private-archive/database-backups').replace(
  /^\/+|\/+$/g,
  '',
);
const intervalSeconds = Number(process.env.BACKUP_INTERVAL_SECONDS ?? 86_400);
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const loop = process.argv.includes('--loop');
const encryption = process.env.BACKUP_S3_SSE ?? 'AES256';
const encryptionOptions =
  encryption && encryption !== 'none' ? { ServerSideEncryption: encryption } : {};
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

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function pruneOldBackups() {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key && object.LastModified && object.LastModified.getTime() < cutoff) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
        console.log(`Deleted expired backup ${object.Key}.`);
      }
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
}

async function backup() {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'english-platform-backup-'));
  const dumpPath = path.join(workingDirectory, 'english-platform.dump');
  try {
    await run(
      'pg_dump',
      [
        '--host',
        databaseUrl.hostname,
        '--port',
        databaseUrl.port || '5432',
        '--username',
        decodeURIComponent(databaseUrl.username),
        '--dbname',
        decodeURIComponent(databaseUrl.pathname.slice(1)),
        '--format',
        'custom',
        '--compress',
        '9',
        '--no-owner',
        '--no-acl',
        '--file',
        dumpPath,
      ],
      {
        env: {
          ...process.env,
          PGPASSWORD: decodeURIComponent(databaseUrl.password),
        },
      },
    );

    const details = await stat(dumpPath);
    const digest = await sha256(dumpPath);
    const key = `${prefix}/english-platform-${timestamp()}.dump`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(dumpPath),
        ContentLength: details.size,
        ContentType: 'application/octet-stream',
        Metadata: { sha256: digest, database: 'english_platform' },
        ...encryptionOptions,
      }),
    );
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${key}.json`,
        Body: JSON.stringify(
          {
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            database: 'english_platform',
            dumpKey: key,
            size: details.size,
            sha256: digest,
          },
          null,
          2,
        ),
        ContentType: 'application/json',
        ...encryptionOptions,
      }),
    );
    console.log(`Uploaded PostgreSQL backup ${key} (${details.size} bytes).`);
    try {
      await pruneOldBackups();
    } catch (error) {
      console.warn(`Backup retention cleanup skipped: ${error.message}`);
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

do {
  try {
    await backup();
  } catch (error) {
    console.error(`Production backup failed: ${error.stack ?? error.message}`);
    if (!loop) process.exitCode = 1;
  }
  if (!loop) break;
  await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
} while (true);
