import { describe, expect, it } from 'vitest';
import {
  adaptFeedback,
  adaptTaskDetail,
  adaptTeacherAttemptDetail,
  structuredText,
} from './adapters';
import type { ApiFeedbackItem, ApiTaskItemDetail, ApiTeacherAttemptDetail } from './api-models';

function taskDetail(currentAttempt: ApiTaskItemDetail['currentAttempt']): ApiTaskItemDetail {
  return {
    item: {
      id: 'task-item',
      title: 'Reading',
      kind: 'practice',
      workflowState: currentAttempt ? 'in_progress' : 'not_started',
      availability: 'available',
      dueAt: null,
      availableAt: '2026-07-11T00:00:00Z',
      isOverdue: false,
      isLate: false,
      sourceCount: 2,
    },
    taskSnapshot: {
      id: 'task-version',
      versionNumber: 1,
      title: 'Reading',
      instructions: { text: 'Answer every question.' },
      kind: 'practice',
      contentHash: 'hash',
      questions: [
        {
          questionVersionId: 'question-version',
          kind: 'single_choice',
          prompt: { content: 'Choose one.' },
          options: { choices: [{ key: 'a', text: 'First' }] },
          position: 1,
          maxScore: 1,
        },
      ],
    },
    sources: [],
    currentAttempt,
  };
}

describe('API response adapters', () => {
  it('extracts readable text from structured API values', () => {
    expect(structuredText({ message: { text: '具体反馈' } })).toBe('具体反馈');
  });

  it('keeps a missing currentAttempt nullable and maps snapshot questions', () => {
    const detail = adaptTaskDetail(taskDetail(null));
    expect(detail.attempt).toBeNull();
    expect(detail.taskSnapshot.instructions).toBe('Answer every question.');
    expect(detail.taskSnapshot.questions[0]?.options[0]).toMatchObject({
      id: 'a',
      content: 'First',
    });
  });

  it('maps an existing currentAttempt without inventing answers', () => {
    const detail = adaptTaskDetail(
      taskDetail({
        id: 'attempt',
        taskItemId: 'task-item',
        attemptNumber: 1,
        state: 'in_progress',
        revision: 3,
      }),
    );
    expect(detail.attempt).toMatchObject({ id: 'attempt', revision: 3, answers: {} });
  });

  it('normalizes object feedback and nullable grades', () => {
    const feedback: ApiFeedbackItem = {
      id: 'feedback',
      taskItemId: 'task-item',
      attemptId: 'attempt',
      taskTitle: 'Essay',
      grade: {
        source: null,
        score: null,
        maxScore: null,
        feedback: { message: '等待评分' },
      },
      returnedAt: '2026-07-11T00:00:00Z',
      readAt: null,
    };
    expect(adaptFeedback(feedback)).toMatchObject({
      score: 0,
      maxScore: 0,
      source: 'auto_scored',
      feedback: '等待评分',
    });
  });

  it('keeps the teacher submission id and maps frozen questions without answer keys', () => {
    const raw: ApiTeacherAttemptDetail = {
      attempt: {
        id: 'attempt',
        attemptNumber: 2,
        state: 'grading',
        startedAt: '2026-07-11T00:00:00Z',
        submittedAt: '2026-07-11T00:10:00Z',
      },
      student: { membershipId: 'student', displayName: 'Student' },
      task: {
        taskItemId: 'task-item',
        taskVersionId: 'task-version',
        title: 'Essay',
        kind: 'writing',
      },
      submission: {
        id: 'submission-current',
        revision: 3,
        submittedAt: '2026-07-11T00:10:00Z',
        isLate: true,
        responses: { question: 'Frozen response' },
      },
      questions: [
        {
          questionVersionId: 'question',
          kind: 'essay',
          prompt: { text: 'Frozen prompt' },
          options: [],
          position: 1,
          maxScore: 30,
        },
      ],
      grade: null,
      feedback: [
        {
          id: 'feedback',
          type: 'teacher_comment',
          visibility: 'student',
          body: { message: 'Revise paragraph two.' },
          authoredByMembershipId: 'teacher',
          createdAt: '2026-07-11T00:12:00Z',
        },
      ],
    };

    const detail = adaptTeacherAttemptDetail(raw);
    expect(detail.submission).toMatchObject({ id: 'submission-current', revision: 3 });
    expect(detail.questions[0]).toMatchObject({ prompt: 'Frozen prompt', maxScore: 30 });
    expect(detail.feedback[0]?.body).toBe('Revise paragraph two.');
    expect(detail.submission.responses.question).toBe('Frozen response');
    expect(detail.questions[0]).not.toHaveProperty('answerKey');
  });
});
