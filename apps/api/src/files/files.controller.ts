import { Body, Controller, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { FilesService } from './files.service.js';
const presign = z.object({
  purpose: z.enum(['content_attachment', 'submission_attachment', 'profile_image', 'bulk_import']),
  fileName: z.string().min(1).max(255),
  contentType: z.enum([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
  sizeBytes: z.number().int().min(1).max(52428800),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const complete = z.object({
  sizeBytes: z.number().int().min(1).max(52428800),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageEtag: z.string().min(1).max(200),
});
@Controller('api/v1/tenants/:tenantId/files')
@Roles('owner', 'admin', 'teacher', 'student', 'content_editor')
export class FilesController {
  constructor(@Inject(FilesService) private readonly service: FilesService) {}
  @Post('presigned-uploads') @RequiresCsrf() async presign(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    const x = await this.service.presign(r, key, parseBody(presign, b));
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
  @Post(':fileId/complete') @RequiresCsrf() async complete(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('fileId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    const x = await this.service.complete(r, id, key, parseBody(complete, b));
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
}
