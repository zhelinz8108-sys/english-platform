import { apiRequest, tenantPath } from './api';

export interface SelfStudyProgressEvent {
  module: 'vocabulary' | 'grammar' | 'listening' | 'reading';
  activityType: 'study' | 'practice' | 'assessment';
  contentKey: string;
  contentTitle: string;
  clientEventId: string;
  questionCount?: number | null;
  correctCount?: number | null;
  scorePercent?: number | null;
  durationSeconds?: number | null;
  metadata?: Record<string, unknown>;
}

export function createProgressEventId(scope: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${scope}:${random}`;
}

export async function recordSelfStudyProgress(
  tenantId: string,
  event: SelfStudyProgressEvent,
): Promise<void> {
  await apiRequest(tenantPath(tenantId, '/learning/progress/events'), {
    method: 'POST',
    json: { ...event, metadata: event.metadata ?? {} },
  });
}
