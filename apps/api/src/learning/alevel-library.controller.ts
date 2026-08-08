import { Controller, Get, Headers, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/guards.js';
import type { ApiRequest } from '../common/request.js';
import { AlevelLibraryService, type AlevelDocumentQuery } from './alevel-library.service.js';

@Controller('api/v1/tenants/:tenantId/learning/alevel')
@Roles('owner', 'admin', 'teacher', 'student', 'content_editor', 'analyst')
export class AlevelLibraryController {
  constructor(@Inject(AlevelLibraryService) private readonly library: AlevelLibraryService) {}

  @Get('catalog')
  catalog(@Req() request: ApiRequest) {
    return this.library.catalog(request);
  }

  @Get('subjects/:subjectId/documents')
  documents(
    @Req() request: ApiRequest,
    @Param('subjectId') subjectId: string,
    @Query() query: AlevelDocumentQuery,
  ) {
    return this.library.documents(request, subjectId, query);
  }

  @Get('documents/:documentId')
  document(@Req() request: ApiRequest, @Param('documentId') documentId: string) {
    return this.library.document(request, documentId);
  }

  @Get('documents/:documentId/embed')
  async documentEmbed(
    @Req() request: ApiRequest,
    @Param('documentId') documentId: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const stream = await this.library.documentStream(request, documentId, range);
    response.status(stream.statusCode);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (stream.contentLength !== undefined) {
      response.setHeader('Content-Length', String(stream.contentLength));
    }
    if (stream.contentRange) response.setHeader('Content-Range', stream.contentRange);
    if (stream.etag) response.setHeader('ETag', stream.etag);
    if (stream.lastModified) response.setHeader('Last-Modified', stream.lastModified.toUTCString());
    stream.body.on('error', () => {
      if (!response.destroyed) response.destroy();
    });
    stream.body.pipe(response);
  }

  @Get('resources/:resourceId')
  resource(@Req() request: ApiRequest, @Param('resourceId') resourceId: string) {
    return this.library.resourceUrl(request, resourceId);
  }
}
