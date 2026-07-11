'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/icon';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { adaptTaskPage } from '@/lib/adapters';
import type { ApiPage, ApiTaskItem } from '@/lib/api-models';
import { demoTaskPage } from '@/lib/demo-data';
import { formatDateTime, taskKindLabels, workflowLabels, workflowTone } from '@/lib/format';
import type { PageEnvelope, TaskItem } from '@/lib/types';

type TaskFilter = 'all' | 'open' | 'returned' | 'completed';

export default function StudentTasksPage() {
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [query, setQuery] = useState('');
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    PageEnvelope<TaskItem>,
    ApiPage<ApiTaskItem>
  >('/student/task-items?pageSize=50', demoTaskPage, adaptTaskPage);

  const tasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    return (data?.data ?? []).filter((task) => {
      const matchesSearch =
        normalizedQuery.length === 0 ||
        task.title.toLocaleLowerCase('zh-CN').includes(normalizedQuery) ||
        task.sourceLabel.toLocaleLowerCase('zh-CN').includes(normalizedQuery);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'open' &&
          ['not_started', 'in_progress', 'submitted', 'grading'].includes(task.workflowState)) ||
        task.workflowState === filter;
      return matchesSearch && matchesFilter;
    });
  }, [data?.data, filter, query]);

  if (isLoading) {
    return <LoadingState label="正在加载任务列表" />;
  }
  if (isError && error) {
    return <ErrorState error={error} onRetry={() => void reload()} />;
  }
  if (!data) return <LoadingState label="正在加载任务列表" />;

  return (
    <>
      <PageHeader
        description="来自个人、班级与学习路径的任务已经去重并按优先级整理。"
        eyebrow="学生工作台"
        title="我的任务"
      />
      <Card padding={false}>
        <div className="list-toolbar">
          <div className="segmented-control" aria-label="任务状态筛选">
            {[
              ['all', '全部'],
              ['open', '待完成'],
              ['returned', '已退回'],
              ['completed', '已完成'],
            ].map(([value, label]) => (
              <button
                aria-pressed={filter === value}
                className={filter === value ? 'is-active' : ''}
                key={value}
                onClick={() => setFilter(value as TaskFilter)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <label className="search-box">
            <span className="sr-only">搜索任务</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索任务或来源"
              type="search"
              value={query}
            />
          </label>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            description="换一个筛选条件，或稍后再回来看看。"
            icon="tasks"
            title="没有符合条件的任务"
          />
        ) : (
          <div className="task-table" role="table" aria-label="学生任务列表">
            <div className="task-table-head" role="row">
              <span role="columnheader">任务</span>
              <span role="columnheader">来源</span>
              <span role="columnheader">截止时间</span>
              <span role="columnheader">状态</span>
              <span aria-hidden="true" />
            </div>
            {tasks.map((task) => (
              <Link
                className={
                  'task-table-row ' + (task.workflowState === 'returned' ? 'row-returned' : '')
                }
                href={'/student/tasks/' + task.id}
                key={task.id}
                role="row"
              >
                <span className="task-title-cell" role="cell">
                  <span className={'task-kind-icon kind-' + task.kind}>
                    <Icon name={task.kind === 'writing' ? 'feedback' : 'book'} size={18} />
                  </span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {taskKindLabels[task.kind]}
                      {task.estimatedMinutes === undefined
                        ? ''
                        : ' · 约 ' + task.estimatedMinutes + ' 分钟'}
                    </small>
                  </span>
                </span>
                <span className="task-source-cell" role="cell">
                  {task.sourceLabel}
                  {task.sourceCount > 1 ? <small>{task.sourceCount} 个来源已合并</small> : null}
                </span>
                <span role="cell">
                  {formatDateTime(task.dueAt)}
                  {task.isOverdue ? <small className="danger-text">已逾期</small> : null}
                </span>
                <span role="cell">
                  <StatusBadge tone={workflowTone(task.workflowState)}>
                    {workflowLabels[task.workflowState]}
                  </StatusBadge>
                </span>
                <span role="cell">
                  <Icon name="chevron" size={17} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
      <p className="table-note">
        <Icon name="spark" size={16} />
        同一任务经多个来源到达时只显示一次；来源和历史记录仍会完整保留。
      </p>
    </>
  );
}
