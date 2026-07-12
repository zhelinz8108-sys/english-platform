import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { LearningService } from './learning.service.js';

const listeningQuery = z.object({
  query: z.string().trim().max(120).optional(),
  pageSize: z.coerce.number().int().min(1).max(300).default(300),
});

@Controller('api/v1/tenants/:tenantId/learning/toefl')
@Roles('owner', 'admin', 'teacher', 'student', 'content_editor', 'analyst')
export class LearningController {
  constructor(@Inject(LearningService) private readonly learning: LearningService) {}

  @Get('listening')
  listening(@Req() request: ApiRequest, @Query() query: unknown) {
    return this.learning.listListening(request, parseBody(listeningQuery, query));
  }

  @Get('listening/:assetId/study-content')
  studyContent(@Req() request: ApiRequest, @Param('assetId') assetId: string) {
    return this.learning.getListeningStudyContent(request, assetId);
  }

  @Get('listening/:assetId/playback')
  playback(@Req() request: ApiRequest, @Param('assetId') assetId: string) {
    return this.learning.createPlaybackUrl(request, assetId);
  }
}
