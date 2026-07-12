import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDatabase } from '@english/database';
import { sql } from 'kysely';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function assertEpisode(episode) {
  if (!Number.isInteger(episode?.sequence) || episode.sequence < 1) {
    throw new Error('Every episode must have a positive integer sequence.');
  }
  if (typeof episode.title !== 'string' || !episode.title.trim()) {
    throw new Error(`Episode ${episode.sequence} has no title.`);
  }
  if (typeof episode.transcript !== 'string' || !episode.transcript.trim()) {
    throw new Error(`Episode ${episode.sequence} has no transcript.`);
  }
  if (!Number.isInteger(episode.transcriptWordCount) || episode.transcriptWordCount < 1) {
    throw new Error(`Episode ${episode.sequence} has an invalid transcript word count.`);
  }
  if (!Array.isArray(episode.vocabulary)) {
    throw new Error(`Episode ${episode.sequence} has invalid vocabulary.`);
  }
  for (const entry of episode.vocabulary) {
    if (
      typeof entry?.word !== 'string' ||
      typeof entry?.ipa !== 'string' ||
      typeof entry?.definition !== 'string'
    ) {
      throw new Error(`Episode ${episode.sequence} contains an invalid vocabulary entry.`);
    }
  }
}

const source = argument('source', process.env.MINUTE_EARTH_STUDY_CONTENT_SOURCE);
if (!source) throw new Error('Pass --source=<extracted study-content JSON>.');

const tenantId = argument('tenant', '0194a000-0000-7000-8000-000000000001');
const collection = argument('collection', 'minute-earth');
const database = createDatabase({
  connectionString:
    process.env.IMPORT_DATABASE_URL ??
    'postgresql://english_owner:english_owner@localhost:55432/english_platform',
  applicationName: 'minute-earth-study-content-import',
  maxConnections: 8,
});

try {
  const document = JSON.parse(await readFile(source, 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.episodes)) {
    throw new Error('Unsupported or invalid study-content document.');
  }
  if (document.episodes.length !== 270) {
    throw new Error(`Expected 270 episodes, received ${document.episodes.length}.`);
  }
  if (!/^[0-9a-f]{64}$/u.test(document.source?.sha256 ?? '')) {
    throw new Error('Source PDF SHA-256 is missing or invalid.');
  }
  const sequences = new Set();
  for (const episode of document.episodes) {
    assertEpisode(episode);
    if (sequences.has(episode.sequence)) {
      throw new Error(`Duplicate episode sequence ${episode.sequence}.`);
    }
    sequences.add(episode.sequence);
  }

  let nextIndex = 0;
  let imported = 0;
  async function importNext() {
    while (nextIndex < document.episodes.length) {
      const episode = document.episodes[nextIndex++];
      const asset = await sql`
        select id
        from toefl_listening_assets
        where tenant_id = ${tenantId}::uuid
          and collection_slug = ${collection}
          and sequence_no = ${episode.sequence}
      `.execute(database.db);
      const assetId = asset.rows[0]?.id;
      if (!assetId) {
        throw new Error(`No listening asset found for episode ${episode.sequence}.`);
      }

      await database.db.transaction().execute(async (transaction) => {
        await sql`
          insert into toefl_listening_study_contents (
            tenant_id, listening_asset_id, transcript, transcript_word_count,
            vocabulary, source_file_name, source_sha256, created_at, updated_at
          ) values (
            ${tenantId}::uuid, ${assetId}::uuid, ${episode.transcript},
            ${episode.transcriptWordCount}, ${JSON.stringify(episode.vocabulary)}::jsonb,
            ${path.basename(document.source.fileName)}, ${document.source.sha256}, now(), now()
          )
          on conflict (tenant_id, listening_asset_id) do update set
            transcript = excluded.transcript,
            transcript_word_count = excluded.transcript_word_count,
            vocabulary = excluded.vocabulary,
            source_file_name = excluded.source_file_name,
            source_sha256 = excluded.source_sha256,
            updated_at = now()
        `.execute(transaction);
        await sql`
          update toefl_listening_assets
          set title = ${episode.title}, duration_seconds = ${episode.durationSeconds}
          where tenant_id = ${tenantId}::uuid and id = ${assetId}::uuid
        `.execute(transaction);
      });

      imported += 1;
      if (imported % 25 === 0) {
        console.log(`Imported ${imported}/${document.episodes.length} study records...`);
      }
    }
  }

  await Promise.all(Array.from({ length: 5 }, () => importNext()));
  console.log(`Minute Earth study-content import complete: ${imported} records.`);
} finally {
  await database.destroy();
}
