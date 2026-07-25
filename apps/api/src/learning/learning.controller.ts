import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { LearningService } from './learning.service.js';

const listeningQuery = z.object({
  collection: z.enum(['minute-earth', 'bbc-6-minute-english']).optional(),
  query: z.string().trim().max(120).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).default(300),
});

const listeningAnswers = z.object({
  answers: z
    .record(z.string().min(1).max(100), z.enum(['a', 'b', 'c', 'd']))
    .refine((answers) => Object.keys(answers).length === 4, 'Complete all four questions.'),
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

  @Post('listening/:assetId/questions/check')
  checkListeningAnswers(
    @Req() request: ApiRequest,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ) {
    return this.learning.checkListeningAnswers(
      request,
      assetId,
      parseBody(listeningAnswers, body).answers,
    );
  }

  @Get('listening/:assetId/playback')
  playback(@Req() request: ApiRequest, @Param('assetId') assetId: string) {
    return this.learning.createPlaybackUrl(request, assetId);
  }
}
