import { z } from 'zod';

export const tenantRoles = [
  'owner',
  'admin',
  'teacher',
  'student',
  'content_editor',
  'analyst',
] as const;
export type TenantRole = (typeof tenantRoles)[number];

export const platformRoles = ['none', 'super_admin'] as const;
export type PlatformRole = (typeof platformRoles)[number];

export const resolutionStates = ['active', 'hidden', 'superseded'] as const;
export type ResolutionState = (typeof resolutionStates)[number];

export const workflowStates = [
  'not_started',
  'in_progress',
  'submitted',
  'grading',
  'returned',
  'completed',
  'cancelled',
] as const;
export type WorkflowState = (typeof workflowStates)[number];

export const attemptStates = [
  'in_progress',
  'submitted',
  'grading',
  'returned',
  'completed',
  'cancelled',
] as const;
export type AttemptState = (typeof attemptStates)[number];

export const availabilityStates = ['locked', 'upcoming', 'available'] as const;
export type AvailabilityState = (typeof availabilityStates)[number];

export const taskSourceTypes = [
  'admin_forced',
  'individual',
  'class',
  'exam_path',
  'general',
] as const;
export type TaskSourceType = (typeof taskSourceTypes)[number];

export const TASK_SOURCE_WEIGHT: Readonly<Record<TaskSourceType, number>> = {
  admin_forced: 500,
  individual: 400,
  class: 300,
  exam_path: 200,
  general: 100,
};

export const overrideActions = [
  'hide',
  'restore',
  'replace',
  'reschedule',
  'require_redo',
] as const;
export type OverrideAction = (typeof overrideActions)[number];

export const scoreDecisionTypes = ['auto_scored', 'teacher_confirmed', 'admin_override'] as const;
export type ScoreDecisionType = (typeof scoreDecisionTypes)[number];

export const SCORE_DECISION_WEIGHT: Readonly<Record<ScoreDecisionType, number>> = {
  auto_scored: 100,
  teacher_confirmed: 200,
  admin_override: 300,
};

export const uuidSchema = z.uuid();
export const cursorPageSchema = z.object({
  data: z.array(z.unknown()),
  nextCursor: z.string().nullable(),
});

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: Record<string, string[]>;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  platformRole: PlatformRole;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  membershipId: string;
  roles: TenantRole[];
}

export interface SessionEnvelope {
  user: SessionUser;
  tenants: TenantSummary[];
  csrfToken: string;
}

export function isWorkflowTerminal(state: WorkflowState): boolean {
  return state === 'completed' || state === 'cancelled';
}

export function compareTaskSources(
  left: { sourceType: TaskSourceType; explicitPriority: number; publishedAt: string; id: string },
  right: { sourceType: TaskSourceType; explicitPriority: number; publishedAt: string; id: string },
): number {
  return (
    TASK_SOURCE_WEIGHT[right.sourceType] - TASK_SOURCE_WEIGHT[left.sourceType] ||
    right.explicitPriority - left.explicitPriority ||
    right.publishedAt.localeCompare(left.publishedAt) ||
    right.id.localeCompare(left.id)
  );
}

export * from './task-resolution.js';
