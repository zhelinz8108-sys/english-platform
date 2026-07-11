'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from './workspace-provider';
import { Icon } from './icon';
import { ButtonLink, Card, ErrorState, InlineNotice, LoadingState, StatusBadge } from './ui';
import {
  ApiProblemError,
  apiRequest,
  createIdempotencyKey,
  isDemoMode,
  tenantPath,
} from '@/lib/api';
import { demoTaskDetail } from '@/lib/demo-data';
import { adaptTaskDetail } from '@/lib/adapters';
import type { ApiAttemptDetail, ApiTaskAttempt, ApiTaskItemDetail } from '@/lib/api-models';
import { formatDateTime, workflowLabels, workflowTone } from '@/lib/format';
import type { TaskDetail, TaskQuestion } from '@/lib/types';

type AnswerValue = string | string[];
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function QuestionInput({
  answer,
  disabled,
  onChange,
  question,
}: {
  answer: AnswerValue | undefined;
  disabled: boolean;
  onChange: (value: AnswerValue) => void;
  question: TaskQuestion;
}) {
  if (question.kind === 'single_choice' || question.kind === 'true_false') {
    return (
      <div className="answer-options">
        {question.options.map((option) => (
          <label
            className={answer === option.id ? 'answer-option is-selected' : 'answer-option'}
            key={option.id}
          >
            <input
              checked={answer === option.id}
              disabled={disabled}
              name={question.questionVersionId}
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            <span className="option-label">{option.label}</span>
            <span>{option.content}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.kind === 'multiple_choice') {
    const values = Array.isArray(answer) ? answer : [];
    return (
      <div className="answer-options">
        {question.options.map((option) => {
          const checked = values.includes(option.id);
          return (
            <label
              className={checked ? 'answer-option is-selected' : 'answer-option'}
              key={option.id}
            >
              <input
                checked={checked}
                disabled={disabled}
                onChange={() =>
                  onChange(
                    checked
                      ? values.filter((value) => value !== option.id)
                      : [...values, option.id],
                  )
                }
                type="checkbox"
                value={option.id}
              />
              <span className="option-label">{option.label}</span>
              <span>{option.content}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <label className="long-answer">
      <span className="sr-only">填写第 {question.position + 1} 题答案</span>
      <textarea
        maxLength={question.kind === 'essay' ? 5000 : 1000}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={question.kind === 'essay' ? '在这里撰写你的回答…' : '输入你的答案…'}
        rows={question.kind === 'essay' ? 12 : 4}
        value={typeof answer === 'string' ? answer : ''}
      />
      <small>
        {typeof answer === 'string' ? answer.length : 0} /{' '}
        {question.kind === 'essay' ? '5000' : '1000'}
      </small>
    </label>
  );
}

export function TaskWorkspace({ taskItemId }: { taskItemId: string }) {
  const { currentTenant } = useWorkspace();
  const [detail, setDetail] = useState<TaskDetail | null>(() =>
    isDemoMode() ? { ...demoTaskDetail, item: { ...demoTaskDetail.item, id: taskItemId } } : null,
  );
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(
    () => detail?.attempt?.answers ?? {},
  );
  const [revision, setRevision] = useState(detail?.attempt?.revision ?? 0);
  const [etag, setEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isDemoMode());
  const [starting, setStarting] = useState(false);
  const [loadError, setLoadError] = useState<ApiProblemError | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<ApiProblemError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const initialized = useRef(false);

  const answeredCount = useMemo(
    () =>
      (detail?.taskSnapshot.questions ?? []).filter((question) => {
        const value = answers[question.questionVersionId];
        return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
      }).length,
    [answers, detail?.taskSnapshot.questions],
  );

  useEffect(() => {
    let active = true;
    initialized.current = false;
    setSubmitted(false);
    setEtag(null);
    setLoadError(null);
    if (isDemoMode()) {
      const nextDetail = { ...demoTaskDetail, item: { ...demoTaskDetail.item, id: taskItemId } };
      setDetail(nextDetail);
      setAnswers(nextDetail.attempt?.answers ?? {});
      setRevision(nextDetail.attempt?.revision ?? 0);
      setLoading(false);
      return;
    }

    setLoading(true);
    void apiRequest<ApiTaskItemDetail>(
      tenantPath(currentTenant.id, '/student/task-items/' + taskItemId),
    )
      .then(async (raw) => {
        const nextDetail = adaptTaskDetail(raw);
        if (raw.currentAttempt) {
          let responseEtag: string | null = null;
          const attemptDetail = await apiRequest<ApiAttemptDetail>(
            tenantPath(currentTenant.id, '/student/attempts/' + raw.currentAttempt.id),
            {
              onResponse: (response) => {
                responseEtag = response.headers.get('etag');
              },
            },
          );
          nextDetail.attempt = {
            id: attemptDetail.attempt.id,
            attemptNumber: attemptDetail.attempt.attemptNumber,
            state: attemptDetail.attempt.state,
            revision: attemptDetail.attempt.revision,
            answers: Object.fromEntries(
              attemptDetail.answers.map((answer) => [answer.questionVersionId, answer.value]),
            ),
          };
          if (active) setEtag(responseEtag);
        }
        if (!active) return;
        setDetail(nextDetail);
        setAnswers(nextDetail.attempt?.answers ?? {});
        setRevision(nextDetail.attempt?.revision ?? 0);
      })
      .catch((caught) => {
        if (!active) return;
        setLoadError(
          caught instanceof ApiProblemError
            ? caught
            : new ApiProblemError({
                type: 'about:blank',
                title: '任务加载失败',
                status: 500,
                detail: caught instanceof Error ? caught.message : '请稍后重试。',
              }),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentTenant.id, taskItemId]);

  useEffect(() => {
    if (!detail?.attempt || loading || !['in_progress', 'returned'].includes(detail.attempt.state))
      return;
    const attemptId = detail.attempt.id;
    if (!initialized.current) {
      initialized.current = true;
      return;
    }

    setSaveState('saving');
    const timer = window.setTimeout(async () => {
      try {
        if (isDemoMode()) {
          await new Promise((resolve) => window.setTimeout(resolve, 260));
          setRevision((current) => current + 1);
        } else {
          if (!etag) {
            throw new ApiProblemError({
              type: 'about:blank',
              title: '无法安全保存',
              status: 428,
              detail: '服务端未返回作答 ETag，请重新打开任务。',
            });
          }
          let responseEtag: string | null = null;
          const result = await apiRequest<{ revision: number }>(
            tenantPath(currentTenant.id, '/student/attempts/' + attemptId + '/draft'),
            {
              method: 'PATCH',
              ifMatch: etag,
              onResponse: (response) => {
                responseEtag = response.headers.get('etag');
              },
              json: {
                baseRevision: revision,
                answers: Object.entries(answers).map(([questionVersionId, value]) => ({
                  questionVersionId,
                  value,
                })),
              },
            },
          );
          setRevision(result.revision);
          setEtag(responseEtag);
        }
        setSaveError(null);
        setSaveState('saved');
      } catch (caught) {
        setSaveError(
          caught instanceof ApiProblemError
            ? caught
            : new ApiProblemError({
                type: 'about:blank',
                title: '自动保存失败',
                status: 500,
                detail: '答案仍保留在当前页面，请检查网络后重试。',
              }),
        );
        setSaveState('error');
      }
    }, 720);

    return () => window.clearTimeout(timer);
  }, [answers, currentTenant.id, detail?.attempt, loading]);

  async function startAttempt() {
    if (!detail) return;
    setStarting(true);
    setSaveError(null);
    try {
      let attempt: ApiTaskAttempt;
      let refreshedDetail: TaskDetail | null = null;
      if (isDemoMode()) {
        await new Promise((resolve) => window.setTimeout(resolve, 320));
        attempt = {
          id: 'demo-attempt-' + taskItemId,
          taskItemId,
          attemptNumber: 1,
          state: 'in_progress',
          revision: 0,
        };
      } else {
        attempt = await apiRequest<ApiTaskAttempt>(
          tenantPath(currentTenant.id, '/student/task-items/' + taskItemId + '/attempts'),
          {
            method: 'POST',
            idempotencyKey: createIdempotencyKey('start-attempt'),
            json: { intent: 'start', clientStartedAt: new Date().toISOString() },
          },
        );
        refreshedDetail = adaptTaskDetail(
          await apiRequest<ApiTaskItemDetail>(
            tenantPath(currentTenant.id, '/student/task-items/' + taskItemId),
          ),
        );
        let responseEtag: string | null = null;
        await apiRequest<ApiAttemptDetail>(
          tenantPath(currentTenant.id, '/student/attempts/' + attempt.id),
          {
            onResponse: (response) => {
              responseEtag = response.headers.get('etag');
            },
          },
        );
        setEtag(responseEtag);
      }
      initialized.current = false;
      setAnswers({});
      setRevision(attempt.revision);
      setDetail(
        (current) =>
          refreshedDetail ??
          (current
            ? {
                ...current,
                attempt: {
                  id: attempt.id,
                  attemptNumber: attempt.attemptNumber,
                  state: attempt.state,
                  revision: attempt.revision,
                  answers: {},
                },
              }
            : current),
      );
    } catch (caught) {
      setSaveError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '无法开始任务',
              status: 500,
              detail: '请稍后重试。',
            }),
      );
    } finally {
      setStarting(false);
    }
  }

  async function submit() {
    if (!detail?.attempt) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      if (isDemoMode()) {
        await new Promise((resolve) => window.setTimeout(resolve, 620));
      } else {
        if (!etag) {
          throw new ApiProblemError({
            type: 'about:blank',
            title: '无法安全提交',
            status: 428,
            detail: '服务端未返回作答 ETag，请重新打开任务。',
          });
        }
        await apiRequest(
          tenantPath(currentTenant.id, '/student/attempts/' + detail.attempt.id + '/submit'),
          {
            method: 'POST',
            idempotencyKey: createIdempotencyKey('submit-attempt'),
            ifMatch: etag,
            json: {
              baseRevision: revision,
              clientSubmittedAt: new Date().toISOString(),
            },
          },
        );
      }
      setSubmitted(true);
    } catch (caught) {
      setSaveError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '提交失败',
              status: 500,
              detail: '没有生成提交快照，请稍后重试。',
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingState label="正在加载任务与作答快照" />;
  }
  if (loadError) {
    return <ErrorState error={loadError} onRetry={() => window.location.reload()} />;
  }
  if (!detail) {
    return <LoadingState label="正在准备任务" />;
  }
  if (!detail.attempt) {
    return (
      <Card className="submission-success">
        <span className="success-seal">
          <Icon name="book" size={30} />
        </span>
        <p className="eyebrow">{detail.taskSnapshot.kind}</p>
        <h1>{detail.taskSnapshot.title}</h1>
        <p>{detail.taskSnapshot.instructions || '开始后会创建第一次作答，并固定当前任务版本。'}</p>
        {saveError ? (
          <InlineNotice title={saveError.problem.title} tone="danger">
            {saveError.problem.detail}
          </InlineNotice>
        ) : null}
        <div className="submission-actions">
          <ButtonLink href="/student/tasks" variant="secondary">
            返回任务列表
          </ButtonLink>
          <button
            className="button button-primary"
            disabled={starting || detail.item.availability !== 'available'}
            onClick={() => void startAttempt()}
            type="button"
          >
            {starting ? <span className="spinner spinner-light" /> : null}
            {detail.item.availability === 'available' ? '开始任务' : '任务尚未开放'}
          </button>
        </div>
      </Card>
    );
  }
  const editable = ['in_progress', 'returned'].includes(detail.attempt.state);

  if (submitted) {
    return (
      <Card className="submission-success">
        <span className="success-seal">
          <Icon name="check" size={30} />
        </span>
        <p className="eyebrow">提交成功</p>
        <h1>答案快照已安全保存</h1>
        <p>
          本次提交为 Attempt #{detail.attempt.attemptNumber} · Revision 1。
          客观题将自动评分，写作反馈会在教师批改后出现。
        </p>
        <div className="submission-actions">
          <ButtonLink href="/student/tasks" variant="secondary">
            返回任务列表
          </ButtonLink>
          <ButtonLink href="/student/feedback">查看成绩反馈</ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="workspace-topline">
        <Link className="back-link" href="/student/tasks">
          <Icon name="arrow" size={17} />
          返回任务
        </Link>
        <div aria-live="polite" className={'save-status save-' + saveState}>
          {saveState === 'saving' ? <span className="spinner" /> : null}
          {saveState === 'saved' ? <Icon name="check" size={15} /> : null}
          {saveState === 'error' ? <Icon name="alert" size={15} /> : null}
          {saveState === 'idle' && '答案自动保存'}
          {saveState === 'saving' && '正在保存'}
          {saveState === 'saved' && '已保存 · Revision ' + revision}
          {saveState === 'error' && '保存失败'}
        </div>
      </div>

      {detail.item.workflowState === 'returned' ? (
        <InlineNotice title="教师已退回本次作答" tone="warning">
          修改答案会让同一 Attempt 从 returned 回到 in_progress，再次提交只增加 Submission
          Revision。
        </InlineNotice>
      ) : null}
      {!editable ? (
        <InlineNotice title="作答已锁定">
          当前 Attempt 状态为 {detail.attempt.state}，答案仅供查看，不能继续保存或提交。
        </InlineNotice>
      ) : null}
      {saveError ? (
        <InlineNotice title={saveError.problem.title} tone="danger">
          {saveError.problem.detail ?? '请稍后重试。'}
        </InlineNotice>
      ) : null}

      <div className="task-workspace">
        <aside className="task-outline">
          <StatusBadge tone={workflowTone(detail.item.workflowState)}>
            {workflowLabels[detail.item.workflowState]}
          </StatusBadge>
          <h1>{detail.taskSnapshot.title}</h1>
          <p>{detail.taskSnapshot.instructions}</p>
          <div className="task-outline-meta">
            {detail.item.estimatedMinutes === undefined ? null : (
              <span>
                <Icon name="clock" size={16} />
                {detail.item.estimatedMinutes} 分钟
              </span>
            )}
            <span>
              <Icon name="calendar" size={16} />
              {formatDateTime(detail.item.dueAt)}
            </span>
          </div>
          <div className="question-progress">
            <div>
              <span>完成进度</span>
              <strong>
                {answeredCount} / {detail.taskSnapshot.questions.length}
              </strong>
            </div>
            <div className="progress-track">
              <span
                className="progress-fill"
                style={{
                  width: (answeredCount / detail.taskSnapshot.questions.length) * 100 + '%',
                }}
              />
            </div>
          </div>
          <nav aria-label="题目导航" className="question-nav">
            {detail.taskSnapshot.questions.map((question) => (
              <a
                className={answers[question.questionVersionId] ? 'is-answered' : ''}
                href={'#question-' + question.position}
                key={question.questionVersionId}
              >
                {question.position + 1}
              </a>
            ))}
          </nav>
          <small className="snapshot-note">
            任务版本 v{detail.taskSnapshot.versionNumber} · 内容已固化
          </small>
        </aside>

        <div className="question-stack">
          {detail.taskSnapshot.questions.map((question) => (
            <Card className="question-card" key={question.questionVersionId}>
              <div className="question-heading" id={'question-' + question.position}>
                <span>第 {question.position + 1} 题</span>
                <small>{question.maxScore} 分</small>
              </div>
              <h2>{question.prompt}</h2>
              <QuestionInput
                answer={answers[question.questionVersionId]}
                disabled={!editable}
                onChange={(value) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.questionVersionId]: value,
                  }))
                }
                question={question}
              />
            </Card>
          ))}
          <Card className="submit-card">
            <div>
              <strong>准备提交？</strong>
              <p>
                已完成 {answeredCount} / {detail.taskSnapshot.questions.length} 题。
                提交将生成不可变答案快照。
              </p>
            </div>
            <button
              className="button button-primary"
              disabled={!editable || submitting || saveState === 'saving'}
              onClick={() => void submit()}
              type="button"
            >
              {submitting ? <span className="spinner spinner-light" /> : null}
              {submitting ? '正在提交' : '提交答案'}
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}
