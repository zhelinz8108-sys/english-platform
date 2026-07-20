'use client';

import { useMemo } from 'react';

import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  StatCard,
} from '@/components/ui';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { adaptProgress } from '@/lib/adapters';
import type { ApiStudentProgress } from '@/lib/api-models';
import { demoProgress } from '@/lib/demo-data';
import { formatPercent, taskKindLabels } from '@/lib/format';
import type { StudentProgressData } from '@/lib/types';

export default function StudentProgressPage() {
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, []);
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    StudentProgressData,
    ApiStudentProgress
  >(`/student/progress?from=${range.from}&to=${range.to}`, demoProgress, adaptProgress);

  if (isLoading) {
    return <LoadingState label="正在生成学习进度" />;
  }
  if (isError && error) {
    return <ErrorState error={error} onRetry={() => void reload()} />;
  }
  if (!data) return <LoadingState label="正在生成学习进度" />;

  const completionRate =
    data.assignedCount === 0 ? 0 : Math.round((data.completedCount / data.assignedCount) * 100);
  const onTimeRate =
    data.completedCount === 0 ? 0 : Math.round((data.onTimeCount / data.completedCount) * 100);
  const scoredKinds = data.byKind.flatMap((item) =>
    item.averageScorePercent === null ? [] : [item.averageScorePercent],
  );
  const averageScore =
    scoredKinds.length === 0
      ? null
      : Math.round(scoredKinds.reduce((total, score) => total + score, 0) / scoredKinds.length);

  return (
    <>
      <PageHeader
        description="过去 30 天的基础进度，帮助你看清完成节奏和不同任务类型的表现。"
        eyebrow="学生工作台"
        title="学习进度"
      />
      <div className="stats-grid">
        <StatCard hint="过去 30 天" icon="tasks" label="已完成" value={data.completedCount} />
        <StatCard
          hint={data.assignedCount + ' 项已分配'}
          icon="chart"
          label="完成率"
          tone="success"
          value={completionRate + '%'}
        />
        <StatCard
          hint={data.lateCount + ' 次迟交'}
          icon="clock"
          label="按时提交"
          tone="info"
          value={onTimeRate + '%'}
        />
        <StatCard
          hint="按任务类型汇总"
          icon="target"
          label="当前均分"
          tone="warning"
          value={averageScore === null ? '—' : averageScore}
        />
      </div>

      <div className="content-grid progress-layout">
        <Card>
          <CardHeader description="最近六周已完成任务的平均得分" title="成绩趋势" />
          {data.weeklyScores && data.weeklyScores.length > 0 ? (
            <div className="score-chart" aria-label="六周平均成绩趋势图">
              <div className="score-grid" aria-hidden="true">
                <span>100</span>
                <span>75</span>
                <span>50</span>
              </div>
              <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 500 180">
                <defs>
                  <linearGradient id="scoreArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#3f8178" stopOpacity="0.26" />
                    <stop offset="100%" stopColor="#3f8178" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M20 132 L112 118 L204 124 L296 92 L388 78 L480 58 L480 165 L20 165 Z"
                  fill="url(#scoreArea)"
                />
                <path
                  d="M20 132 L112 118 L204 124 L296 92 L388 78 L480 58"
                  fill="none"
                  stroke="#3f8178"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="4"
                />
                {data.weeklyScores.map((score, index) => (
                  <circle
                    cx={20 + index * 92}
                    cy={[132, 118, 124, 92, 78, 58][index]}
                    fill="white"
                    key={score + '-' + index}
                    r="6"
                    stroke="#3f8178"
                    strokeWidth="3"
                  />
                ))}
              </svg>
              <div className="score-axis">
                {['第 1 周', '第 2 周', '第 3 周', '第 4 周', '第 5 周', '本周'].map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState description="当前接口暂未提供按周成绩序列。" title="暂无趋势数据" />
          )}
        </Card>

        <Card>
          <CardHeader description="按课程、练习、测评和写作拆分" title="任务类型" />
          <div className="kind-progress-list">
            {data.byKind.map((item) => (
              <div key={item.kind}>
                <div className="kind-progress-heading">
                  <strong>{taskKindLabels[item.kind]}</strong>
                  <span>
                    {item.completed} / {item.assigned} ·{' '}
                    {item.averageScorePercent === null
                      ? '暂无成绩'
                      : '均分 ' + formatPercent(item.averageScorePercent)}
                  </span>
                </div>
                <ProgressBar
                  label="完成率"
                  value={item.assigned === 0 ? 0 : (item.completed / item.assigned) * 100}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
