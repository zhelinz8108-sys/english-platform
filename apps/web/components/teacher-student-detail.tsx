'use client';

import { useMemo } from 'react';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { adaptTaskItem } from '@/lib/adapters';
import { isDemoMode } from '@/lib/api';
import type { ApiTeacherStudentDetail } from '@/lib/api-models';
import { demoStudents, demoTasks } from '@/lib/demo-data';
import { formatDateTime, workflowLabels, workflowTone } from '@/lib/format';
import {
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
} from './ui';

export function TeacherStudentDetail({ studentMembershipId }: { studentMembershipId: string }) {
  const demoFallback = useMemo<ApiTeacherStudentDetail>(() => {
    if (isDemoMode()) {
      const student =
        demoStudents.find((item) => item.membershipId === studentMembershipId) ?? demoStudents[0]!;
      return {
        student: {
          membershipId: student.membershipId,
          displayName: student.displayName,
          studentNumber: student.studentNumber,
          classIds: student.classIds ?? [],
          activePathCount: student.activePathCount,
          overdueTaskCount: student.overdueTaskCount,
        },
        examGoals: [],
        progress: {
          assignedCount: demoTasks.length,
          completedCount: demoTasks.filter((task) => task.workflowState === 'completed').length,
          averageScorePercent: student.averageScore ?? null,
          overdueTaskCount: student.overdueTaskCount,
          activePathCount: student.activePathCount,
        },
        recentTaskItems: demoTasks.map((task) => ({
          ...task,
          title: task.title,
        })),
      };
    }
    return {
      student: {
        membershipId: studentMembershipId,
        displayName: '',
        studentNumber: null,
        classIds: [],
        activePathCount: 0,
        overdueTaskCount: 0,
      },
      examGoals: [],
      progress: {},
      recentTaskItems: [],
    };
  }, [studentMembershipId]);
  const { data, error, isError, isLoading, reload } = useTenantQuery<ApiTeacherStudentDetail>(
    '/teacher/students/' + studentMembershipId,
    demoFallback,
  );

  if (isLoading) return <LoadingState label="正在加载学生详情" />;
  if (isError && error) return <ErrorState error={error} onRetry={() => void reload()} />;
  if (!data) return <LoadingState label="正在加载学生详情" />;

  const completed = data.progress.completedCount ?? 0;
  const assigned = data.progress.assignedCount ?? 0;
  const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : null;
  const tasks = data.recentTaskItems.map(adaptTaskItem);

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/teacher/assignments/new" icon="assign">
            布置个人任务
          </ButtonLink>
        }
        description={`${data.student.studentNumber ?? '未设置学号'} · ${data.student.classIds.length} 个班级`}
        eyebrow="学生详情"
        title={data.student.displayName}
      />
      <div className="stats-grid">
        <StatCard
          hint="当前统计范围"
          icon="tasks"
          label="任务完成率"
          value={completionRate === null ? '—' : completionRate + '%'}
        />
        <StatCard
          hint="已返回成绩"
          icon="chart"
          label="平均分"
          tone="info"
          value={data.progress.averageScorePercent ?? '—'}
        />
        <StatCard
          hint="当前有效路径"
          icon="path"
          label="学习路径"
          tone="success"
          value={data.progress.activePathCount ?? data.student.activePathCount}
        />
        <StatCard
          hint="需要跟进"
          icon="alert"
          label="逾期任务"
          tone={
            (data.progress.overdueTaskCount ?? data.student.overdueTaskCount) > 0
              ? 'warning'
              : 'success'
          }
          value={data.progress.overdueTaskCount ?? data.student.overdueTaskCount}
        />
      </div>
      <div className="content-grid">
        <Card>
          <div className="card-header">
            <div>
              <h2>最近任务</h2>
              <p>只显示当前教师可见的任务</p>
            </div>
          </div>
          {tasks.length === 0 ? (
            <EmptyState description="接口暂未返回该学生的近期任务。" title="暂无任务数据" />
          ) : (
            <div className="compact-list">
              {tasks.map((task) => (
                <div className="compact-row" key={task.id}>
                  <span className={'task-kind-icon kind-' + task.kind}>
                    {task.title.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{formatDateTime(task.dueAt)}</span>
                  </div>
                  <StatusBadge tone={workflowTone(task.workflowState)}>
                    {workflowLabels[task.workflowState]}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="card-header">
            <div>
              <h2>考试目标</h2>
              <p>学生登记的多考试目标</p>
            </div>
          </div>
          {data.examGoals.length === 0 ? (
            <EmptyState description="学生尚未登记考试目标。" title="暂无考试目标" />
          ) : (
            data.examGoals.map((goal, index) => (
              <div className="goal-card" key={goal.id ?? index}>
                <strong>
                  {goal.examType ?? '考试'} {goal.targetScore ?? ''}
                </strong>
                <span>{goal.targetDate ?? '未设置目标日期'}</span>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
