import { Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { VocabularyAssessmentService } from './vocabulary-assessment.service.js';

const createSchema = z.object({
  mode: z.enum(['quick', 'standard', 'calibration']),
  targetTrack: z.enum(['general', 'toefl']).default('general'),
});

const responseSchema = z.object({
  deliveryId: z.uuid(),
  selectedOptionId: z.union([
    z.literal('unknown'),
    z.enum(['choice-1', 'choice-2', 'choice-3', 'choice-4']),
  ]),
  responseTimeMs: z.number().finite().min(0).max(120_000),
  focusLossCount: z.number().int().min(0).max(10_000).default(0),
});

@Controller('api/v1/tenants/:tenantId/learning/vocabulary')
@Roles('owner', 'admin', 'teacher', 'student', 'content_editor', 'analyst')
export class VocabularyAssessmentController {
  constructor(
    @Inject(VocabularyAssessmentService)
    private readonly assessments: VocabularyAssessmentService,
  ) {}

  @Post('assessments')
  @RequiresCsrf()
  async create(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const result = await this.assessments.create(request, key, parseBody(createSchema, rawBody));
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Get('assessments/:sessionId')
  get(@Req() request: ApiRequest, @Param('sessionId') sessionId: string) {
    return this.assessments.get(request, sessionId);
  }

  @Post('assessments/:sessionId/pause')
  @RequiresCsrf()
  async pause(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const result = await this.assessments.pause(request, sessionId, key);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Post('assessments/:sessionId/resume')
  @RequiresCsrf()
  async resume(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const result = await this.assessments.resume(request, sessionId, key);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Post('assessments/:sessionId/responses')
  @RequiresCsrf()
  async answer(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(responseSchema, rawBody);
    const result = await this.assessments.answer(request, sessionId, key, body);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Get('assessment-results/:resultId')
  result(@Req() request: ApiRequest, @Param('resultId') resultId: string) {
    return this.assessments.result(request, resultId);
  }
}
