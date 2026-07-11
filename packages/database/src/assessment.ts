import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

import type { Database, QuestionVersionsTable } from './types.js';

type Executor = Kysely<Database> | Transaction<Database>;

export interface AttemptSnapshotCreation {
  snapshotHash: string;
  itemCount: number;
}

export interface QuestionPublication {
  contentHash: string;
  publishedAt: Date;
  questionId: string;
}

export async function createAttemptSnapshots(
  executor: Executor,
  attemptId: string,
): Promise<AttemptSnapshotCreation> {
  const result = await sql<{
    snapshot_hash: string;
    item_count: number;
  }>`
    select snapshot_hash, item_count
    from app.create_attempt_snapshots(${attemptId}::uuid)
  `.execute(executor);
  const row = result.rows[0];
  if (!row) {
    throw new Error('Attempt snapshot function returned no row');
  }
  return { snapshotHash: row.snapshot_hash, itemCount: row.item_count };
}

export async function publishQuestionVersion(
  executor: Executor,
  questionVersionId: string,
): Promise<QuestionPublication> {
  const result = await sql<{
    content_hash: string;
    published_at: Date;
    question_id: string;
  }>`
    select content_hash, published_at, question_id
    from app.publish_question_version(${questionVersionId}::uuid)
  `.execute(executor);
  const row = result.rows[0];
  if (!row) {
    throw new Error('Question publication function returned no row');
  }
  return {
    contentHash: row.content_hash,
    publishedAt: row.published_at,
    questionId: row.question_id,
  };
}

export async function getQuestionVersionsForAuthoring(
  executor: Executor,
  questionId: string,
): Promise<Selectable<QuestionVersionsTable>[]> {
  return (
    await sql<Selectable<QuestionVersionsTable>>`
      select *
      from app.get_question_versions_for_authoring(${questionId}::uuid)
    `.execute(executor)
  ).rows;
}
