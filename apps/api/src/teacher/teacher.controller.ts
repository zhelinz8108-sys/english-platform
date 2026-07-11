import { Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { TeacherService } from './teacher.service.js';

const rubricSchema = z.object({
  criterionKey: z.string().min(1).max(100),
  score: z.number().min(0),
  maxScore: z.number().positive(),
  comment: z.string().max(2_000).nullable(),
});
const gradeSchema = z
  .object({
    submissionSnapshotId: z.uuid(),
    score: z.number().min(0),
    maxScore: z.number().positive(),
    feedback: z.string().max(10_000).nullable(),
    rubricScores: z.array(rubricSchema).max(50),
  })
  .refine((value) => value.score <= value.maxScore, { message: 'score must not exceed maxScore' });
const returnSchema = z.object({
  submissionSnapshotId: z.uuid(),
  message: z.string().min(1).max(5_000),
});

@Controller('api/v1/tenants/:tenantId/teacher')
@Roles('teacher', 'owner', 'admin')
export class TeacherController {
  constructor(@Inject(TeacherService) private readonly teachers: TeacherService) {}

  @Get('dashboard')
  dashboard(@Req() request: ApiRequest) {
    return this.teachers.dashboard(request);
  }

  @Get('attempts/:attemptId')
  attempt(@Req() request: ApiRequest, @Param('attemptId') attemptId: string) {
    return this.teachers.attemptDetail(request, attemptId);
  }

  @Post('attempts/:attemptId/grades')
  @RequiresCsrf()
  async grade(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('attemptId') attemptId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.teachers.grade(request, attemptId, key, parseBody(gradeSchema, body));
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Post('attempts/:attemptId/return')
  @RequiresCsrf()
  async returnAttempt(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('attemptId') attemptId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.teachers.returnAttempt(
      request,
      attemptId,
      key,
      parseBody(returnSchema, body),
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    for (const [name, value] of Object.entries(result.headers ?? {}))
      response.setHeader(name, value);
    response.status(result.status);
    return result.body;
  }
}
