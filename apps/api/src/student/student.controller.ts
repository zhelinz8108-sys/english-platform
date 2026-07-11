import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { StudentService } from './student.service.js';

const attemptSchema = z.object({
  intent: z.enum(['start', 'retry']),
  clientStartedAt: z.iso.datetime({ offset: false }),
});
const answerSchema = z.object({ questionVersionId: z.uuid(), value: z.unknown() });
const draftSchema = z.object({
  baseRevision: z.number().int().min(1),
  answers: z.array(answerSchema).max(200),
});
const submitSchema = z.object({
  baseRevision: z.number().int().min(1),
  clientSubmittedAt: z.iso.datetime({ offset: false }),
});
const profileSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    locale: z.enum(['zh-CN', 'en-US']).optional(),
    timezone: z.string().min(1).max(64).optional(),
    examGoals: z
      .array(
        z.object({
          id: z.uuid().nullable().optional(),
          exam: z.literal('toefl'),
          targetScore: z.number().min(0).max(120),
          targetDate: z.iso.date().nullable().optional(),
          status: z.enum(['active', 'achieved', 'cancelled']).optional(),
        }),
      )
      .max(5)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });
const paginationFields = {
  cursor: z.string().min(1).max(512).optional(),
  pageSize: z.string().optional(),
};
const taskListSchema = z.object({
  ...paginationFields,
  resolutionState: z.enum(['active', 'hidden', 'superseded']).optional(),
  workflowState: z
    .enum([
      'not_started',
      'in_progress',
      'submitted',
      'grading',
      'returned',
      'completed',
      'cancelled',
    ])
    .optional(),
  availability: z.enum(['locked', 'upcoming', 'available']).optional(),
  dueBefore: z.iso.datetime({ offset: true }).optional(),
});
const pathListSchema = z.object({
  ...paginationFields,
  track: z.enum(['general', 'toefl']).optional(),
});
const feedbackListSchema = z.object({
  ...paginationFields,
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

@Controller('api/v1/tenants/:tenantId/student')
@Roles('student')
export class StudentController {
  constructor(@Inject(StudentService) private readonly students: StudentService) {}

  @Get('profile')
  profile(@Req() request: ApiRequest) {
    return this.students.profile(request);
  }

  @Patch('profile')
  @RequiresCsrf()
  updateProfile(@Req() request: ApiRequest, @Body() body: unknown) {
    return this.students.updateProfile(request, parseBody(profileSchema, body));
  }

  @Get('dashboard')
  dashboard(@Req() request: ApiRequest) {
    return this.students.dashboard(request);
  }

  @Get('task-items')
  taskItems(@Req() request: ApiRequest, @Query() rawQuery: unknown) {
    return this.students.listTaskItems(request, parseBody(taskListSchema, rawQuery));
  }

  @Get('task-items/:taskItemId')
  taskItem(@Req() request: ApiRequest, @Param('taskItemId') taskItemId: string) {
    return this.students.getTaskItem(request, taskItemId);
  }

  @Post('task-items/:taskItemId/attempts')
  @RequiresCsrf()
  async start(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('taskItemId') taskItemId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const result = await this.students.startAttempt(
      request,
      taskItemId,
      key,
      parseBody(attemptSchema, rawBody),
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    for (const [name, value] of Object.entries(result.headers ?? {}))
      response.setHeader(name, value);
    response.status(result.status);
    return result.body;
  }

  @Get('attempts/:attemptId')
  async attempt(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('attemptId') attemptId: string,
  ) {
    const result = await this.students.attempt(request, attemptId);
    response.setHeader('ETag', result.etag);
    return result.body;
  }

  @Patch('attempts/:attemptId/draft')
  @RequiresCsrf()
  async saveDraft(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('attemptId') attemptId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const result = await this.students.saveDraft(
      request,
      attemptId,
      ifMatch,
      parseBody(draftSchema, rawBody),
    );
    response.setHeader('ETag', result.etag);
    return result.body;
  }

  @Post('attempts/:attemptId/submit')
  @RequiresCsrf()
  async submit(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('attemptId') attemptId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const result = await this.students.submit(
      request,
      attemptId,
      key,
      ifMatch,
      parseBody(submitSchema, rawBody),
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.status(result.status);
    return result.body;
  }

  @Get('learning-paths')
  paths(@Req() request: ApiRequest, @Query() rawQuery: unknown) {
    return this.students.paths(request, parseBody(pathListSchema, rawQuery));
  }

  @Get('learning-paths/:enrollmentId')
  path(@Req() request: ApiRequest, @Param('enrollmentId') enrollmentId: string) {
    return this.students.path(request, enrollmentId);
  }

  @Get('progress')
  progress(@Req() request: ApiRequest, @Query('from') from: string, @Query('to') to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw parseBody(z.never(), { from, to });
    }
    return this.students.progress(request, from, to);
  }

  @Get('feedback')
  feedback(@Req() request: ApiRequest, @Query() rawQuery: unknown) {
    return this.students.feedback(request, parseBody(feedbackListSchema, rawQuery));
  }
}
