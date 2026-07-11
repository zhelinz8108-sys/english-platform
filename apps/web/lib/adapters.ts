import type {
  ApiCatalogEntity,
  ApiClass,
  ApiFeedbackItem,
  ApiPage,
  ApiPathEnrollment,
  ApiStudentDashboard,
  ApiStudentProgress,
  ApiSubmissionSummary,
  ApiTaskItem,
  ApiTaskItemDetail,
  ApiTaskQuestion,
  ApiTeacherAttemptDetail,
  ApiTeacherDashboard,
  ApiTeacherStudent,
} from './api-models';
import type {
  CatalogItem,
  ClassSummary,
  FeedbackItem,
  PageEnvelope,
  PathSummary,
  StudentDashboardData,
  StudentProgressData,
  StudentSummary,
  SubmissionSummary,
  TaskDetail,
  TaskItem,
  TaskQuestion,
  TeacherAttemptDetail,
  TeacherDashboardData,
} from './types';

export function structuredText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(structuredText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'message', 'content', 'value', 'prompt']) {
      const text = structuredText(record[key]);
      if (text) return text;
    }
  }
  return '';
}

function questionOptions(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object'),
    );
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return questionOptions(record.options ?? record.items ?? record.choices);
  }
  return [];
}

function adaptTaskQuestion(question: ApiTaskQuestion): TaskQuestion {
  return {
    questionVersionId: question.questionVersionId,
    kind: question.kind,
    prompt: structuredText(question.prompt),
    options: questionOptions(question.options).map((option, index) => ({
      id: String(option.id ?? option.key ?? String(index)),
      label: String(option.label ?? String.fromCharCode(65 + index)),
      content: structuredText(option.content ?? option.text),
    })),
    position: question.position,
    maxScore: question.maxScore ?? 0,
  };
}

export function adaptTaskItem(item: ApiTaskItem): TaskItem {
  return {
    id: item.id,
    title: item.title ?? item.taskTitle ?? '未命名任务',
    kind: item.kind,
    workflowState: item.workflowState,
    availability: item.availability,
    dueAt: item.dueAt,
    availableAt: item.availableAt,
    isOverdue: item.isOverdue,
    isLate: item.isLate,
    sourceCount: item.sourceCount,
    sourceLabel: item.sourceCount > 1 ? `${item.sourceCount} 个来源` : '已分配任务',
  };
}

export function adaptTaskPage(raw: ApiPage<ApiTaskItem>): PageEnvelope<TaskItem> {
  return {
    data: raw.data.map(adaptTaskItem),
    page: { nextCursor: raw.page.nextCursor, limit: raw.page.limit ?? 50 },
  };
}

export function adaptPath(path: ApiPathEnrollment): PathSummary {
  return {
    id: path.id,
    title: path.title,
    track: path.track,
    status: path.status,
    progressPercent: path.progressPercent,
    targetCompletionDate: path.targetCompletionDate,
    currentMilestone: path.currentMilestone ?? '查看路径详情',
    completedMilestones: path.completedMilestones ?? 0,
    totalMilestones: path.totalMilestones ?? 0,
  };
}

export function adaptPathPage(raw: ApiPage<ApiPathEnrollment>): PageEnvelope<PathSummary> {
  return {
    data: raw.data.map(adaptPath),
    page: { nextCursor: raw.page.nextCursor, limit: raw.page.limit ?? 20 },
  };
}

export function adaptStudentDashboard(raw: ApiStudentDashboard): StudentDashboardData {
  return {
    counts: raw.counts,
    nextTaskItems: raw.nextTaskItems.map(adaptTaskItem),
    activePaths: raw.activePaths.map(adaptPath),
  };
}

export function adaptProgress(raw: ApiStudentProgress): StudentProgressData {
  return { ...raw };
}

export function adaptFeedback(item: ApiFeedbackItem): FeedbackItem {
  return {
    id: item.id,
    taskItemId: item.taskItemId,
    attemptId: item.attemptId,
    taskTitle: item.taskTitle,
    score: item.grade.score ?? 0,
    maxScore: item.grade.maxScore ?? 0,
    source:
      item.grade.source === 'admin_override' || item.grade.source === 'teacher_confirmed'
        ? item.grade.source
        : 'auto_scored',
    feedback: structuredText(item.grade.feedback) || '暂无文字反馈',
    returnedAt: item.returnedAt,
    readAt: item.readAt,
    rubric: (item.grade.rubricScores ?? []).map((score) => ({
      label: score.label ?? score.criterionKey ?? '评分项',
      score: score.score,
      maxScore: score.maxScore,
    })),
  };
}

export function adaptFeedbackPage(raw: ApiPage<ApiFeedbackItem>): PageEnvelope<FeedbackItem> {
  return {
    data: raw.data.map(adaptFeedback),
    page: { nextCursor: raw.page.nextCursor, limit: raw.page.limit ?? 20 },
  };
}

export function adaptTaskDetail(raw: ApiTaskItemDetail): TaskDetail {
  return {
    item: adaptTaskItem(raw.item),
    taskSnapshot: {
      id: raw.taskSnapshot.id,
      versionNumber: raw.taskSnapshot.versionNumber,
      title: raw.taskSnapshot.title,
      instructions: structuredText(raw.taskSnapshot.instructions),
      kind: raw.taskSnapshot.kind,
      contentHash: raw.taskSnapshot.contentHash,
      questions: raw.taskSnapshot.questions.map(adaptTaskQuestion),
    },
    attempt: raw.currentAttempt
      ? {
          id: raw.currentAttempt.id,
          attemptNumber: raw.currentAttempt.attemptNumber,
          state: raw.currentAttempt.state,
          revision: raw.currentAttempt.revision,
          answers: {},
        }
      : null,
  };
}

export function adaptTeacherAttemptDetail(raw: ApiTeacherAttemptDetail): TeacherAttemptDetail {
  return {
    ...raw,
    questions: raw.questions.map(adaptTaskQuestion),
    feedback: raw.feedback.map((entry) => ({
      ...entry,
      body: structuredText(entry.body) || '暂无文字反馈',
    })),
  };
}

export function adaptSubmission(item: ApiSubmissionSummary): SubmissionSummary {
  return { ...item };
}

export function adaptTeacherDashboard(raw: ApiTeacherDashboard): TeacherDashboardData {
  return { ...raw, recentSubmissions: raw.recentSubmissions.map(adaptSubmission) };
}

export function adaptClass(item: ApiClass): ClassSummary {
  return { ...item };
}

export function adaptClassPage(raw: ApiPage<ApiClass>): PageEnvelope<ClassSummary> {
  return {
    data: raw.data.map(adaptClass),
    page: { nextCursor: raw.page.nextCursor, limit: raw.page.limit ?? 50 },
  };
}

export function adaptStudent(item: ApiTeacherStudent): StudentSummary {
  return {
    ...item,
    classIds: Array.isArray(item.classIds) ? item.classIds : [],
    activePathCount: Number.isFinite(item.activePathCount) ? item.activePathCount : 0,
    overdueTaskCount: Number.isFinite(item.overdueTaskCount) ? item.overdueTaskCount : 0,
  };
}

export function adaptStudentPage(raw: ApiPage<ApiTeacherStudent>): PageEnvelope<StudentSummary> {
  return {
    data: raw.data.map(adaptStudent),
    page: { nextCursor: raw.page.nextCursor, limit: raw.page.limit ?? 50 },
  };
}

export function adaptCatalog(item: ApiCatalogEntity, type: CatalogItem['type']): CatalogItem {
  const versionNumber = item.latestVersionNumber ?? item.versionNumber;
  return {
    id: item.id,
    type,
    title: item.displayTitle ?? item.title ?? item.slug,
    slug: item.slug,
    ownership: item.ownership,
    publicationState:
      item.status === 'published' || item.latestPublishedVersionId ? 'published' : 'draft',
    ...(versionNumber === null || versionNumber === undefined ? {} : { versionNumber }),
    updatedAt: item.updatedAt,
    kind: item.kind ?? item.currentKind ?? item.track ?? type,
    sourceVersionId: item.latestPublishedVersionId ?? null,
  };
}
