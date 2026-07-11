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
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { AdminService, type CatalogKind } from './admin.service.js';

const roles = z.enum(['owner', 'admin', 'teacher', 'student', 'content_editor', 'analyst']);
const memberCreate = z
  .object({
    userId: z.uuid().optional(),
    email: z.email().optional(),
    roles: z.array(roles).min(1),
    displayName: z.string().max(100).nullable().optional(),
  })
  .refine((x) => Boolean(x.userId || x.email));
const memberUpdate = z.object({
  status: z.enum(['invited', 'active', 'suspended', 'left']).optional(),
  roles: z.array(roles).min(1).optional(),
});
const entitySchemas = {
  content: z
    .object({
      kind: z.enum(['lesson', 'passage', 'question_set', 'writing_prompt']).optional(),
      slug: z.string().min(2).max(120),
      cloneFromPlatformVersionId: z.uuid().optional(),
    })
    .refine((x) => Boolean(x.kind || x.cloneFromPlatformVersionId)),
  question: z
    .object({
      kind: z
        .enum(['single_choice', 'multiple_choice', 'true_false', 'short_text', 'essay'])
        .optional(),
      slug: z.string().min(2).max(120),
      cloneFromPlatformVersionId: z.uuid().optional(),
    })
    .refine((x) => Boolean(x.kind || x.cloneFromPlatformVersionId)),
  task: z.object({
    slug: z.string().min(2).max(120),
    cloneFromPlatformVersionId: z.uuid().optional(),
  }),
  path: z
    .object({
      track: z.enum(['general', 'toefl']).optional(),
      slug: z.string().min(2).max(120),
      cloneFromPlatformVersionId: z.uuid().optional(),
    })
    .refine((x) => Boolean(x.track || x.cloneFromPlatformVersionId)),
};
const contentVersion = z.object({
  title: z.string().min(1).max(240),
  locale: z.string().min(2).max(16),
  body: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  attachmentFileIds: z.array(z.uuid()),
  items: z
    .array(
      z.object({
        questionVersionId: z.uuid(),
        position: z.number().int().min(0),
        points: z.number().positive().optional(),
        sectionKey: z.string().min(1).max(80).nullable().optional(),
        settings: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(500)
    .default([]),
}).superRefine((value, context) => {
  const positions = new Set<number>();
  const questionVersions = new Set<string>();
  for (const [index, item] of value.items.entries()) {
    if (positions.has(item.position)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'position'],
        message: 'position must be unique within a content version',
      });
    }
    if (questionVersions.has(item.questionVersionId)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'questionVersionId'],
        message: 'questionVersionId must be unique within a content version',
      });
    }
    positions.add(item.position);
    questionVersions.add(item.questionVersionId);
  }
});
const questionVersion = z.object({
  prompt: z.record(z.string(), z.unknown()),
  options: z.array(z.record(z.string(), z.unknown())),
  answerKey: z.unknown(),
  scoringRule: z.record(z.string(), z.unknown()),
  maxScore: z.number().positive(),
});
const taskVersion = z.object({
  title: z.string().min(1).max(240),
  instructions: z.record(z.string(), z.unknown()),
  kind: z.enum(['lesson', 'practice', 'assessment', 'writing']),
  contentVersionId: z.uuid(),
  completionRule: z.record(z.string(), z.unknown()),
  gradingPolicy: z.record(z.string(), z.unknown()),
  estimatedMinutes: z.number().int().positive().nullable(),
});
const pathVersion = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(10000).nullable(),
  track: z.enum(['general', 'toefl']),
  completionRule: z.record(z.string(), z.unknown()),
  nodes: z
    .array(
      z.object({
        nodeKey: z.string().min(1),
        taskVersionId: z.uuid(),
        position: z.number().int().min(0),
        slotKeyTemplate: z.string().min(1),
        availableOffsetDays: z.number().int().min(0),
        dueOffsetDays: z.number().int().min(0).nullable(),
        closeOffsetDays: z.number().int().min(0).nullable(),
        isRequired: z.boolean(),
        unlockRule: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
  prerequisites: z.array(
    z.object({
      nodeKey: z.string(),
      prerequisiteNodeKey: z.string(),
      condition: z.enum(['completed', 'min_score']),
      threshold: z.number().min(0).nullable(),
    }),
  ),
});
const pagination = {
  cursor: z.string().min(1).max(512).optional(),
  pageSize: z.string().optional(),
};
const ownership = z.enum(['platform', 'tenant']);
const membershipList = z.object({
  ...pagination,
  role: roles.optional(),
  status: z.enum(['invited', 'active', 'suspended', 'left']).optional(),
});
const contentList = z.object({
  ...pagination,
  ownership: ownership.optional(),
  kind: z.enum(['lesson', 'passage', 'question_set', 'writing_prompt']).optional(),
  status: z.enum(['active', 'archived']).optional(),
});
const questionList = z.object({
  ...pagination,
  ownership: ownership.optional(),
  kind: z
    .enum(['single_choice', 'multiple_choice', 'true_false', 'short_text', 'essay'])
    .optional(),
});
const taskList = z.object({ ...pagination, ownership: ownership.optional() });
const learningPathList = z.object({
  ...pagination,
  ownership: ownership.optional(),
  track: z.enum(['general', 'toefl']).optional(),
});
const auditList = z.object({
  ...pagination,
  actorMembershipId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  occurredAfter: z.iso.datetime({ offset: true }).optional(),
});

function result(res: Response, x: any) {
  res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
  return x.body;
}

@Controller('api/v1/tenants/:tenantId/admin')
@Roles('owner', 'admin', 'content_editor')
export class AdminController {
  constructor(@Inject(AdminService) private readonly service: AdminService) {}
  @Get('memberships') @Roles('owner', 'admin') memberships(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.memberships(r, parseBody(membershipList, q));
  }
  @Post('memberships') @Roles('owner', 'admin') @RequiresCsrf() async createMembership(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(res, await this.service.createMembership(r, key, parseBody(memberCreate, b)));
  }
  @Patch('memberships/:membershipId') @Roles('owner', 'admin') @RequiresCsrf() updateMembership(
    @Req() r: ApiRequest,
    @Param('membershipId') id: string,
    @Body() b: unknown,
  ) {
    return this.service.updateMembership(r, id, parseBody(memberUpdate, b));
  }
  @Get('contents') contents(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.listCatalog(r, 'content', parseBody(contentList, q));
  }
  @Post('contents') @RequiresCsrf() async createContent(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createEntity(r, 'content', key, parseBody(entitySchemas.content, b)),
    );
  }
  @Get('contents/:contentId') content(@Req() r: ApiRequest, @Param('contentId') id: string) {
    return this.service.getCatalog(r, 'content', id);
  }
  @Post('contents/:contentId/versions') @RequiresCsrf() async contentVersion(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('contentId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createVersion(r, 'content', id, key, parseBody(contentVersion, b)),
    );
  }
  @Post('content-versions/:versionId/publish') @RequiresCsrf() async publishContent(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('versionId') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return result(res, await this.service.publish(r, 'content', id, key));
  }
  @Get('questions') questions(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.listCatalog(r, 'question', parseBody(questionList, q));
  }
  @Post('questions') @RequiresCsrf() async createQuestion(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createEntity(r, 'question', key, parseBody(entitySchemas.question, b)),
    );
  }
  @Get('questions/:questionId') question(@Req() r: ApiRequest, @Param('questionId') id: string) {
    return this.service.getCatalog(r, 'question', id);
  }
  @Post('questions/:questionId/versions') @RequiresCsrf() async questionVersion(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('questionId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createVersion(r, 'question', id, key, parseBody(questionVersion, b)),
    );
  }
  @Post('question-versions/:versionId/publish') @RequiresCsrf() async publishQuestion(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('versionId') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return result(res, await this.service.publish(r, 'question', id, key));
  }
  @Get('tasks') tasks(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.listCatalog(r, 'task', parseBody(taskList, q));
  }
  @Post('tasks') @RequiresCsrf() async createTask(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createEntity(r, 'task', key, parseBody(entitySchemas.task, b)),
    );
  }
  @Post('tasks/:taskId/versions') @RequiresCsrf() async taskVersion(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('taskId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createVersion(r, 'task', id, key, parseBody(taskVersion, b)),
    );
  }
  @Post('task-versions/:versionId/publish') @RequiresCsrf() async publishTask(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('versionId') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return result(res, await this.service.publish(r, 'task', id, key));
  }
  @Get('learning-paths') paths(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.listCatalog(r, 'path', parseBody(learningPathList, q));
  }
  @Post('learning-paths') @RequiresCsrf() async createPath(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createEntity(r, 'path', key, parseBody(entitySchemas.path, b)),
    );
  }
  @Get('learning-paths/:pathId') path(@Req() r: ApiRequest, @Param('pathId') id: string) {
    return this.service.getCatalog(r, 'path', id);
  }
  @Post('learning-paths/:pathId/versions') @RequiresCsrf() async pathVersion(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('pathId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    return result(
      res,
      await this.service.createVersion(r, 'path', id, key, parseBody(pathVersion, b)),
    );
  }
  @Post('learning-path-versions/:versionId/publish') @RequiresCsrf() async publishPath(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('versionId') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return result(res, await this.service.publish(r, 'path', id, key));
  }
  @Get('audit-events') @Roles('owner', 'admin', 'analyst') audit(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.audit(r, parseBody(auditList, q));
  }
}
