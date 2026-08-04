import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import { DatabaseService } from '../infrastructure/database.service.js';
import {
  publicListeningQuestionSet,
  readyListeningQuestionSet,
  scoreListeningAnswers,
} from './listening-questions.js';

function requestContext(request: ApiRequest) {
  const principal = requirePrincipal(request);
  const tenant = requireTenant(request);
  return {
    tenantId: tenant.tenantId,
    userId: principal.userId,
    membershipId: tenant.membershipId,
  };
}

@Injectable()
export class LearningService {
  private readonly publicS3: S3Client;

  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.publicS3 = new S3Client({
      region: config.values.S3_REGION,
      endpoint: config.s3PublicEndpoint,
      forcePathStyle: config.values.S3_FORCE_PATH_STYLE,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: config.values.S3_ACCESS_KEY,
        secretAccessKey: config.values.S3_SECRET_KEY,
      },
    });
  }

  listListening(
    request: ApiRequest,
    input: {
      collection?:
        | 'bbc-english-in-a-minute'
        | 'bbc-6-minute-english'
        | 'voa-standard-english'
        | 'minute-earth'
        | 'scientific-american-60-second'
        | 'short-wave'
        | undefined;
      query?: string | undefined;
      pageSize: number;
    },
  ) {
    const context = requestContext(request);
    return this.database.withTenant(context, async (transaction) => {
      const search = input.query ? `%${input.query}%` : null;
      const collection = input.collection ?? null;
      const resultLimit = input.pageSize + 1;
      const result = await sql<{
        id: string;
        source_id: string;
        collection_slug: string;
        sequence_no: number;
        title: string;
        duration_seconds: number | null;
        published_at: string | null;
        size_bytes: string;
        has_study_content: boolean;
        transcript_word_count: number | null;
        vocabulary_count: number;
      }>`
        select asset.id, asset.source_id, asset.collection_slug, asset.sequence_no, asset.title,
               asset.duration_seconds, asset.published_at, file.size_bytes,
               (study.id is not null) as has_study_content,
               study.transcript_word_count,
               coalesce(jsonb_array_length(study.vocabulary), 0)::integer as vocabulary_count
        from toefl_listening_assets asset
        join file_objects file
          on file.tenant_id = asset.tenant_id and file.id = asset.file_object_id
        left join toefl_listening_study_contents study
          on study.tenant_id = asset.tenant_id and study.listening_asset_id = asset.id
        where asset.tenant_id = ${context.tenantId}::uuid
          and file.status = 'ready'
          and (${collection}::text is null or asset.collection_slug = ${collection})
          and (${search}::text is null or asset.title ilike ${search})
        order by asset.collection_slug, asset.sequence_no
        limit ${resultLimit}
      `.execute(transaction);

      const collectionResult = await sql<{ collection_slug: string; item_count: number }>`
        select asset.collection_slug, count(*)::integer as item_count
        from toefl_listening_assets asset
        join file_objects file
          on file.tenant_id = asset.tenant_id and file.id = asset.file_object_id
        where asset.tenant_id = ${context.tenantId}::uuid and file.status = 'ready'
        group by asset.collection_slug
      `.execute(transaction);
      const counts = new Map(
        collectionResult.rows.map((row) => [row.collection_slug, row.item_count]),
      );
      const rows = result.rows.slice(0, input.pageSize);

      return {
        data: rows.map((row) => ({
          id: row.id,
          sourceId: row.source_id,
          collection: row.collection_slug,
          sequence: row.sequence_no,
          title: row.title,
          publishedAt: row.published_at,
          durationSeconds: row.duration_seconds,
          sizeBytes: Number(row.size_bytes),
          hasStudyContent: row.has_study_content,
          transcriptWordCount: row.transcript_word_count,
          vocabularyCount: row.vocabulary_count,
        })),
        collections: [
          {
            id: 'bbc-english-in-a-minute',
            label: 'BBC 一分钟英语',
            description: '一分钟语法与用法短讲，适合建立基础听辨与高频表达。',
            difficulty: 'A2',
            audience: '初一–初二',
            rank: 1,
            count: counts.get('bbc-english-in-a-minute') ?? 0,
          },
          {
            id: 'bbc-6-minute-english',
            label: 'BBC 6 Minute English',
            description: 'BBC 六分钟英语，含音频、原版对话稿和重点词汇。',
            difficulty: 'B1–B2',
            audience: '初三优秀生–高中',
            rank: 2,
            count: counts.get('bbc-6-minute-english') ?? 0,
          },
          {
            id: 'voa-standard-english',
            label: 'VOA 常速英语新闻',
            description: '常速国际新闻报道，配套英文逐字稿，训练真实新闻语速。',
            difficulty: 'B2',
            audience: '高一–高二',
            rank: 3,
            count: counts.get('voa-standard-english') ?? 0,
          },
          {
            id: 'minute-earth',
            label: 'MinuteEarth',
            description: '科学与地理主题短篇，含音频、英文原文和 TOEFL/SAT 词汇。',
            difficulty: 'B2',
            audience: '高中；配合画面更易理解',
            rank: 4,
            count: counts.get('minute-earth') ?? 0,
          },
          {
            id: 'scientific-american-60-second',
            label: '科学美国人 60 秒',
            description: '一分钟科学新闻与研究解读，语速快、信息密度高。',
            difficulty: 'B2+–C1',
            audience: '高中优秀生–大学',
            rank: 5,
            count: counts.get('scientific-american-60-second') ?? 0,
          },
          {
            id: 'short-wave',
            label: 'Short Wave',
            description: 'NPR 科学播客，包含自然对话、采访与完整英文逐字稿。',
            difficulty: 'B2+–C1',
            audience: '高中优秀生–大学',
            rank: 6,
            count: counts.get('short-wave') ?? 0,
          },
        ],
        page: {
          nextCursor: null,
          hasMore: result.rows.length > input.pageSize,
          limit: input.pageSize,
        },
      };
    });
  }

  getListeningStudyContent(request: ApiRequest, assetId: string) {
    const context = requestContext(request);
    return this.database.withTenant(context, async (transaction) => {
      const result = await sql<{
        id: string;
        source_id: string;
        collection_slug: string;
        sequence_no: number;
        title: string;
        duration_seconds: number | null;
        transcript: string | null;
        transcript_word_count: number | null;
        vocabulary: unknown | null;
        question_source_hash: string | null;
        question_label: string | null;
        question_exact_simulation: boolean | null;
        question_review_status: string | null;
        question_questions: unknown | null;
      }>`
        select asset.id, asset.source_id, asset.collection_slug, asset.sequence_no, asset.title,
               asset.duration_seconds, study.transcript, study.transcript_word_count,
               study.vocabulary, question_set.source_hash as question_source_hash,
               question_set.label as question_label,
               question_set.exact_simulation as question_exact_simulation,
               question_set.review_status as question_review_status,
               question_set.questions as question_questions
        from toefl_listening_assets asset
        left join toefl_listening_study_contents study
          on study.tenant_id = asset.tenant_id and study.listening_asset_id = asset.id
        left join toefl_listening_question_sets question_set
          on question_set.tenant_id = asset.tenant_id
         and question_set.listening_asset_id = asset.id
        where asset.tenant_id = ${context.tenantId}::uuid
          and asset.id = ${assetId}::uuid
      `.execute(transaction);
      const row = result.rows[0];
      if (!row) throw ProblemException.notFound();
      const transcript = row.transcript ?? '';
      const readyQuestionSet = row.transcript
        ? readyListeningQuestionSet(
            {
              sourceId: row.source_id,
              collection: row.collection_slug,
              title: row.title,
              durationSeconds: row.duration_seconds,
              transcript,
            },
            row.question_source_hash &&
              row.question_label &&
              row.question_exact_simulation !== null &&
              row.question_review_status &&
              row.question_questions
              ? {
                  sourceHash: row.question_source_hash,
                  label: row.question_label,
                  exactSimulation: row.question_exact_simulation,
                  reviewStatus: row.question_review_status,
                  questions: row.question_questions,
                }
              : null,
          )
        : null;
      const questionBankStatus = !row.transcript
        ? 'missing-transcript'
        : readyQuestionSet
          ? 'ready'
          : 'generating';
      return {
        id: row.id,
        sequence: row.sequence_no,
        title: row.title,
        durationSeconds: row.duration_seconds,
        transcriptWordCount: row.transcript_word_count ?? 0,
        transcript,
        vocabulary: Array.isArray(row.vocabulary) ? row.vocabulary : [],
        studyAidsLocked: false,
        questionBankStatus,
        questionSet: readyQuestionSet ? publicListeningQuestionSet(readyQuestionSet) : null,
      };
    });
  }

  checkListeningAnswers(
    request: ApiRequest,
    assetId: string,
    submittedAnswers: Record<string, 'a' | 'b' | 'c' | 'd'>,
  ) {
    const context = requestContext(request);
    return this.database.withTenant(context, async (transaction) => {
      const result = await sql<{
        source_id: string;
        collection_slug: string;
        title: string;
        duration_seconds: number | null;
        transcript: string;
        transcript_word_count: number;
        vocabulary: unknown;
        source_hash: string;
        label: string;
        exact_simulation: boolean;
        review_status: string;
        questions: unknown;
      }>`
        select asset.source_id, asset.collection_slug, asset.title, asset.duration_seconds,
               study.transcript, study.transcript_word_count, study.vocabulary,
               question_set.source_hash, question_set.label, question_set.exact_simulation,
               question_set.review_status, question_set.questions
        from toefl_listening_assets asset
        join toefl_listening_study_contents study
          on study.tenant_id = asset.tenant_id and study.listening_asset_id = asset.id
        join toefl_listening_question_sets question_set
          on question_set.tenant_id = asset.tenant_id
         and question_set.listening_asset_id = asset.id
        where asset.tenant_id = ${context.tenantId}::uuid
          and asset.id = ${assetId}::uuid
      `.execute(transaction);
      const row = result.rows[0];
      if (!row) throw ProblemException.notFound();
      const readyQuestionSet = readyListeningQuestionSet(
        {
          sourceId: row.source_id,
          collection: row.collection_slug,
          title: row.title,
          durationSeconds: row.duration_seconds,
          transcript: row.transcript,
        },
        {
          sourceHash: row.source_hash,
          label: row.label,
          exactSimulation: row.exact_simulation,
          reviewStatus: row.review_status,
          questions: row.questions,
        },
      );
      if (!readyQuestionSet) {
        throw ProblemException.conflict(
          'listening_question_bank_not_ready',
          'The listening question bank is not ready for this source.',
        );
      }
      const score = scoreListeningAnswers(readyQuestionSet, submittedAnswers, row.transcript);
      if (score.answeredCount !== score.totalCount) {
        throw ProblemException.badRequest(
          'incomplete_listening_answers',
          'Complete all four questions before submitting.',
        );
      }
      return {
        sourceId: row.source_id,
        ...score,
        reviewStatus: readyQuestionSet.reviewStatus,
        studyAids: {
          transcriptWordCount: row.transcript_word_count,
          transcript: row.transcript,
          vocabulary: Array.isArray(row.vocabulary) ? row.vocabulary : [],
        },
      };
    });
  }

  async createPlaybackUrl(request: ApiRequest, assetId: string) {
    const context = requestContext(request);
    const asset = await this.database.withTenant(context, async (transaction) => {
      const result = await sql<{ storage_key: string; media_type: string }>`
        select file.storage_key, file.media_type
        from toefl_listening_assets asset
        join file_objects file
          on file.tenant_id = asset.tenant_id and file.id = asset.file_object_id
        where asset.tenant_id = ${context.tenantId}::uuid
          and asset.id = ${assetId}::uuid
          and file.status = 'ready'
      `.execute(transaction);
      return result.rows[0];
    });
    if (!asset) throw ProblemException.notFound();

    const expiresIn = 3600;
    const url = await getSignedUrl(
      this.publicS3,
      new GetObjectCommand({
        Bucket: this.config.values.S3_BUCKET,
        Key: asset.storage_key,
        ResponseCacheControl: 'private, max-age=3600',
      }),
      { expiresIn },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }
}
