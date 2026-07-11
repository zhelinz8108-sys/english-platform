'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ApiProblemError,
  apiRequest,
  createIdempotencyKey,
  isDemoMode,
  tenantPath,
} from '@/lib/api';
import { adaptTeacherAttemptDetail, structuredText } from '@/lib/adapters';
import type { ApiTeacherAttemptDetail } from '@/lib/api-models';
import { demoSubmissions } from '@/lib/demo-data';
import { formatDateTime, taskKindLabels } from '@/lib/format';
import type { TaskQuestion, TeacherAttemptDetail } from '@/lib/types';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { Icon } from './icon';
import { ButtonLink, Card, ErrorState, InlineNotice, LoadingState, StatusBadge } from './ui';
import { useWorkspace } from './workspace-provider';

function placeholderDetail(attemptId: string): TeacherAttemptDetail {
  return {
    attempt: {
      id: attemptId,
      attemptNumber: 1,
      state: 'grading',
      startedAt: new Date(0).toISOString(),
      submittedAt: null,
    },
    student: { membershipId: '', displayName: '' },
    task: { taskItemId: '', taskVersionId: '', title: '', kind: 'writing' },
    submission: {
      id: '',
      revision: 1,
      submittedAt: new Date(0).toISOString(),
      isLate: false,
      responses: {},
    },
    questions: [],
    grade: null,
    feedback: [],
  };
}

function demoDetail(attemptId: string): TeacherAttemptDetail {
  const summary =
    demoSubmissions.find((item) => item.attemptId === attemptId) ?? demoSubmissions[0]!;
  const questionVersionId = 'demo-writing-question';
  return {
    attempt: {
      id: summary.attemptId,
      attemptNumber: 1,
      state: 'grading',
      startedAt: summary.submittedAt,
      submittedAt: summary.submittedAt,
    },
    student: {
      membershipId: summary.studentMembershipId,
      displayName: summary.studentDisplayName,
    },
    task: {
      taskItemId: summary.taskItemId,
      taskVersionId: 'demo-writing-version',
      title: summary.taskTitle,
      kind: summary.kind,
    },
    submission: {
      id: summary.submissionSnapshotId ?? 'demo-submission',
      revision: 1,
      submittedAt: summary.submittedAt,
      isLate: summary.isLate,
      responses: {
        [questionVersionId]:
          'Public spaces are not simply decorative parts of a city. They create places where people with different backgrounds can meet, rest, and take part in community life.\n\nFirst, shared spaces improve daily well-being. A well-designed park gives residents a safe place to exercise and reduces the pressure of dense urban living.\n\nSecond, public space supports trust. For these reasons, cities should treat public space as essential infrastructure.',
      },
    },
    questions: [
      {
        questionVersionId,
        kind: 'essay',
        prompt:
          'Do you agree or disagree that cities should invest more in public spaces than in road expansion?',
        options: [],
        position: 0,
        maxScore: 30,
      },
    ],
    grade: null,
    feedback: [],
  };
}

function responseText(value: unknown): string {
  const text = structuredText(value);
  if (text) return text;
  if (value === null || value === undefined) return '未作答';
  try {
    return JSON.stringify(value);
  } catch {
    return '无法显示该答案格式';
  }
}

function FrozenResponse({ question, value }: { question: TaskQuestion; value: unknown }) {
  const selected = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
  const selectedOptions = question.options.filter((option) => selected.includes(option.id));

  if (selectedOptions.length > 0) {
    return (
      <div className="answer-options frozen-response">
        {selectedOptions.map((option) => (
          <div className="answer-option is-selected" key={option.id}>
            <span className="option-label">{option.label}</span>
            <span>{option.content}</span>
          </div>
        ))}
      </div>
    );
  }

  const answer = responseText(value);
  if (question.kind === 'essay') {
    return (
      <article className="essay-copy">
        {answer.split(/\n\s*\n/).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </article>
    );
  }
  return (
    <div className="essay-copy">
      <p>{answer}</p>
    </div>
  );
}

export function GradingPanel({ attemptId }: { attemptId: string }) {
  const { currentTenant } = useWorkspace();
  const fallback = useMemo(
    () => (isDemoMode() ? demoDetail(attemptId) : placeholderDetail(attemptId)),
    [attemptId],
  );
  const query = useTenantQuery<TeacherAttemptDetail, ApiTeacherAttemptDetail>(
    '/teacher/attempts/' + attemptId,
    fallback,
    adaptTeacherAttemptDetail,
  );
  const detail = query.data;
  const maxScore = useMemo(() => {
    if (!detail) return 1;
    const snapshotMaximum = detail.questions.reduce((sum, question) => sum + question.maxScore, 0);
    return Math.max(detail.grade?.maxScore ?? snapshotMaximum, 1);
  }, [detail]);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [mode, setMode] = useState<'idle' | 'saving' | 'graded' | 'returned'>('idle');
  const [error, setError] = useState<ApiProblemError | null>(null);

  useEffect(() => {
    if (!detail) return;
    setScore(detail.grade?.score ?? 0);
    const latestStudentFeedback = detail.feedback.find((item) => item.visibility === 'student');
    setFeedback(latestStudentFeedback?.body ?? '');
    setMode('idle');
    setError(null);
  }, [detail]);

  async function act(action: 'grade' | 'return') {
    if (!detail) return;
    setMode('saving');
    setError(null);
    try {
      if (isDemoMode()) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      } else if (action === 'grade') {
        await apiRequest(
          tenantPath(currentTenant.id, '/teacher/attempts/' + attemptId + '/grades'),
          {
            method: 'POST',
            idempotencyKey: createIdempotencyKey('grade-attempt'),
            json: {
              submissionSnapshotId: detail.submission.id,
              score,
              maxScore,
              feedback: feedback.trim() || null,
              rubricScores: [],
            },
          },
        );
      } else {
        await apiRequest(
          tenantPath(currentTenant.id, '/teacher/attempts/' + attemptId + '/return'),
          {
            method: 'POST',
            idempotencyKey: createIdempotencyKey('return-attempt'),
            json: { submissionSnapshotId: detail.submission.id, message: feedback.trim() },
          },
        );
      }
      setMode(action === 'grade' ? 'graded' : 'returned');
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '操作失败',
              status: 500,
              detail: '提交快照可能已经变化，请刷新后重试。',
            }),
      );
      setMode('idle');
    }
  }

  if (query.isLoading) return <LoadingState label="正在加载不可变提交快照" />;
  if (query.isError && query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.reload()} />;
  }
  if (!detail) return <LoadingState label="正在加载不可变提交快照" />;

  if (mode === 'graded' || mode === 'returned') {
    return (
      <Card className="submission-success">
        <span className="success-seal">
          <Icon name="check" size={30} />
        </span>
        <p className="eyebrow">{mode === 'graded' ? '评分已保存' : '已退回学生'}</p>
        <h1>{mode === 'graded' ? `${score} / ${maxScore}` : '同一 Attempt 等待学生修改'}</h1>
        <p>
          {mode === 'graded'
            ? `成绩已绑定 Submission Revision ${detail.submission.revision}。`
            : '学生再次提交时会生成新的 Submission Revision，旧快照仍完整保留。'}
        </p>
        <ButtonLink href="/teacher/grading">返回批改队列</ButtonLink>
      </Card>
    );
  }

  const snapshotValid = detail.questions.length > 0 && detail.submission.id.length > 0;
  const canAct = detail.attempt.state === 'grading' && snapshotValid;

  return (
    <>
      <div className="workspace-topline">
        <ButtonLink href="/teacher/grading" variant="ghost">
          返回队列
        </ButtonLink>
        <span>提交于 {formatDateTime(detail.submission.submittedAt)}</span>
      </div>
      {error ? (
        <InlineNotice title={error.problem.title} tone="danger">
          {error.problem.detail}
          {error.problem.status === 409 ? ' 请重新加载最新提交快照后再操作。' : null}
          {error.problem.status === 409 ? (
            <button
              className="button button-secondary"
              onClick={() => void query.reload()}
              type="button"
            >
              重新加载快照
            </button>
          ) : null}
        </InlineNotice>
      ) : null}
      {detail.attempt.state !== 'grading' ? (
        <InlineNotice title="当前提交不可批改" tone="warning">
          Attempt 当前状态为 {detail.attempt.state}。页面保留只读快照，但不会再次写入评分或退回。
        </InlineNotice>
      ) : null}
      {detail.grade ? (
        <InlineNotice title="已有成绩决策">
          {detail.grade.source} · {detail.grade.score} / {detail.grade.maxScore} ·{' '}
          {formatDateTime(detail.grade.createdAt)}
        </InlineNotice>
      ) : null}
      <div className="grading-workspace">
        <Card className="student-submission">
          <div className="submission-head">
            <div>
              <span className="avatar">{detail.student.displayName.slice(-2)}</span>
              <div>
                <strong>{detail.student.displayName}</strong>
                <p>{detail.task.title}</p>
              </div>
            </div>
            <div>
              <StatusBadge tone={detail.submission.isLate ? 'warning' : 'success'}>
                {detail.submission.isLate ? '迟交' : '按时提交'}
              </StatusBadge>
              <small>
                Attempt #{detail.attempt.attemptNumber} · Submission Revision{' '}
                {detail.submission.revision}
              </small>
            </div>
          </div>
          {detail.questions.map((question) => (
            <section key={question.questionVersionId}>
              <div className="prompt-block">
                <span>
                  第 {question.position + 1} 题 · {question.maxScore} 分
                </span>
                <p>{question.prompt}</p>
              </div>
              <FrozenResponse
                question={question}
                value={detail.submission.responses[question.questionVersionId]}
              />
            </section>
          ))}
          {detail.questions.length === 0 ? (
            <InlineNotice title="快照没有题目" tone="warning">
              提交快照未包含可展示的题目，请勿评分并联系管理员检查任务版本。
            </InlineNotice>
          ) : null}
          <small className="snapshot-note">
            快照 {detail.submission.id} · 任务版本 {detail.task.taskVersionId}
          </small>
        </Card>
        <aside className="grading-form">
          <Card>
            <div className="card-header">
              <div>
                <h2>确认成绩</h2>
                <p>{taskKindLabels[detail.task.kind]} · 绑定当前提交快照</p>
              </div>
              <strong className="grade-total">
                {score}
                <span>/{maxScore}</span>
              </strong>
            </div>
            <label className="field">
              <span>总分</span>
              <input
                disabled={!canAct}
                max={maxScore}
                min={0}
                onChange={(event) => setScore(Number(event.target.value))}
                step="0.5"
                type="number"
                value={score}
              />
            </label>
            <label className="field">
              <span>给学生的反馈</span>
              <textarea
                disabled={!canAct}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="说明亮点、问题和下一步修改建议…"
                rows={8}
                value={feedback}
              />
            </label>
            <InlineNotice title="评分绑定当前提交快照">
              如果学生已再次提交，服务端会返回 409，避免批改旧版本。
            </InlineNotice>
            <div className="grading-actions">
              <button
                className="button button-danger"
                disabled={!canAct || mode === 'saving' || feedback.trim().length === 0}
                onClick={() => void act('return')}
                type="button"
              >
                退回修改
              </button>
              <button
                className="button button-primary"
                disabled={!canAct || mode === 'saving' || score < 0 || score > maxScore}
                onClick={() => void act('grade')}
                type="button"
              >
                {mode === 'saving' ? <span className="spinner spinner-light" /> : null}
                确认成绩
              </button>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
