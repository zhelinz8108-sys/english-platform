import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '@english/database';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function audioFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp3'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort((left, right) => {
      const leftSequence = Number.parseInt(path.basename(left), 10);
      const rightSequence = Number.parseInt(path.basename(right), 10);
      return leftSequence - rightSequence || left.localeCompare(right, 'en');
    });
}

const source = argument('source', process.env.MINUTE_EARTH_SOURCE);
if (!source) throw new Error('Pass --source=<Minute Earth directory>.');

const tenantId = argument('tenant', '0194a000-0000-7000-8000-000000000001');
const collection = 'minute-earth';
const bucket = process.env.S3_BUCKET ?? 'english-platform-private';
const database = createDatabase({
  connectionString:
    process.env.IMPORT_DATABASE_URL ??
    'postgresql://english_owner:english_owner@localhost:55432/english_platform',
  applicationName: 'minute-earth-import',
  maxConnections: 8,
});
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
  },
});

try {
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
  if (!ownerMembershipId)
    throw new Error(`No active owner membership found for tenant ${tenantId}.`);

  const files = await audioFiles(source);
  if (files.length === 0) throw new Error(`No MP3 files found under ${source}.`);
  let imported = 0;
  let skipped = 0;
  let nextIndex = 0;

  async function importNext() {
    while (nextIndex < files.length) {
      const filePath = files[nextIndex++];
      const fileName = path.basename(filePath, path.extname(filePath));
      const parsedSequence = Number.parseInt(fileName, 10);
      if (!Number.isFinite(parsedSequence) || parsedSequence < 1) {
        throw new Error(`Audio filename must start with a positive sequence number: ${filePath}`);
      }
      const existing = await sql`
        select id from toefl_listening_assets
        where tenant_id = ${tenantId}::uuid
          and collection_slug = ${collection}
          and sequence_no = ${parsedSequence}
      `.execute(database.db);
      if (existing.rows[0]) {
        skipped += 1;
        continue;
      }

      const bytes = await readFile(filePath);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const fileId = uuidv7();
      const assetId = uuidv7();
      const objectKey = `tenants/${tenantId}/toefl/listening/${collection}/${String(parsedSequence).padStart(3, '0')}.mp3`;
      const title = fileName.replace(/^\d+\s*[.、_-]?\s*/, '').trim() || fileName;

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

      await database.db.transaction().execute(async (transaction) => {
        await sql`
          insert into file_objects (
            id, tenant_id, storage_key, category, media_type, size_bytes, sha256,
            status, created_by_membership_id, created_at, updated_at
          ) values (
            ${fileId}::uuid, ${tenantId}::uuid, ${objectKey}, 'content_attachment',
            'audio/mpeg', ${bytes.length}, ${sha256}, 'ready',
            ${ownerMembershipId}::uuid, now(), now()
          )
        `.execute(transaction);
        await sql`
          insert into toefl_listening_assets (
            id, tenant_id, file_object_id, collection_slug, sequence_no, title, created_at
          ) values (
            ${assetId}::uuid, ${tenantId}::uuid, ${fileId}::uuid,
            ${collection}, ${parsedSequence}, ${title}, now()
          )
        `.execute(transaction);
      });
      imported += 1;
      if (imported % 25 === 0) console.log(`Imported ${imported}/${files.length} audio files...`);
    }
  }

  await Promise.all(Array.from({ length: 5 }, () => importNext()));
  console.log(`Minute Earth import complete: ${imported} imported, ${skipped} skipped.`);
} finally {
  await database.destroy();
}
