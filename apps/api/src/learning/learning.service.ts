import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import { DatabaseService } from '../infrastructure/database.service.js';

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
      credentials: {
        accessKeyId: config.values.S3_ACCESS_KEY,
        secretAccessKey: config.values.S3_SECRET_KEY,
      },
    });
  }

  listListening(request: ApiRequest, input: { query?: string | undefined; pageSize: number }) {
    const context = requestContext(request);
    return this.database.withTenant(context, async (transaction) => {
      const search = input.query ? `%${input.query}%` : null;
      const result = await sql<{
        id: string;
        collection_slug: string;
        sequence_no: number;
        title: string;
        duration_seconds: number | null;
        size_bytes: string;
      }>`
        select asset.id, asset.collection_slug, asset.sequence_no, asset.title,
               asset.duration_seconds, file.size_bytes
        from toefl_listening_assets asset
        join file_objects file
          on file.tenant_id = asset.tenant_id and file.id = asset.file_object_id
        where asset.tenant_id = ${context.tenantId}::uuid
          and file.status = 'ready'
          and (${search}::text is null or asset.title ilike ${search})
        order by asset.collection_slug, asset.sequence_no
        limit ${input.pageSize}
      `.execute(transaction);

      return {
        data: result.rows.map((row) => ({
          id: row.id,
          collection: row.collection_slug,
          sequence: row.sequence_no,
          title: row.title,
          durationSeconds: row.duration_seconds,
          sizeBytes: Number(row.size_bytes),
        })),
        page: { nextCursor: null, hasMore: false, limit: input.pageSize },
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
        ResponseContentType: asset.media_type,
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
