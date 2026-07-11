import type { AttemptState, TenantRole, WorkflowState } from '@english/shared';

export type TaskKind = 'lesson' | 'practice' | 'assessment' | 'writing';
export type Availability = 'locked' | 'upcoming' | 'available';
export type LearningTrack = 'general' | 'toefl';

export interface AppTenant {
  id: string;
  name: string;
  slug: string;
  membershipId: string;
  roles: TenantRole[];
}

export interface AppUser {
  id: string;
  displayName: string;
  email: string;
}

export interface PageEnvelope<T> {
  data: T[];
  page: {
    nextCursor: string | null;
    limit: number;
  };
}

export interface TaskItem {
  id: string;
  title: string;
  kind: TaskKind;
  workflowState: WorkflowState;
  availability: Availability;
  dueAt: string | null;
  availableAt: string | null;
  isOverdue: boolean;
  isLate: boolean;
  sourceCount: number;
  sourceLabel: string;
  estimatedMinutes?: number;
}

export interface QuestionOption {
  id: string;
  label: string;
  content: string;
}

export interface TaskQuestion {
  questionVersionId: string;
  kind: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'essay';
  prompt: string;
  options: QuestionOption[];
  position: number;
  maxScore: number;
}

export interface TaskDetail {
  item: TaskItem;
  taskSnapshot: {
    id: string;
    versionNumber: number;
    title: string;
    instructions: string;
    kind: TaskKind;
    contentHash: string;
    questions: TaskQuestion[];
  };
  attempt: {
    id: string;
    attemptNumber: number;
    state: AttemptState;
    revision: number;
    answers: Record<string, string | string[]>;
  } | null;
}

export interface PathSummary {
  id: string;
  title: string;
  track: LearningTrack;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  progressPercent: number;
  targetCompletionDate: string | null;
  currentMilestone: string;
  completedMilestones: number;
  totalMilestones: number;
}

export interface StudentDashboardData {
  counts: {
    available: number;
    dueSoon: number;
    overdue: number;
    awaitingFeedback: number;
  };
  nextTaskItems: TaskItem[];
  activePaths: PathSummary[];
  weeklyMinutes?: number[];
  streakDays?: number;
}

export interface ProgressByKind {
  kind: TaskKind;
  assigned: number;
  completed: number;
  averageScorePercent: number | null;
}

export interface StudentProgressData {
  from: string;
  to: string;
  assignedCount: number;
  completedCount: number;
  onTimeCount: number;
  lateCount: number;
  byKind: ProgressByKind[];
  weeklyScores?: number[];
}

export interface FeedbackItem {
  id: string;
  taskItemId: string;
  attemptId: string;
  taskTitle: string;
  score: number;
  maxScore: number;
  source: 'auto_scored' | 'teacher_confirmed' | 'admin_override';
  feedback: string;
  returnedAt: string;
  readAt: string | null;
  rubric: Array<{ label: string; score: number; maxScore: number }>;
}

export interface SubmissionSummary {
  attemptId: string;
  taskItemId: string;
  studentMembershipId: string;
  studentDisplayName: string;
  taskTitle: string;
  kind: TaskKind;
  submittedAt: string;
  isLate: boolean;
  submissionSnapshotId?: string;
}

export interface TeacherDashboardData {
  classCount: number;
  studentCount: number;
  awaitingGradeCount: number;
  returnedThisWeekCount: number;
  recentSubmissions: SubmissionSummary[];
}

export interface TeacherAttemptDetail {
  attempt: {
    id: string;
    attemptNumber: number;
    state: AttemptState;
    startedAt: string;
    submittedAt: string | null;
  };
  student: { membershipId: string; displayName: string };
  task: { taskItemId: string; taskVersionId: string; title: string; kind: TaskKind };
  submission: {
    id: string;
    revision: number;
    submittedAt: string;
    isLate: boolean;
    responses: Record<string, unknown>;
  };
  questions: TaskQuestion[];
  grade: {
    id: string;
    source: 'auto_scored' | 'teacher_confirmed' | 'admin_override';
    score: number;
    maxScore: number;
    componentScores: unknown;
    rubricResult: unknown;
    createdByMembershipId: string | null;
    createdAt: string;
  } | null;
  feedback: Array<{
    id: string;
    type: string;
    visibility: string;
    body: string;
    authoredByMembershipId: string | null;
    createdAt: string;
  }>;
}

export interface ClassSummary {
  id: string;
  name: string;
  code: string;
  status: 'draft' | 'active' | 'archived';
  teacherCount: number;
  studentCount: number;
  completionRate?: number;
  nextDueAt?: string | null;
}

export interface StudentSummary {
  membershipId: string;
  displayName: string;
  studentNumber: string | null;
  classIds?: string[];
  classNames?: string[];
  activePathCount: number;
  overdueTaskCount: number;
  completionRate?: number;
  averageScore?: number;
  lastActiveAt?: string;
}

export interface Membership {
  id: string;
  email: string;
  displayName: string;
  status: 'invited' | 'active' | 'suspended' | 'left';
  roles: TenantRole[];
  joinedAt: string | null;
}

export interface CatalogItem {
  id: string;
  type: 'content' | 'question' | 'task' | 'path';
  title: string;
  slug: string;
  ownership: 'platform' | 'tenant';
  publicationState: 'draft' | 'published';
  versionNumber?: number;
  updatedAt: string;
  kind: string;
  sourceVersionId?: string | null;
}

export interface PathMilestone {
  key: string;
  title: string;
  position: number;
  state: string;
  completedTaskCount: number;
  totalTaskCount: number;
}
