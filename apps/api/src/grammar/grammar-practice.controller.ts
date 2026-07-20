import { Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { GrammarPracticeService } from './grammar-practice.service.js';

const createSchema = z.object({
  topicId: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
});

const answerSchema = z.object({
  questionId: z.string().min(1).max(180),
  value: z.string().max(500),
});

@Controller('api/v1/tenants/:tenantId/learning/grammar')
@Roles('owner', 'admin', 'teacher', 'student', 'content_editor')
export class GrammarPracticeController {
  constructor(
    @Inject(GrammarPracticeService)
    private readonly grammar: GrammarPracticeService,
  ) {}

  @Get('progress')
  progress(@Req() request: ApiRequest) {
    return this.grammar.progress(request);
  }

  @Post('practice-sessions')
  @RequiresCsrf()
  async create(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const result = await this.grammar.create(request, key, parseBody(createSchema, rawBody));
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Get('practice-sessions/:sessionId')
  get(@Req() request: ApiRequest, @Param('sessionId') sessionId: string) {
    return this.grammar.get(request, sessionId);
  }

  @Post('practice-sessions/:sessionId/responses')
  @RequiresCsrf()
  async answer(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const result = await this.grammar.answer(
      request,
      sessionId,
      key,
      parseBody(answerSchema, rawBody),
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Post('practice-sessions/:sessionId/submit')
  @RequiresCsrf()
  async submit(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const result = await this.grammar.submit(request, sessionId, key);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }
}
