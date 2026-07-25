import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '@english/database';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function compactText(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function listeningSourceHash(item) {
  const canonical = JSON.stringify({
    collection: compactText(item.collection),
    durationSeconds: item.durationSeconds,
    sourceId: compactText(item.id),
    title: compactText(item.title),
    transcript: item.transcript,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function assertItem(item) {
  if (typeof item?.id !== 'string' || !item.id.trim())
    throw new Error('Item source ID is missing.');
  if (!Number.isInteger(item.sequence) || item.sequence < 1) {
    throw new Error(`Item ${item.id} has an invalid sequence.`);
  }
  if (typeof item.title !== 'string' || !item.title.trim()) {
    throw new Error(`Item ${item.id} has no title.`);
  }
  if (typeof item.audioPath !== 'string' || !item.audioPath.trim()) {
    throw new Error(`Item ${item.id} has no audio path.`);
  }
  if (typeof item.transcript !== 'string' || !item.transcript.trim()) {
    throw new Error(`Item ${item.id} has no transcript.`);
  }
  if (!Number.isInteger(item.transcriptWordCount) || item.transcriptWordCount < 1) {
    throw new Error(`Item ${item.id} has an invalid transcript word count.`);
  }
  if (!Array.isArray(item.vocabulary)) {
    throw new Error(`Item ${item.id} has invalid vocabulary.`);
  }
  if (item.publishedAt !== null && !/^\d{8}$/u.test(item.publishedAt)) {
    throw new Error(`Item ${item.id} has an invalid publication date.`);
  }
}

const defaultLibraryPath = fileURLToPath(
  new URL('../../web/data/listening-library.json', import.meta.url),
);
const libraryPath = path.resolve(argument('library', defaultLibraryPath));
const sourceRootArgument = argument('source-root', process.env.LISTENING_SOURCE_ROOT);
const collection = argument('collection');
if (!collection) throw new Error('Pass --collection=<collection ID>.');
const replace = argument('replace', 'false') === 'true';
const validateOnly = argument('validate-only', 'false') === 'true';
const uploadOnly = argument('upload-only', 'false') === 'true';
const registerOnly = argument('register-only', 'false') === 'true';
if (uploadOnly && registerOnly) {
  throw new Error('--upload-only and --register-only cannot be used together.');
}
if (validateOnly && registerOnly) {
  throw new Error('--validate-only cannot be used with --register-only.');
}
if (!sourceRootArgument && !registerOnly) {
  throw new Error('Pass --source-root=<listening collection directory>.');
}
const sourceRoot = sourceRootArgument ? path.resolve(sourceRootArgument) : null;
const concurrency = Number.parseInt(argument('concurrency', '6'), 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
  throw new Error('Concurrency must be an integer from 1 to 16.');
}

const tenantId = argument('tenant', '0194a000-0000-7000-8000-000000000001');
const bucket = process.env.S3_BUCKET ?? 'english-platform-private';
const database = uploadOnly
  ? null
  : createDatabase({
      connectionString:
        process.env.IMPORT_DATABASE_URL ??
        process.env.DATABASE_ADMIN_URL ??
        process.env.DATABASE_URL ??
        'postgresql://english_owner:english_owner@localhost:55432/english_platform',
      applicationName: 'listening-library-import',
      maxConnections: Math.max(8, concurrency + 2),
    });
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
});

async function objectMetadata(objectKey, { tolerateForbidden = false } = {}) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
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

try {
  const library = JSON.parse(await readFile(libraryPath, 'utf8'));
  const items = library.items?.filter((item) => item.collection === collection) ?? [];
  if (items.length === 0) throw new Error(`Collection ${collection} is empty or missing.`);

  const sequences = new Set();
  const sources = new Set();
  const prepared = [];
  for (const item of items) {
    assertItem(item);
    if (sequences.has(item.sequence)) throw new Error(`Duplicate sequence ${item.sequence}.`);
    if (sources.has(item.id)) throw new Error(`Duplicate source ID ${item.id}.`);
    sequences.add(item.sequence);
    sources.add(item.id);
    if (registerOnly) {
      prepared.push({ item, audioFile: null, sizeBytes: null });
    } else {
      const audioFile = path.resolve(sourceRoot, ...item.audioPath.split('/'));
      const info = await stat(audioFile).catch(() => null);
      if (!info?.isFile()) throw new Error(`Audio file is missing: ${audioFile}`);
      prepared.push({ item, audioFile, sizeBytes: info.size });
    }
  }
  if (validateOnly) {
    const totalBytes = prepared.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    console.log(
      `Validated ${prepared.length} ${collection} records (${(totalBytes / 1024 / 1024).toFixed(1)} MB).`,
    );
    process.exitCode = 0;
  } else if (uploadOnly) {
    let nextIndex = 0;
    let completed = 0;
    let uploaded = 0;
    let reused = 0;

    async function uploadNext() {
      while (nextIndex < prepared.length) {
        const { item, audioFile, sizeBytes } = prepared[nextIndex++];
        const objectKey = `tenants/${tenantId}/toefl/listening/${collection}/${String(item.sequence).padStart(4, '0')}.mp3`;
        const current = await objectMetadata(objectKey, { tolerateForbidden: true });
        const currentSize = Number(current?.ContentLength);
        const currentSha256 = current?.Metadata?.sha256;
        const currentFileId = current?.Metadata?.['file-id'];

        if (!replace && current && currentSize === sizeBytes && currentSha256 && currentFileId) {
          reused += 1;
        } else {
          const bytes = await readFile(audioFile);
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          const fileId = currentFileId ?? uuidv7();
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: objectKey,
              Body: bytes,
              ContentType: 'audio/mpeg',
              ContentLength: bytes.length,
              Metadata: { sha256, 'tenant-id': tenantId, 'file-id': fileId },
            }),
          );
          uploaded += 1;
        }

        completed += 1;
        if (completed % 25 === 0 || completed === prepared.length) {
          console.log(`Uploaded ${completed}/${prepared.length} ${collection} records...`);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => uploadNext()));
    console.log(
      `Listening audio upload complete: ${completed} records, ${uploaded} uploaded, ${reused} reused.`,
    );
  } else {
    const membership = await sql`
    select membership.id
    from tenant_memberships membership
    join membership_role_assignments assignment
      on assignment.tenant_id = membership.tenant_id
     and assignment.membership_id = membership.id
    join membership_roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where membership.tenant_id = ${tenantId}::uuid
      and membership.status = 'active' and role.code = 'owner'
    order by membership.created_at
    limit 1
  `.execute(database.db);
    const ownerMembershipId = membership.rows[0]?.id;
    if (!ownerMembershipId) {
      throw new Error(`No active owner membership found for tenant ${tenantId}.`);
    }

    let nextIndex = 0;
    let completed = 0;
    let uploaded = 0;
    let reused = 0;

    async function importNext() {
      while (nextIndex < prepared.length) {
        const { item, audioFile, sizeBytes: preparedSizeBytes } = prepared[nextIndex++];
        const existing = await sql`
        select asset.id, asset.file_object_id, file.storage_key, file.status
        from toefl_listening_assets asset
        join file_objects file
          on file.tenant_id = asset.tenant_id and file.id = asset.file_object_id
        where asset.tenant_id = ${tenantId}::uuid
          and (asset.source_id = ${item.id}
            or (asset.collection_slug = ${collection} and asset.sequence_no = ${item.sequence}))
        order by (asset.source_id = ${item.id}) desc
        limit 1
      `.execute(database.db);
        const current = existing.rows[0];
        let fileId = current?.file_object_id ?? uuidv7();
        const assetId = current?.id ?? uuidv7();
        let objectKey =
          current?.storage_key ??
          `tenants/${tenantId}/toefl/listening/${collection}/${String(item.sequence).padStart(4, '0')}.mp3`;

        let sizeBytes = preparedSizeBytes;
        let sha256 = null;
        if (registerOnly) {
          const defaultObjectKey = `tenants/${tenantId}/toefl/listening/${collection}/${String(item.sequence).padStart(4, '0')}.mp3`;
          let metadata = await objectMetadata(objectKey);
          if (!metadata && objectKey !== defaultObjectKey) {
            objectKey = defaultObjectKey;
            metadata = await objectMetadata(objectKey);
          }
          if (!metadata) {
            throw new Error(`Uploaded audio object is missing: ${objectKey}`);
          }
          sizeBytes = Number(metadata.ContentLength);
          sha256 = metadata.Metadata?.sha256 ?? null;
          const storedFileId = metadata.Metadata?.['file-id'];
          if (!current && !storedFileId) {
            throw new Error(`Uploaded audio object has no file-id metadata: ${objectKey}`);
          }
          fileId = current?.file_object_id ?? storedFileId;
          reused += 1;
        } else if (!current || replace || current.status !== 'ready') {
          const bytes = await readFile(audioFile);
          sha256 = createHash('sha256').update(bytes).digest('hex');
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: objectKey,
              Body: bytes,
              ContentType: 'audio/mpeg',
              ContentLength: bytes.length,
              Metadata: { sha256, 'tenant-id': tenantId, 'file-id': fileId },
            }),
          );
          uploaded += 1;
        } else {
          reused += 1;
        }

        await database.db.transaction().execute(async (transaction) => {
          if (current) {
            if (sha256) {
              await sql`
              update file_objects
              set size_bytes = ${sizeBytes}, sha256 = ${sha256}, status = 'ready', updated_at = now()
              where tenant_id = ${tenantId}::uuid and id = ${fileId}::uuid
            `.execute(transaction);
            }
            await sql`
            update toefl_listening_assets
            set source_id = ${item.id}, collection_slug = ${collection},
                sequence_no = ${item.sequence}, title = ${item.title},
                duration_seconds = ${item.durationSeconds}, published_at = ${item.publishedAt}
            where tenant_id = ${tenantId}::uuid and id = ${assetId}::uuid
          `.execute(transaction);
          } else {
            await sql`
            insert into file_objects (
              id, tenant_id, storage_key, category, media_type, size_bytes, sha256,
              status, created_by_membership_id, created_at, updated_at
            ) values (
              ${fileId}::uuid, ${tenantId}::uuid, ${objectKey}, 'content_attachment',
              'audio/mpeg', ${sizeBytes}, ${sha256}, 'ready',
              ${ownerMembershipId}::uuid, now(), now()
            )
          `.execute(transaction);
            await sql`
            insert into toefl_listening_assets (
              id, tenant_id, file_object_id, source_id, collection_slug, sequence_no,
              title, duration_seconds, published_at, created_at
            ) values (
              ${assetId}::uuid, ${tenantId}::uuid, ${fileId}::uuid, ${item.id},
              ${collection}, ${item.sequence}, ${item.title}, ${item.durationSeconds},
              ${item.publishedAt}, now()
            )
          `.execute(transaction);
          }

          await sql`
          insert into toefl_listening_study_contents (
            tenant_id, listening_asset_id, transcript, transcript_word_count,
            vocabulary, source_file_name, source_sha256, created_at, updated_at
          ) values (
            ${tenantId}::uuid, ${assetId}::uuid, ${item.transcript},
            ${item.transcriptWordCount}, ${JSON.stringify(item.vocabulary)}::jsonb,
            ${path.basename(libraryPath)}, ${listeningSourceHash(item)}, now(), now()
          )
          on conflict (tenant_id, listening_asset_id) do update set
            transcript = excluded.transcript,
            transcript_word_count = excluded.transcript_word_count,
            vocabulary = excluded.vocabulary,
            source_file_name = excluded.source_file_name,
            source_sha256 = excluded.source_sha256,
            updated_at = now()
        `.execute(transaction);
        });

        completed += 1;
        if (completed % 25 === 0 || completed === prepared.length) {
          console.log(`Imported ${completed}/${prepared.length} ${collection} records...`);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => importNext()));
    console.log(
      `Listening library import complete: ${completed} records, ${uploaded} uploaded, ${reused} reused.`,
    );
  }
} finally {
  if (database) await database.destroy();
}
