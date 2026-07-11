'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icon';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from '@/components/ui';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { adaptPathPage } from '@/lib/adapters';
import { ApiProblemError, apiRequest, isDemoMode, tenantPath } from '@/lib/api';
import type { ApiPage, ApiPathDetail, ApiPathEnrollment } from '@/lib/api-models';
import { demoPaths } from '@/lib/demo-data';
import { formatDate } from '@/lib/format';
import type { PageEnvelope, PathMilestone, PathSummary } from '@/lib/types';
import { useWorkspace } from '@/components/workspace-provider';

const fallback: PageEnvelope<PathSummary> = {
  data: demoPaths,
  page: { nextCursor: null, limit: 20 },
};

export default function StudentPathsPage() {
  const { currentTenant } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<PathMilestone[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ApiProblemError | null>(null);
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    PageEnvelope<PathSummary>,
    ApiPage<ApiPathEnrollment>
  >('/student/learning-paths?pageSize=20', fallback, adaptPathPage);

  const selected = data?.data.find((path) => path.id === selectedId) ?? data?.data[0];

  useEffect(() => {
    if (!isLoading && !isError && !selectedId && data?.data[0]) setSelectedId(data.data[0].id);
  }, [data, isError, isLoading, selectedId]);

  useEffect(() => {
    if (isLoading || isError || !selected) return;
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    if (isDemoMode()) {
      setMilestones([
        {
          key: 'current',
          title: selected.currentMilestone,
          position: 1,
          state: 'current',
          completedTaskCount: 0,
          totalTaskCount: 2,
        },
      ]);
      setDetailLoading(false);
      return;
    }
    void apiRequest<ApiPathDetail>(
      tenantPath(currentTenant.id, '/student/learning-paths/' + selected.id),
    )
      .then((detail) => {
        if (active) setMilestones(detail.milestones);
      })
      .catch((caught) => {
        if (active)
          setDetailError(
            caught instanceof ApiProblemError
              ? caught
              : new ApiProblemError({
                  type: 'about:blank',
                  title: '路径详情加载失败',
                  status: 500,
                }),
          );
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentTenant.id, isError, isLoading, selected]);

  if (isLoading) {
    return <LoadingState label="正在加载学习路径" />;
  }
  if (isError && error) {
    return <ErrorState error={error} onRetry={() => void reload()} />;
  }
  if (!data) return <LoadingState label="正在加载学习路径" />;
  if (data.data.length === 0) {
    return (
      <EmptyState
        description="教师为你分配学习路径后，进度会显示在这里。"
        icon="path"
        title="暂时没有学习路径"
      />
    );
  }

  if (!selected) return null;
  const completedMilestones = milestones.filter(
    (milestone) => milestone.state === 'completed',
  ).length;
  const totalMilestones = milestones.length;

  return (
    <>
      <PageHeader
        description="路径版本在加入时固定，后续升级不会悄悄改变正在进行的学习计划。"
        eyebrow="学生工作台"
        title="学习路径"
      />
      <div className="paths-layout">
        <div className="path-selector">
          {data.data.map((path) => (
            <button
              aria-pressed={selected.id === path.id}
              className={
                selected.id === path.id ? 'path-select-card is-active' : 'path-select-card'
              }
              key={path.id}
              onClick={() => setSelectedId(path.id)}
              type="button"
            >
              <div>
                <StatusBadge tone={path.track === 'toefl' ? 'info' : 'brand'}>
                  {path.track === 'toefl' ? 'TOEFL' : 'General'}
                </StatusBadge>
                <span>{path.progressPercent}%</span>
              </div>
              <strong>{path.title}</strong>
              <p>{path.currentMilestone}</p>
              <ProgressBar label="路径完成度" value={path.progressPercent} />
            </button>
          ))}
        </div>
        <Card className="path-detail">
          <div className="path-detail-head">
            <div>
              <StatusBadge tone={selected.track === 'toefl' ? 'info' : 'brand'}>
                {selected.track === 'toefl' ? 'TOEFL 路径' : 'General 路径'}
              </StatusBadge>
              <h2>{selected.title}</h2>
              <p>
                目标完成日期：{formatDate(selected.targetCompletionDate)}
                {totalMilestones > 0
                  ? ` · 已完成 ${completedMilestones}/${totalMilestones} 个里程碑`
                  : ''}
              </p>
            </div>
            <div className="path-percent">
              <strong>{selected.progressPercent}%</strong>
              <span>已完成</span>
            </div>
          </div>
          {detailError ? (
            <ErrorState error={detailError} onRetry={() => void reload()} />
          ) : detailLoading ? (
            <LoadingState label="正在加载路径详情" />
          ) : (
            <div className="milestone-list">
              {milestones.map((milestone, index) => (
                <div
                  className={
                    'milestone milestone-' +
                    (milestone.state === 'active' ? 'current' : milestone.state)
                  }
                  key={milestone.key}
                >
                  <span className="milestone-dot">
                    {milestone.state === 'completed' ? <Icon name="check" size={15} /> : index + 1}
                  </span>
                  <div>
                    <strong>{milestone.title}</strong>
                    <p>
                      已完成 {milestone.completedTaskCount} / {milestone.totalTaskCount} 项任务
                    </p>
                  </div>
                  {milestone.state === 'current' || milestone.state === 'active' ? (
                    <StatusBadge tone="warning">进行中</StatusBadge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
