'use client';

import Link from 'next/link';
import { Icon } from '@/components/icon';
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { adaptClassPage, adaptTeacherDashboard } from '@/lib/adapters';
import type { ApiClass, ApiPage, ApiTeacherDashboard } from '@/lib/api-models';
import { demoClasses, demoTeacherDashboard } from '@/lib/demo-data';
import { formatDateTime, taskKindLabels } from '@/lib/format';
import type { ClassSummary, PageEnvelope, TeacherDashboardData } from '@/lib/types';

const demoClassPage: PageEnvelope<ClassSummary> = {
  data: demoClasses,
  page: { nextCursor: null, limit: 20 },
};

export default function TeacherDashboardPage() {
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    TeacherDashboardData,
    ApiTeacherDashboard
  >('/teacher/dashboard', demoTeacherDashboard, adaptTeacherDashboard);
  const classesQuery = useTenantQuery<PageEnvelope<ClassSummary>, ApiPage<ApiClass>>(
    '/teacher/classes?pageSize=20',
    demoClassPage,
    adaptClassPage,
  );

  if (isLoading) {
    return <LoadingState label="正在整理教学工作台" />;
  }
  if (isError && error) {
    return <ErrorState error={error} onRetry={() => void reload()} />;
  }
  if (!data) return <LoadingState label="正在整理教学工作台" />;

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/teacher/assignments/new" icon="plus">
            布置任务
          </ButtonLink>
        }
        description={`当前有 ${data.awaitingGradeCount} 份待批改提交。`}
        eyebrow="教师工作台"
        title="教学总览"
      />
      <div className="stats-grid">
        <StatCard hint="当前任教或协作" icon="classes" label="班级" value={data.classCount} />
        <StatCard
          hint="班级与直接关联"
          icon="students"
          label="学生"
          tone="info"
          value={data.studentCount}
        />
        <StatCard
          hint="按提交时间排序"
          icon="grade"
          label="待批改"
          tone="warning"
          value={data.awaitingGradeCount}
        />
        <StatCard
          hint="最近 7 天"
          icon="feedback"
          label="已返回"
          tone="success"
          value={data.returnedThisWeekCount}
        />
      </div>

      <div className="content-grid">
        <Card>
          <CardHeader
            action={
              <Link className="text-link" href="/teacher/grading">
                进入批改队列
              </Link>
            }
            description="按提交时间排序，迟交会单独标记"
            title="最近提交"
          />
          {data.recentSubmissions.length === 0 ? (
            <EmptyState description="学生提交写作后会显示在这里。" title="暂无待批改提交" />
          ) : (
            <div className="compact-list submission-list">
              {data.recentSubmissions.map((submission) => (
                <Link
                  className="compact-row"
                  href={'/teacher/grading/' + submission.attemptId}
                  key={submission.attemptId}
                >
                  <span className="avatar">{submission.studentDisplayName.slice(-2)}</span>
                  <div>
                    <strong>{submission.studentDisplayName}</strong>
                    <span>
                      {submission.taskTitle} · {formatDateTime(submission.submittedAt)}
                    </span>
                  </div>
                  <StatusBadge tone={submission.isLate ? 'warning' : 'neutral'}>
                    {submission.isLate ? '迟交' : taskKindLabels[submission.kind]}
                  </StatusBadge>
                  <Icon name="chevron" size={17} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHeader
              action={
                <Link className="text-link" href="/teacher/classes">
                  查看全部
                </Link>
              }
              title="班级进度"
            />
            {classesQuery.isLoading ? (
              <LoadingState label="正在加载班级" />
            ) : classesQuery.isError ? (
              <ErrorState error={classesQuery.error!} onRetry={() => void classesQuery.reload()} />
            ) : !classesQuery.data || classesQuery.data.data.length === 0 ? (
              <EmptyState description="任教班级会显示在这里。" title="暂无班级" />
            ) : (
              <div className="class-progress-list">
                {classesQuery.data.data.map((item) => (
                  <div key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.studentCount} 名学生</span>
                    </div>
                    {item.completionRate === undefined ? null : (
                      <div className="progress-track">
                        <span
                          className="progress-fill"
                          style={{ width: item.completionRate + '%' }}
                        />
                      </div>
                    )}
                    <small>
                      {item.completionRate === undefined ? item.code : item.completionRate + '%'}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="teacher-tip">
            <span className="stat-icon">
              <Icon name="spark" size={20} />
            </span>
            <div>
              <strong>数据范围</strong>
              <p>这里只展示当前机构内、且通过班级或师生关系授权的数据。</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
