import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import { alevelCatalog } from './alevel-catalog.generated.js';
import type {
  AlevelDocumentPayload,
  AlevelDocumentSummary,
  AlevelSubject,
  AlevelSubjectIndex,
} from './alevel-types.js';

const catalog = alevelCatalog;
const subjectsById = new Map<string, AlevelSubject>(
  catalog.subjects.map((subject) => [subject.id, subject]),
);

export interface AlevelDocumentQuery {
  q?: string;
  year?: string;
  session?: string;
  level?: string;
  paper?: string;
  variant?: string;
  collection?: string;
  page?: string;
  pageSize?: string;
}

function authorize(request: ApiRequest): void {
  requirePrincipal(request);
  requireTenant(request);
}

function integer(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

@Injectable()
export class AlevelLibraryService {
  private readonly s3: S3Client;
  private readonly subjectCache = new Map<string, Promise<AlevelSubjectIndex>>();

  constructor(@Inject(AppConfig) private readonly config: AppConfig) {
    this.s3 = new S3Client({
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

  catalog(request: ApiRequest) {
    authorize(request);
    return catalog;
  }

  private async gzipJson<T>(key: string): Promise<T> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.values.S3_BUCKET, Key: key }),
    );
    if (!response.Body) throw ProblemException.notFound('A Level 题库资源不存在。');
    const compressed = Buffer.from(await response.Body.transformToByteArray());
    return JSON.parse(gunzipSync(compressed).toString('utf8')) as T;
  }

  private subjectIndex(subjectId: string): Promise<AlevelSubjectIndex> {
    const subject = subjectsById.get(subjectId);
    if (!subject) throw ProblemException.notFound('没有找到这个 A Level 科目。');
    const cached = this.subjectCache.get(subjectId);
    if (cached) return cached;
    const pending = this.gzipJson<AlevelSubjectIndex>(subject.indexStorageKey).catch((error) => {
      this.subjectCache.delete(subjectId);
      throw error;
    });
    this.subjectCache.set(subjectId, pending);
    return pending;
  }

  async documents(request: ApiRequest, subjectId: string, query: AlevelDocumentQuery) {
    authorize(request);
    const index = await this.subjectIndex(subjectId);
    const page = Math.max(1, integer(query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, integer(query.pageSize) ?? 40));
    const q = query.q?.trim().toLowerCase() ?? '';
    const year = integer(query.year);
    const paper = integer(query.paper);
    const variant = integer(query.variant);
    const collection = query.collection ?? 'past-paper';
    const visibleTypes =
      collection === 'topic'
        ? new Set(['topic_question'])
        : collection === 'support'
          ? new Set([
              'reference',
              'syllabus',
              'grade_threshold',
              'examiner_report',
              'supporting_file',
            ])
          : new Set(['question']);
    const filtered = index.documents.filter(
      (document) =>
        visibleTypes.has(document.documentType) &&
        (year === undefined || document.year === year) &&
        (!query.session || document.session === query.session) &&
        (!query.level || document.level === query.level) &&
        (paper === undefined || document.paper === paper) &&
        (variant === undefined || document.variant === variant) &&
        (!q ||
          `${document.title} ${document.relativePath} ${document.syllabusCode ?? ''}`
            .toLowerCase()
            .includes(q)),
    );
    filtered.sort((left, right) => {
      const yearOrder = (right.year ?? 0) - (left.year ?? 0);
      if (yearOrder) return yearOrder;
      return left.title.localeCompare(right.title, 'en');
    });
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    return {
      subject: index.subject,
      items,
      total: filtered.length,
      page,
      pageSize,
      facets: {
        years: [...new Set(index.documents.map((item) => item.year).filter(Boolean))].sort(
          (left, right) => Number(right) - Number(left),
        ),
        sessions: [...new Set(index.documents.map((item) => item.session).filter(Boolean))],
        levels: [...new Set(index.documents.map((item) => item.level).filter(Boolean))],
        papers: [...new Set(index.documents.map((item) => item.paper).filter(Boolean))].sort(
          (left, right) => Number(left) - Number(right),
        ),
      },
    };
  }

  private metadataKey(documentId: string): string {
    if (!/^[a-f0-9]{24}$/u.test(documentId)) throw ProblemException.notFound();
    return `${catalog.storagePrefix}/documents/${documentId}.json.gz`;
  }

  async document(request: ApiRequest, documentId: string): Promise<AlevelDocumentPayload> {
    authorize(request);
    return this.gzipJson<AlevelDocumentPayload>(this.metadataKey(documentId));
  }

  async resourceUrl(request: ApiRequest, resourceId: string) {
    authorize(request);
    const payload = await this.gzipJson<AlevelDocumentPayload>(this.metadataKey(resourceId));
    const expiresIn = 3600;
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.config.values.S3_BUCKET,
        Key: payload.document.originalStorageKey,
        ResponseCacheControl: 'private, max-age=3600',
      }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  async documentStream(
    request: ApiRequest,
    documentId: string,
    range?: string,
  ): Promise<{
    body: Readable;
    statusCode: number;
    contentLength?: number;
    contentRange?: string;
    etag?: string;
    lastModified?: Date;
  }> {
    authorize(request);
    const payload = await this.gzipJson<AlevelDocumentPayload>(this.metadataKey(documentId));
    if (payload.document.mediaType !== 'application/pdf') throw ProblemException.notFound();
    const normalizedRange = range?.trim();
    if (normalizedRange && !/^bytes=(?:\d+-\d*|-\d+)$/u.test(normalizedRange)) {
      throw ProblemException.badRequest('invalid_range', 'Range 请求头格式无效。');
    }
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.config.values.S3_BUCKET,
        Key: payload.document.originalStorageKey,
        ...(normalizedRange ? { Range: normalizedRange } : {}),
      }),
    );
    if (!response.Body) throw ProblemException.notFound('A Level 原卷不存在。');
    return {
      body: response.Body as Readable,
      statusCode: response.ContentRange ? 206 : 200,
      ...(response.ContentLength === undefined ? {} : { contentLength: response.ContentLength }),
      ...(response.ContentRange === undefined ? {} : { contentRange: response.ContentRange }),
      ...(response.ETag === undefined ? {} : { etag: response.ETag }),
      ...(response.LastModified === undefined ? {} : { lastModified: response.LastModified }),
    };
  }
}
