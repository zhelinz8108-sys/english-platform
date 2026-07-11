import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequiresCsrf, Roles } from '../auth/guards.js';
import { parseBody } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { TeacherOperationsService } from './operations.service.js';

const enrollment = z.object({
  pathVersionId: z.uuid(),
  targetCompletionDate: z.iso.date().nullable(),
});
const enrollmentUpdate = z.object({
  status: z.enum(['active', 'paused', 'completed', 'cancelled']),
  reason: z.string().min(1).max(500),
});
const createClass = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(2).max(32),
  teacherMembershipIds: z.array(z.uuid()).default([]),
});
const updateClass = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});
const targets = z.object({
  studentMembershipIds: z.array(z.uuid()),
  classIds: z.array(z.uuid()),
  pathNodeIds: z.array(z.uuid()),
});
const assignment = z.object({
  taskVersionId: z.uuid(),
  sourceType: z.enum(['admin_forced', 'individual', 'class', 'exam_path', 'general']),
  occurrenceKey: z.string().min(1).max(180),
  slotKey: z.string().min(1).max(180),
  explicitPriority: z.number().int().min(0).max(99),
  scheduleMode: z.enum(['absolute', 'path_relative']),
  availableAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  closeAt: z.iso.datetime().nullable(),
  maxAttempts: z.number().int().min(1).max(20),
  latePolicy: z.enum(['deny', 'allow', 'allow_with_penalty']),
  targets,
});
const assignmentUpdate = assignment.partial().omit({
  taskVersionId: true,
  sourceType: true,
  occurrenceKey: true,
  slotKey: true,
  scheduleMode: true,
});
const cancel = z.object({ reason: z.string().min(1).max(500) });
const overrideReason = z.string().min(1).max(500);
const override = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('hide'), reason: overrideReason }),
  z.strictObject({
    action: z.literal('restore'),
    reversesOverrideId: z.uuid(),
    reason: overrideReason,
  }),
  z.strictObject({
    action: z.literal('replace'),
    replacementTaskVersionId: z.uuid(),
    reason: overrideReason,
  }),
  z
    .strictObject({
      action: z.literal('reschedule'),
      availableAt: z.iso.datetime({ offset: true }).optional(),
      dueAt: z.iso.datetime({ offset: true }).optional(),
      closeAt: z.iso.datetime({ offset: true }).optional(),
      reason: overrideReason,
    })
    .refine(
      (value) =>
        value.availableAt !== undefined || value.dueAt !== undefined || value.closeAt !== undefined,
      { message: 'reschedule requires at least one timestamp' },
    ),
  z.strictObject({ action: z.literal('require_redo'), reason: overrideReason }),
]);
const pagination = {
  cursor: z.string().min(1).max(512).optional(),
  pageSize: z.string().optional(),
};
const studentList = z.object({
  ...pagination,
  classId: z.uuid().optional(),
  query: z.string().min(1).max(100).optional(),
});
const classList = z.object({
  ...pagination,
  status: z.enum(['draft', 'active', 'archived']).optional(),
});
const assignmentList = z.object({
  ...pagination,
  status: z.enum(['draft', 'published', 'cancelled']).optional(),
});

@Controller('api/v1/tenants/:tenantId/teacher')
@Roles('teacher', 'owner', 'admin')
export class TeacherOperationsController {
  constructor(
    @Inject(TeacherOperationsService) private readonly service: TeacherOperationsService,
  ) {}
  @Get('students') students(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.students(r, parseBody(studentList, q));
  }
  @Get('students/:studentMembershipId') student(
    @Req() r: ApiRequest,
    @Param('studentMembershipId') id: string,
  ) {
    return this.service.student(r, id);
  }
  @Post('students/:studentMembershipId/learning-path-enrollments') @RequiresCsrf() async enroll(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('studentMembershipId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    const x = await this.service.enroll(r, id, key, parseBody(enrollment, b));
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
  @Patch('students/:studentMembershipId/learning-path-enrollments/:enrollmentId')
  @RequiresCsrf()
  updateEnrollment(
    @Req() r: ApiRequest,
    @Param('studentMembershipId') sid: string,
    @Param('enrollmentId') eid: string,
    @Body() b: unknown,
  ) {
    return this.service.updateEnrollment(r, sid, eid, parseBody(enrollmentUpdate, b));
  }
  @Get('classes') classes(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.classes(r, parseBody(classList, q));
  }
  @Post('classes') @RequiresCsrf() async createClass(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    const x = await this.service.createClass(r, key, parseBody(createClass, b));
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
  @Get('classes/:classId') class(@Req() r: ApiRequest, @Param('classId') id: string) {
    return this.service.classDetail(r, id);
  }
  @Patch('classes/:classId') @RequiresCsrf() updateClass(
    @Req() r: ApiRequest,
    @Param('classId') id: string,
    @Body() b: unknown,
  ) {
    return this.service.updateClass(r, id, parseBody(updateClass, b));
  }
  @Put('classes/:classId/students/:studentMembershipId') @HttpCode(204) @RequiresCsrf() addStudent(
    @Req() r: ApiRequest,
    @Param('classId') c: string,
    @Param('studentMembershipId') m: string,
  ) {
    return this.service.classMember(r, c, m, 'student', true);
  }
  @Delete('classes/:classId/students/:studentMembershipId')
  @HttpCode(204)
  @RequiresCsrf()
  removeStudent(
    @Req() r: ApiRequest,
    @Param('classId') c: string,
    @Param('studentMembershipId') m: string,
  ) {
    return this.service.classMember(r, c, m, 'student', false);
  }
  @Put('classes/:classId/teachers/:teacherMembershipId') @HttpCode(204) @RequiresCsrf() addTeacher(
    @Req() r: ApiRequest,
    @Param('classId') c: string,
    @Param('teacherMembershipId') m: string,
  ) {
    return this.service.classMember(r, c, m, 'teacher', true);
  }
  @Delete('classes/:classId/teachers/:teacherMembershipId')
  @HttpCode(204)
  @RequiresCsrf()
  removeTeacher(
    @Req() r: ApiRequest,
    @Param('classId') c: string,
    @Param('teacherMembershipId') m: string,
  ) {
    return this.service.classMember(r, c, m, 'teacher', false);
  }
  @Get('task-assignments') assignments(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.assignments(r, parseBody(assignmentList, q));
  }
  @Post('task-assignments') @RequiresCsrf() async createAssignment(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    const x = await this.service.createAssignment(r, key, parseBody(assignment, b));
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
  @Get('task-assignments/:assignmentId') getAssignment(
    @Req() r: ApiRequest,
    @Param('assignmentId') id: string,
  ) {
    return this.service.assignment(r, id);
  }
  @Patch('task-assignments/:assignmentId') @RequiresCsrf() updateAssignment(
    @Req() r: ApiRequest,
    @Param('assignmentId') id: string,
    @Body() b: unknown,
  ) {
    return this.service.updateAssignment(r, id, parseBody(assignmentUpdate, b));
  }
  @Post('task-assignments/:assignmentId/publish') @RequiresCsrf() async publish(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('assignmentId') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const x = await this.service.commandAssignment(r, id, key, 'publish');
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
  @Post('task-assignments/:assignmentId/cancel') @RequiresCsrf() async cancel(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('assignmentId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    const x = await this.service.commandAssignment(
      r,
      id,
      key,
      'cancel',
      parseBody(cancel, b).reason,
    );
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
  @Post('task-items/:taskItemId/overrides') @RequiresCsrf() async override(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('taskItemId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() b: unknown,
  ) {
    const x = await this.service.override(r, id, key, parseBody(override, b));
    res.status(x.status).setHeader('Idempotency-Replayed', String(x.replayed));
    return x.body;
  }
}
