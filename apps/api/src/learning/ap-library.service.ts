import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import { apCatalog } from './ap-catalog.generated.js';
import type { ApCatalog, ApDocumentSummary, ApNativeDocument } from './ap-types.js';
import type { ApMediaSummary } from './ap-types.js';

const catalog = apCatalog;
const documentsById = new Map(catalog.documents.map((document) => [document.id, document]));
const mediaById = new Map(catalog.media.map((item) => [item.id, item]));

function authorize(request: ApiRequest): void {
  requirePrincipal(request);
  requireTenant(request);
}

@Injectable()
export class ApLibraryService {
  private readonly s3: S3Client;

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

  catalog(request: ApiRequest): ApCatalog {
    authorize(request);
    return catalog;
  }

  async document(
    request: ApiRequest,
    documentId: string,
  ): Promise<{
    document: ApDocumentSummary;
    content: ApNativeDocument;
    answers: ApDocumentSummary[];
    media: ApMediaSummary[];
  }> {
    authorize(request);
    const document = documentsById.get(documentId);
    if (!document?.nativeStorageKey)
      throw ProblemException.notFound('AP 试卷正文尚未完成结构化导入。');
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.config.values.S3_BUCKET,
        Key: document.nativeStorageKey,
      }),
    );
    if (!response.Body) throw ProblemException.notFound('AP 试卷正文不存在。');
    const compressed = Buffer.from(await response.Body.transformToByteArray());
    const content = JSON.parse(gunzipSync(compressed).toString('utf8')) as ApNativeDocument;
    return {
      document,
      content,
      answers: document.answerDocumentIds
        .map((id) => documentsById.get(id))
        .filter((item): item is ApDocumentSummary => Boolean(item)),
      media: catalog.media
        .filter(
          (item) =>
            item.subjectId === document.subjectId &&
            (document.year === null || item.year === document.year),
        )
        .slice(0, 250),
    };
  }

  async resourceUrl(
    request: ApiRequest,
    resourceType: 'document' | 'media',
    resourceId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    authorize(request);
    const resource =
      resourceType === 'document' ? documentsById.get(resourceId) : mediaById.get(resourceId);
    if (!resource) throw ProblemException.notFound();
    const expiresIn = 3600;
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.config.values.S3_BUCKET,
        Key: resource.originalStorageKey,
        ResponseCacheControl: 'private, max-age=3600',
      }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }
}
