import type { AttemptState, TenantRole, WorkflowState } from '@english/shared';
import type { Availability, LearningTrack, TaskKind } from './types';

export interface ApiPage<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore?: boolean; limit?: number };
}

export interface ApiTaskItem {
  id: string;
  title: string;
  taskTitle?: string;
  kind: TaskKind;
  workflowState: WorkflowState;
  availability: Availability;
  dueAt: string | null;
  availableAt: string | null;
  isOverdue: boolean;
  isLate: boolean;
  sourceCount: number;
}

export interface ApiTaskAttempt {
  id: string;
  taskItemId: string;
  attemptNumber: number;
  state: AttemptState;
  revision: number;
  submissionRevision?: number;
  latestSubmissionSnapshotId?: string | null;
}

export interface ApiTaskQuestion {
  questionVersionId: string;
  kind: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_text' | 'essay';
  prompt: unknown;
  options?: unknown;
  position: number;
  maxScore?: number;
}

export interface ApiTaskItemDetail {
  item: ApiTaskItem;
  taskSnapshot: {
    id: string;
    versionNumber: number;
    title: string;
    instructions: unknown;
    kind: TaskKind;
    contentHash: string;
    questions: ApiTaskQuestion[];
  };
  sources?: unknown[];
  currentAttempt: ApiTaskAttempt | null;
}

export interface ApiAttemptDetail {
  attempt: ApiTaskAttempt;
  answers: Array<{ questionVersionId: string; value: string | string[] }>;
  grade?: unknown;
}

export interface ApiPathEnrollment {
  id: string;
  pathVersionId: string;
  title: string;
  track: LearningTrack;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  progressPercent: number;
  enrolledAt?: string;
  targetCompletionDate: string | null;
  currentMilestone?: string;
  completedMilestones?: number;
  totalMilestones?: number;
}

export interface ApiPathDetail {
  enrollment: ApiPathEnrollment;
  milestones: Array<{
    key: string;
    title: string;
    position: number;
    state: string;
    completedTaskCount: number;
    totalTaskCount: number;
  }>;
}

export interface ApiStudentDashboard {
  counts: { available: number; dueSoon: number; overdue: number; awaitingFeedback: number };
  nextTaskItems: ApiTaskItem[];
  activePaths: ApiPathEnrollment[];
}

export interface ApiStudentProgress {
  from: string;
  to: string;
  assignedCount: number;
  completedCount: number;
  onTimeCount: number;
  lateCount: number;
  byKind: Array<{
    kind: TaskKind;
    assigned: number;
    completed: number;
    averageScorePercent: number | null;
  }>;
}

export interface ApiFeedbackItem {
  id: string;
  taskItemId: string;
  attemptId: string;
  taskTitle: string;
  grade: {
    source: 'auto_scored' | 'teacher_confirmed' | 'admin_override' | null;
    score: number | null;
    maxScore: number | null;
    feedback: unknown;
    rubricScores?: Array<{
      criterionKey?: string;
      label?: string;
      score: number;
      maxScore: number;
    }>;
  };
  returnedAt: string;
  readAt: string | null;
}

export interface ApiSubmissionSummary {
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

export interface ApiTeacherDashboard {
  classCount: number;
  studentCount: number;
  awaitingGradeCount: number;
  returnedThisWeekCount: number;
  recentSubmissions: ApiSubmissionSummary[];
}

export interface ApiTeacherAttemptDetail {
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
  questions: ApiTaskQuestion[];
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
    body: unknown;
    authoredByMembershipId: string | null;
    createdAt: string;
  }>;
}

export interface ApiClass {
  id: string;
  name: string;
  code: string;
  status: 'draft' | 'active' | 'archived';
  teacherCount: number;
  studentCount: number;
}

export interface ApiClassDetail {
  class: ApiClass;
  teachers: Array<{ membershipId: string; displayName: string }>;
  students: ApiTeacherStudent[];
}

export interface ApiTeacherStudent {
  membershipId: string;
  displayName: string;
  studentNumber: string | null;
  classIds: string[];
  activePathCount: number;
  overdueTaskCount: number;
}

export interface ApiTeacherStudentDetail {
  student: ApiTeacherStudent;
  examGoals: Array<{ id?: string; examType?: string; targetScore?: number; targetDate?: string }>;
  progress: {
    assignedCount?: number;
    completedCount?: number;
    averageScorePercent?: number | null;
    overdueTaskCount?: number;
    activePathCount?: number;
  };
  recentTaskItems: ApiTaskItem[];
}

export interface ApiAssignment {
  id: string;
  taskVersionId: string;
  status?: string;
}

export interface ApiMembership {
  id: string;
  membershipId?: string;
  email: string;
  displayName: string;
  status: 'invited' | 'active' | 'suspended' | 'left';
  roles: TenantRole[];
  joinedAt: string | null;
}

export interface ApiCatalogEntity {
  id: string;
  ownership: 'platform' | 'tenant';
  kind?: string;
  currentKind?: string;
  track?: string;
  slug: string;
  displayTitle?: string | null;
  title?: string | null;
  status: string;
  latestPublishedVersionId?: string | null;
  latestVersionNumber?: number | null;
  versionNumber?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCatalogVersionBase {
  id: string;
  versionNumber: number;
  publicationState: 'draft' | 'published';
  contentHash: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface ApiContentVersion extends ApiCatalogVersionBase {
  contentId: string;
  title: string;
  locale: string;
  body: Record<string, unknown>;
  metadata: Record<string, unknown>;
  attachmentFileIds: string[];
  items?: Array<{
    questionVersionId: string;
    position: number;
    points?: number;
    sectionKey?: string | null;
    settings?: Record<string, unknown>;
  }>;
}

export interface ApiQuestionVersionAdmin extends ApiCatalogVersionBase {
  questionId: string;
  prompt: Record<string, unknown>;
  options: Array<Record<string, unknown>>;
  answerKey: unknown;
  scoringRule: Record<string, unknown>;
  maxScore: number;
}

export interface ApiTaskVersionAdmin extends ApiCatalogVersionBase {
  taskId: string;
  title: string;
  instructions: Record<string, unknown>;
  kind: TaskKind;
  contentVersionId: string;
  completionRule: Record<string, unknown>;
  gradingPolicy: Record<string, unknown>;
  estimatedMinutes: number | null;
}

export interface ApiLearningPathVersion extends ApiCatalogVersionBase {
  pathId: string;
  title: string;
  description: string | null;
  completionRule: Record<string, unknown>;
  nodes: Array<{
    nodeKey: string;
    taskVersionId: string;
    position: number;
    slotKeyTemplate: string;
    availableOffsetDays: number;
    dueOffsetDays: number | null;
    closeOffsetDays: number | null;
    isRequired: boolean;
    unlockRule: Record<string, unknown>;
  }>;
  prerequisites: Array<{
    nodeKey: string;
    prerequisiteNodeKey: string;
    condition: 'completed' | 'min_score';
    threshold: number | null;
  }>;
}

export type ApiCatalogVersion =
  | ApiContentVersion
  | ApiQuestionVersionAdmin
  | ApiTaskVersionAdmin
  | ApiLearningPathVersion;

export interface ApiContentDetail {
  content: ApiCatalogEntity;
  versions: ApiContentVersion[];
}

export interface ApiQuestionDetail {
  question: ApiCatalogEntity;
  versions: ApiQuestionVersionAdmin[];
}

export interface ApiLearningPathDetail {
  path: ApiCatalogEntity;
  versions: ApiLearningPathVersion[];
}
