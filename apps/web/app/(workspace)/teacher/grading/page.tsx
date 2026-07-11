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
import { adaptTeacherDashboard } from '@/lib/adapters';
import type { ApiTeacherDashboard } from '@/lib/api-models';
import { demoTeacherDashboard } from '@/lib/demo-data';
import { formatDateTime, taskKindLabels } from '@/lib/format';
import type { TeacherDashboardData } from '@/lib/types';

export default function GradingQueuePage() {
  const [query, setQuery] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    TeacherDashboardData,
    ApiTeacherDashboard
  >('/teacher/dashboard', demoTeacherDashboard, adaptTeacherDashboard);
  const submissions = useMemo(
    () =>
      (data?.recentSubmissions ?? []).filter((item) => {
        const term = query.trim().toLocaleLowerCase('zh-CN');
        const matches =
          term.length === 0 ||
          item.studentDisplayName.toLocaleLowerCase('zh-CN').includes(term) ||
          item.taskTitle.toLocaleLowerCase('zh-CN').includes(term);
        return matches && (!lateOnly || item.isLate);
      }),
    [data?.recentSubmissions, lateOnly, query],
  );

  if (isLoading) return <LoadingState label="正在加载批改队列" />;
  if (isError && error) return <ErrorState error={error} onRetry={() => void reload()} />;
  if (!data) return <LoadingState label="正在加载批改队列" />;

  return (
    <>
      <PageHeader
        description="批改基于最新不可变提交快照；双教师并发评分只允许一个成功。"
        eyebrow="教师工作台"
        title="待批改"
      />
      <Card padding={false}>
        <div className="list-toolbar">
          <label className="search-box">
            <span className="sr-only">搜索提交</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="学生或任务"
              type="search"
              value={query}
            />
          </label>
          <label className="toggle-filter">
            <input
              checked={lateOnly}
              onChange={(event) => setLateOnly(event.target.checked)}
              type="checkbox"
            />
            <span>只看迟交</span>
          </label>
        </div>
        {submissions.length === 0 ? (
          <EmptyState
            description="没有匹配当前筛选条件的提交。"
            icon="grade"
            title="批改队列为空"
          />
        ) : (
          <div className="grading-list">
            {submissions.map((submission, index) => (
              <Link href={'/teacher/grading/' + submission.attemptId} key={submission.attemptId}>
                <span className="queue-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="avatar">{submission.studentDisplayName.slice(-2)}</span>
                <span className="queue-title">
                  <strong>{submission.studentDisplayName}</strong>
                  <small>{submission.taskTitle}</small>
                </span>
                <span>
                  <StatusBadge tone="neutral">{taskKindLabels[submission.kind]}</StatusBadge>
                  {submission.isLate ? <StatusBadge tone="warning">迟交</StatusBadge> : null}
                </span>
                <span>{formatDateTime(submission.submittedAt)}</span>
                <Icon name="chevron" size={18} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
