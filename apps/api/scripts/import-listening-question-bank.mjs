import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '@english/database';
import { sql } from 'kysely';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function compactText(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function listeningSourceHash(item) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        collection: compactText(item.collection),
        durationSeconds: item.durationSeconds,
        sourceId: compactText(item.id),
        title: compactText(item.title),
        transcript: item.transcript,
      }),
      'utf8',
    )
    .digest('hex');
}

const defaultLibraryPath = fileURLToPath(
  new URL('../../web/data/listening-library.json', import.meta.url),
);
const defaultBankPath = fileURLToPath(
  new URL('../../web/data/toefl-academic-listening-questions/question-bank.json', import.meta.url),
);
const libraryPath = path.resolve(argument('library', defaultLibraryPath));
const bankPath = path.resolve(argument('question-bank', defaultBankPath));
const tenantId = argument('tenant', '0194a000-0000-7000-8000-000000000001');
const database = createDatabase({
  connectionString:
    process.env.IMPORT_DATABASE_URL ??
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    'postgresql://english_owner:english_owner@localhost:55432/english_platform',
  applicationName: 'listening-question-bank-import',
  maxConnections: 8,
});

try {
  const library = JSON.parse(await readFile(libraryPath, 'utf8'));
  const bank = JSON.parse(await readFile(bankPath, 'utf8'));
  if (
    bank.schemaVersion !== 1 ||
    typeof bank.skillVersion !== 'string' ||
    !Array.isArray(bank.sets)
  ) {
    throw new Error('Unsupported or invalid listening question bank.');
  }
  const contentGeneratedAt = new Date(bank.generatedAt);
  if (Number.isNaN(contentGeneratedAt.getTime())) {
    throw new Error('Question bank generatedAt is invalid.');
  }
  const itemById = new Map(library.items.map((item) => [item.id, item]));
  const readyStatuses = new Set(['reviewed', 'adjudicated', 'approved']);
  const prepared = [];
  const seen = new Set();
  for (const set of bank.sets) {
    if (!readyStatuses.has(set.status)) continue;
    if (seen.has(set.sourceId)) throw new Error(`Duplicate question set ${set.sourceId}.`);
    seen.add(set.sourceId);
    const item = itemById.get(set.sourceId);
    if (!item) throw new Error(`Question source ${set.sourceId} is missing from the library.`);
    if (set.collection !== item.collection) {
      throw new Error(`Question source ${set.sourceId} has a collection mismatch.`);
    }
    if (set.sourceHash !== listeningSourceHash(item)) {
      throw new Error(`Question source ${set.sourceId} has a stale source hash.`);
    }
    if (!Array.isArray(set.questions) || set.questions.length !== 4) {
      throw new Error(`Question source ${set.sourceId} must contain exactly four questions.`);
    }
    prepared.push(set);
  }

  let imported = 0;
  for (const set of prepared) {
    const asset = await sql`
      select id
      from toefl_listening_assets
      where tenant_id = ${tenantId}::uuid and source_id = ${set.sourceId}
    `.execute(database.db);
    const assetId = asset.rows[0]?.id;
    if (!assetId) throw new Error(`No listening asset found for ${set.sourceId}.`);

    await sql`
      insert into toefl_listening_question_sets (
        tenant_id, listening_asset_id, source_hash, label, exact_simulation,
        review_status, questions, skill_version, content_generated_at, created_at, updated_at
      ) values (
        ${tenantId}::uuid, ${assetId}::uuid, ${set.sourceHash}, ${set.label},
        ${set.exactSimulation}, ${set.status}, ${JSON.stringify(set.questions)}::jsonb,
        ${bank.skillVersion}, ${contentGeneratedAt.toISOString()}::timestamptz, now(), now()
      )
      on conflict (tenant_id, listening_asset_id) do update set
        source_hash = excluded.source_hash,
        label = excluded.label,
        exact_simulation = excluded.exact_simulation,
        review_status = excluded.review_status,
        questions = excluded.questions,
        skill_version = excluded.skill_version,
        content_generated_at = excluded.content_generated_at,
        updated_at = now()
    `.execute(database.db);
    imported += 1;
    if (imported % 50 === 0 || imported === prepared.length) {
      console.log(`Imported ${imported}/${prepared.length} listening question sets...`);
    }
  }
  console.log(`Listening question-bank import complete: ${imported} ready sets.`);
} finally {
  await database.destroy();
}
