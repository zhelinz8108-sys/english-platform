'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiProblemError,
  apiRequest,
  createIdempotencyKey,
  isDemoMode,
  tenantPath,
} from '@/lib/api';
import { demoClasses, demoStudents } from '@/lib/demo-data';
import { adaptClass, adaptStudent } from '@/lib/adapters';
import type { ApiAssignment, ApiClass, ApiPage, ApiTeacherStudent } from '@/lib/api-models';
import type { ClassSummary, StudentSummary } from '@/lib/types';
import { Icon } from './icon';
import { Card, InlineNotice } from './ui';
import { useWorkspace } from './workspace-provider';

export function AssignmentForm() {
  const router = useRouter();
  const { currentTenant } = useWorkspace();
  const [targetType, setTargetType] = useState<'class' | 'individual'>('class');
  const [taskVersionId, setTaskVersionId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [taskVersionIds, setTaskVersionIds] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [dueAt, setDueAt] = useState(() => {
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 16);
  });
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [latePolicy, setLatePolicy] = useState('allow');
  const [submitting, setSubmitting] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<ApiProblemError | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingOptions(true);
    setError(null);
    if (isDemoMode()) {
      const demoVersions = ['task-version-writing', 'task-version-reading', 'task-version-vocab'];
      setClasses(demoClasses);
      setStudents(demoStudents);
      setTaskVersionIds(demoVersions);
      setTaskVersionId(demoVersions[0]!);
      setTargetId(demoClasses[0]?.id ?? '');
      setLoadingOptions(false);
      return;
    }
    void Promise.all([
      apiRequest<ApiPage<ApiClass>>(tenantPath(currentTenant.id, '/teacher/classes?pageSize=100')),
      apiRequest<ApiPage<ApiTeacherStudent>>(
        tenantPath(currentTenant.id, '/teacher/students?pageSize=100'),
      ),
      apiRequest<ApiPage<ApiAssignment>>(
        tenantPath(currentTenant.id, '/teacher/task-assignments?pageSize=100'),
      ),
    ])
      .then(([classPage, studentPage, assignmentPage]) => {
        if (!active) return;
        const nextClasses = classPage.data.map(adaptClass);
        const nextStudents = studentPage.data.map(adaptStudent);
        const nextVersions = [...new Set(assignmentPage.data.map((item) => item.taskVersionId))];
        setClasses(nextClasses);
        setStudents(nextStudents);
        setTaskVersionIds(nextVersions);
        setTaskVersionId(nextVersions[0] ?? '');
        setTargetId(nextClasses[0]?.id ?? '');
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof ApiProblemError
              ? caught
              : new ApiProblemError({
                  type: 'about:blank',
                  title: '分配选项加载失败',
                  status: 500,
                  detail: '请刷新页面重试。',
                }),
          );
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => {
      active = false;
    };
  }, [currentTenant.id]);

  function changeTargetType(value: 'class' | 'individual') {
    setTargetType(value);
    setTargetId(value === 'class' ? (classes[0]?.id ?? '') : (students[0]?.membershipId ?? ''));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isDemoMode()) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      } else {
        const assignment = await apiRequest<{ id: string }>(
          tenantPath(currentTenant.id, '/teacher/task-assignments'),
          {
            method: 'POST',
            idempotencyKey: createIdempotencyKey('create-assignment'),
            json: {
              taskVersionId,
              sourceType: targetType === 'class' ? 'class' : 'individual',
              occurrenceKey: 'web:' + new Date().toISOString(),
              slotKey: 'weekly:writing',
              explicitPriority: 0,
              scheduleMode: 'absolute',
              availableAt: new Date().toISOString(),
              dueAt: new Date(dueAt).toISOString(),
              closeAt: null,
              maxAttempts,
              latePolicy,
              targets: {
                studentMembershipIds: targetType === 'individual' ? [targetId] : [],
                classIds: targetType === 'class' ? [targetId] : [],
                pathNodeIds: [],
              },
            },
          },
        );
        await apiRequest(
          tenantPath(currentTenant.id, '/teacher/task-assignments/' + assignment.id + '/publish'),
          {
            method: 'POST',
            idempotencyKey: createIdempotencyKey('publish-assignment'),
          },
        );
      }
      setPublished(true);
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '任务发布失败',
              status: 500,
              detail: '没有生成学生任务，请稍后重试。',
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (published) {
    return (
      <Card className="submission-success">
        <span className="success-seal">
          <Icon name="check" size={30} />
        </span>
        <p className="eyebrow">已进入解析队列</p>
        <h1>任务发布成功</h1>
        <p>系统会按来源优先级和 slot_key 物化学生任务；重复请求不会产生重复任务。</p>
        <div className="submission-actions">
          <button
            className="button button-secondary"
            onClick={() => setPublished(false)}
            type="button"
          >
            继续布置
          </button>
          <button
            className="button button-primary"
            onClick={() => router.push('/teacher')}
            type="button"
          >
            返回教学总览
          </button>
        </div>
      </Card>
    );
  }

  return (
    <form className="assignment-layout" onSubmit={(event) => void submit(event)}>
      <div className="stack">
        <Card>
          <div className="form-section-heading">
            <span>1</span>
            <div>
              <h2>选择任务</h2>
              <p>只能分配已发布、不可变的任务版本。</p>
            </div>
          </div>
          <label className="field">
            <span>任务版本</span>
            <select
              value={taskVersionId}
              onChange={(event) => setTaskVersionId(event.target.value)}
            >
              {taskVersionIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <div className="selected-task-preview">
            <span className="task-kind-icon kind-writing">
              <Icon name="feedback" size={18} />
            </span>
            <div>
              <strong>{taskVersionId || '暂无可用任务版本'}</strong>
              <p>
                {taskVersionIds.length > 0
                  ? '已发布的不可变任务版本'
                  : '请先发布任务版本或创建一次分配'}
              </p>
            </div>
            <span>v3</span>
          </div>
        </Card>

        <Card>
          <div className="form-section-heading">
            <span>2</span>
            <div>
              <h2>选择受众</h2>
              <p>受众目标使用真实外键，发布后保留历史关系。</p>
            </div>
          </div>
          <div className="choice-cards">
            <button
              aria-pressed={targetType === 'class'}
              className={targetType === 'class' ? 'is-active' : ''}
              onClick={() => changeTargetType('class')}
              type="button"
            >
              <Icon name="classes" />
              <strong>班级</strong>
              <span>按当前班级成员展开</span>
            </button>
            <button
              aria-pressed={targetType === 'individual'}
              className={targetType === 'individual' ? 'is-active' : ''}
              onClick={() => changeTargetType('individual')}
              type="button"
            >
              <Icon name="students" />
              <strong>个人</strong>
              <span>直接进入学生任务列表</span>
            </button>
          </div>
          <label className="field">
            <span>{targetType === 'class' ? '目标班级' : '目标学生'}</span>
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              {(targetType === 'class' ? classes : students).map((item) => (
                <option
                  key={'id' in item ? item.id : item.membershipId}
                  value={'id' in item ? item.id : item.membershipId}
                >
                  {'name' in item ? item.name : item.displayName}
                </option>
              ))}
            </select>
          </label>
        </Card>

        <Card>
          <div className="form-section-heading">
            <span>3</span>
            <div>
              <h2>时间与规则</h2>
              <p>所有时间会以 UTC 保存，并按学生时区显示。</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>截止时间</span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </label>
            <label className="field">
              <span>最多尝试次数</span>
              <input
                min={1}
                max={20}
                type="number"
                value={maxAttempts}
                onChange={(event) => setMaxAttempts(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>迟交策略</span>
              <select value={latePolicy} onChange={(event) => setLatePolicy(event.target.value)}>
                <option value="allow">允许迟交</option>
                <option value="deny">截止后拒绝</option>
                <option value="allow_with_penalty">允许并标记</option>
              </select>
            </label>
            <label className="field">
              <span>任务槽位</span>
              <input defaultValue="weekly:writing" />
            </label>
          </div>
        </Card>
      </div>

      <aside className="assignment-summary">
        <Card>
          <h2>发布摘要</h2>
          <dl>
            <div>
              <dt>任务</dt>
              <dd>{taskVersionId || '未选择'}</dd>
            </div>
            <div>
              <dt>来源优先级</dt>
              <dd>{targetType === 'class' ? '班级 · 300' : '个人 · 400'}</dd>
            </div>
            <div>
              <dt>受众</dt>
              <dd>
                {targetType === 'class'
                  ? classes.find((item) => item.id === targetId)?.name
                  : students.find((item) => item.membershipId === targetId)?.displayName}
              </dd>
            </div>
            <div>
              <dt>截止</dt>
              <dd>{new Date(dueAt).toLocaleString('zh-CN')}</dd>
            </div>
          </dl>
          <InlineNotice title="发布后不可直接改题">
            如需改变内容，请发布新任务版本并创建新的分配。
          </InlineNotice>
          {error ? (
            <InlineNotice title={error.problem.title} tone="danger">
              {error.problem.detail}
            </InlineNotice>
          ) : null}
          {loadingOptions ? (
            <InlineNotice title="正在加载">正在读取任务、班级和学生列表。</InlineNotice>
          ) : null}
          {!loadingOptions && taskVersionIds.length === 0 ? (
            <InlineNotice title="没有可选任务" tone="warning">
              当前 API
              没有独立的教师任务目录；请先通过内容管理发布任务版本，或使用已有分配中的版本。
            </InlineNotice>
          ) : null}
          <button
            className="button button-primary publish-button"
            disabled={submitting || loadingOptions || !taskVersionId || !targetId}
            type="submit"
          >
            {submitting ? (
              <span className="spinner spinner-light" />
            ) : (
              <Icon name="assign" size={18} />
            )}
            {submitting ? '正在发布' : '发布任务'}
          </button>
        </Card>
      </aside>
    </form>
  );
}
