import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { SelfStudyService } from './self-study.service.js';

const progressEvent = z
  .object({
    module: z.enum(['vocabulary', 'grammar', 'listening', 'reading']),
    activityType: z.enum(['study', 'practice', 'assessment']),
    contentKey: z.string().trim().min(1).max(240),
    contentTitle: z.string().trim().min(1).max(240),
    clientEventId: z.string().trim().min(8).max(120),
    questionCount: z.number().int().min(0).max(10_000).nullable().optional(),
    correctCount: z.number().int().min(0).max(10_000).nullable().optional(),
    scorePercent: z.number().min(0).max(100).nullable().optional(),
    durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (event) =>
      event.questionCount == null ||
      event.correctCount == null ||
      event.correctCount <= event.questionCount,
    { message: 'correctCount cannot exceed questionCount', path: ['correctCount'] },
  );

@Controller('api/v1/tenants/:tenantId/learning/progress')
@Roles('student')
export class SelfStudyController {
  constructor(@Inject(SelfStudyService) private readonly progress: SelfStudyService) {}

  @Get()
  summary(@Req() request: ApiRequest) {
    return this.progress.summary(request);
  }

  @Post('events')
  @RequiresCsrf()
  record(@Req() request: ApiRequest, @Body() body: unknown) {
    return this.progress.record(request, parseBody(progressEvent, body));
  }
}
