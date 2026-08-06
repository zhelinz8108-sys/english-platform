import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { Roles } from '../auth/guards.js';
import type { ApiRequest } from '../common/request.js';
import { ApLibraryService } from './ap-library.service.js';

@Controller('api/v1/tenants/:tenantId/learning/ap')
@Roles('owner', 'admin', 'teacher', 'student', 'content_editor', 'analyst')
export class ApLibraryController {
  constructor(@Inject(ApLibraryService) private readonly apLibrary: ApLibraryService) {}

  @Get('catalog')
  catalog(@Req() request: ApiRequest) {
    return this.apLibrary.catalog(request);
  }

  @Get('documents/:documentId')
  document(@Req() request: ApiRequest, @Param('documentId') documentId: string) {
    return this.apLibrary.document(request, documentId);
  }

  @Get('documents/:documentId/resource')
  documentResource(@Req() request: ApiRequest, @Param('documentId') documentId: string) {
    return this.apLibrary.resourceUrl(request, 'document', documentId);
  }

  @Get('media/:mediaId/resource')
  mediaResource(@Req() request: ApiRequest, @Param('mediaId') mediaId: string) {
    return this.apLibrary.resourceUrl(request, 'media', mediaId);
  }
}
