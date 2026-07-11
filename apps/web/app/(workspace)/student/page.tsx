'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { useWorkspace } from '@/components/workspace-provider';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { adaptFeedbackPage, adaptStudentDashboard } from '@/lib/adapters';
import type { ApiFeedbackItem, ApiPage, ApiStudentDashboard } from '@/lib/api-models';
import { demoFeedback, demoStudentDashboard } from '@/lib/demo-data';
import {
  formatDateTime,
  relativeDue,
  taskKindLabels,
  workflowLabels,
  workflowTone,
} from '@/lib/format';
import type { FeedbackItem, PageEnvelope, StudentDashboardData } from '@/lib/types';

const demoFeedbackPage: PageEnvelope<FeedbackItem> = {
  data: demoFeedback,
  page: { nextCursor: null, limit: 1 },
};

export default function StudentDashboardPage() {
  const { user } = useWorkspace();
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    StudentDashboardData,
    ApiStudentDashboard
  >('/student/dashboard', demoStudentDashboard, adaptStudentDashboard);
  const feedbackQuery = useTenantQuery<PageEnvelope<FeedbackItem>, ApiPage<ApiFeedbackItem>>(
    '/student/feedback?pageSize=1',
    demoFeedbackPage,
    adaptFeedbackPage,
  );
  const weeklyMinutes = data?.weeklyMinutes ?? [];
  const maxMinutes = useMemo(() => Math.max(...weeklyMinutes, 1), [weeklyMinutes]);

  if (isLoading) {
    return <LoadingState label="正在整理你的学习计划" />;
  }
  if (isError && error) {
    return <ErrorState error={error} onRetry={() => void reload()} />;
  }
  if (!data) return <LoadingState label="正在整理你的学习计划" />;

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/student/tasks" icon="arrow">
            继续学习
          </ButtonLink>
        }
        description="今天优先完成一项到期任务，再用 15 分钟回顾昨天的反馈。"
        eyebrow="学生工作台"
        title={'你好，' + user.displayName}
      />

      <div className="stats-grid">
        <StatCard
          hint="当前可以立即开始"
          icon="tasks"
          label="可用任务"
          value={data.counts.available}
        />
        <StatCard
          hint="未来 48 小时内截止"
          icon="clock"
          label="即将到期"
          tone="warning"
          value={data.counts.dueSoon}
        />
        <StatCard
          hint="保持得很好"
          icon="alert"
          label="已逾期"
          tone={data.counts.overdue > 0 ? 'danger' : 'success'}
          value={data.counts.overdue}
        />
        <StatCard
          hint="连续学习天数"
          icon="spark"
          label="本周连胜"
          tone="info"
          value={data.streakDays === undefined ? '—' : data.streakDays + ' 天'}
        />
      </div>

      <div className="content-grid">
        <div className="stack">
          <Card>
            <div className="focus-card">
              <div className="focus-top">
                <div>
                  <span className="focus-kicker">
                    <Icon name="target" size={17} /> 今日重点
                  </span>
                  <h2>{data.nextTaskItems[0]?.title ?? '今天没有待办任务'}</h2>
                  <p>{data.nextTaskItems[0]?.sourceLabel ?? '可以回顾最近反馈。'}</p>
                </div>
                {data.nextTaskItems[0] ? (
                  <StatusBadge tone={workflowTone(data.nextTaskItems[0].workflowState)}>
                    {workflowLabels[data.nextTaskItems[0].workflowState]}
                  </StatusBadge>
                ) : null}
              </div>
              {data.nextTaskItems[0] ? (
                <>
                  <div className="focus-meta">
                    {data.nextTaskItems[0].estimatedMinutes === undefined ? null : (
                      <span>
                        <Icon name="clock" size={16} />
                        {data.nextTaskItems[0].estimatedMinutes} 分钟
                      </span>
                    )}
                    <span>
                      <Icon name="calendar" size={16} />
                      {relativeDue(data.nextTaskItems[0].dueAt)}
                    </span>
                    <span>{taskKindLabels[data.nextTaskItems[0].kind]}</span>
                  </div>
                  <Link
                    className="button button-primary"
                    href={'/student/tasks/' + data.nextTaskItems[0].id}
                  >
                    打开任务
                    <Icon name="arrow" size={17} />
                  </Link>
                </>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader
              action={
                <Link className="text-link" href="/student/tasks">
                  查看全部
                </Link>
              }
              description="按截止时间与任务来源自动整理"
              title="接下来"
            />
            {data.nextTaskItems.length === 0 ? (
              <EmptyState description="新的任务到达后会显示在这里。" title="暂时没有待办任务" />
            ) : (
              <div className="compact-list">
                {data.nextTaskItems.slice(1).map((task) => (
                  <Link className="compact-row" href={'/student/tasks/' + task.id} key={task.id}>
                    <span className={'task-kind-icon kind-' + task.kind}>
                      <Icon name={task.kind === 'writing' ? 'feedback' : 'book'} size={18} />
                    </span>
                    <div>
                      <strong>{task.title}</strong>
                      <span>
                        {task.sourceLabel} · {formatDateTime(task.dueAt)}
                      </span>
                    </div>
                    <StatusBadge tone={workflowTone(task.workflowState)}>
                      {workflowLabels[task.workflowState]}
                    </StatusBadge>
                    <Icon name="chevron" size={17} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader description="最近 7 天学习分钟数" title="学习节奏" />
            {weeklyMinutes.length > 0 ? (
              <div className="mini-chart" aria-label="最近七天学习分钟数柱状图">
                {weeklyMinutes.map((minutes, index) => (
                  <div className="chart-column" key={index}>
                    <span className="chart-value">{minutes}</span>
                    <span
                      className="chart-bar"
                      style={{ height: Math.max(12, (minutes / maxMinutes) * 100) + '%' }}
                    />
                    <small>{['一', '二', '三', '四', '五', '六', '日'][index]}</small>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState description="完成任务后会逐步形成学习节奏。" title="暂无学习时长" />
            )}
          </Card>

          <Card>
            <CardHeader
              action={
                <Link className="text-link" href="/student/paths">
                  查看路径
                </Link>
              }
              title="路径进度"
            />
            {data.activePaths.length === 0 ? (
              <EmptyState description="已加入的学习路径会显示在这里。" title="暂无进行中路径" />
            ) : (
              <div className="path-summary-list">
                {data.activePaths.map((path) => (
                  <div className="path-summary" key={path.id}>
                    <div>
                      <StatusBadge tone={path.track === 'toefl' ? 'info' : 'brand'}>
                        {path.track === 'toefl' ? 'TOEFL' : 'General'}
                      </StatusBadge>
                      <strong>{path.title}</strong>
                    </div>
                    <ProgressBar
                      label={path.currentMilestone}
                      tone={path.track === 'toefl' ? 'info' : 'brand'}
                      value={path.progressPercent}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          {!feedbackQuery.isLoading && !feedbackQuery.isError && feedbackQuery.data?.data[0] ? (
            <Card className="feedback-preview">
              <div className="feedback-quote">“</div>
              <p>{feedbackQuery.data.data[0].feedback}</p>
              <div>
                <span>最新反馈 · {feedbackQuery.data.data[0].taskTitle}</span>
                <Link href="/student/feedback">查看详情</Link>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
