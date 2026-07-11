'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icon';
import {
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from '@/components/ui';
import { demoClasses, demoStudents } from '@/lib/demo-data';
import { useTenantQuery } from '@/hooks/use-tenant-query';
import { adaptClassPage, adaptStudent } from '@/lib/adapters';
import { ApiProblemError, apiRequest, isDemoMode, tenantPath } from '@/lib/api';
import type { ApiClass, ApiClassDetail, ApiPage } from '@/lib/api-models';
import { formatDateTime } from '@/lib/format';
import type { ClassSummary, PageEnvelope, StudentSummary } from '@/lib/types';
import { useWorkspace } from '@/components/workspace-provider';

const demoClassPage: PageEnvelope<ClassSummary> = {
  data: demoClasses,
  page: { nextCursor: null, limit: 50 },
};

export default function TeacherClassesPage() {
  const { currentTenant } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roster, setRoster] = useState<StudentSummary[]>([]);
  const [detailError, setDetailError] = useState<ApiProblemError | null>(null);
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    PageEnvelope<ClassSummary>,
    ApiPage<ApiClass>
  >('/teacher/classes?pageSize=50', demoClassPage, adaptClassPage);
  const classes = useMemo(
    () =>
      (data?.data ?? []).filter((item) =>
        item.name.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN')),
      ),
    [data?.data, query],
  );
  const selected = data?.data.find((item) => item.id === selectedId) ?? data?.data[0];

  useEffect(() => {
    if (!isLoading && !isError && !selectedId && data?.data[0]) setSelectedId(data.data[0].id);
  }, [data, isError, isLoading, selectedId]);

  useEffect(() => {
    if (isLoading || isError || !selected) return;
    let active = true;
    setDetailError(null);
    if (isDemoMode()) {
      setRoster(demoStudents.slice(0, selected.studentCount));
      return;
    }
    void apiRequest<ApiClassDetail>(tenantPath(currentTenant.id, '/teacher/classes/' + selected.id))
      .then((detail) => {
        if (active) setRoster(detail.students.map(adaptStudent));
      })
      .catch((caught) => {
        if (active)
          setDetailError(
            caught instanceof ApiProblemError
              ? caught
              : new ApiProblemError({
                  type: 'about:blank',
                  title: '班级详情加载失败',
                  status: 500,
                }),
          );
      });
    return () => {
      active = false;
    };
  }, [currentTenant.id, isError, isLoading, selected]);

  if (isLoading) return <LoadingState label="正在加载班级" />;
  if (isError && error) return <ErrorState error={error} onRetry={() => void reload()} />;
  if (!data) return <LoadingState label="正在加载班级" />;

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/teacher/assignments/new" icon="assign" variant="secondary">
            按班布置任务
          </ButtonLink>
        }
        description="查看任教班级、成员规模与最近任务完成情况。"
        eyebrow="教师工作台"
        title="班级"
      />
      <div className="master-detail">
        <Card className="master-list">
          <label className="search-box">
            <span className="sr-only">搜索班级</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索班级"
              type="search"
              value={query}
            />
          </label>
          <div className="class-card-list">
            {classes.length === 0 ? (
              <EmptyState description="任教或协作班级会显示在这里。" title="暂无班级" />
            ) : null}
            {classes.map((item) => (
              <button
                aria-pressed={selected?.id === item.id}
                className={selected?.id === item.id ? 'class-select is-active' : 'class-select'}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <div>
                  <strong>{item.name}</strong>
                  <StatusBadge tone={item.status === 'active' ? 'success' : 'neutral'}>
                    {item.status === 'active' ? '进行中' : '已归档'}
                  </StatusBadge>
                </div>
                <p>
                  {item.code} · {item.studentCount} 名学生 · {item.teacherCount} 名教师
                </p>
                {item.completionRate === undefined ? null : (
                  <ProgressBar label="近期完成率" value={item.completionRate} />
                )}
              </button>
            ))}
          </div>
        </Card>
        {selected ? (
          <Card className="detail-panel">
            <div className="detail-panel-head">
              <div>
                <p className="eyebrow">{selected.code}</p>
                <h2>{selected.name}</h2>
                <p>
                  {selected.studentCount} 名学生
                  {selected.nextDueAt ? ' · 下次截止 ' + formatDateTime(selected.nextDueAt) : ''}
                </p>
              </div>
              <ButtonLink href="/teacher/assignments/new" icon="plus">
                布置任务
              </ButtonLink>
            </div>
            <div className="detail-stats">
              <div>
                <strong>
                  {selected.completionRate === undefined ? '—' : selected.completionRate + '%'}
                </strong>
                <span>任务完成率</span>
              </div>
              <div>
                <strong>—</strong>
                <span>近 30 天均分</span>
              </div>
              <div>
                <strong>
                  {roster.reduce((total, student) => total + student.overdueTaskCount, 0)}
                </strong>
                <span>逾期任务</span>
              </div>
            </div>
            <div className="panel-section">
              <div className="card-header">
                <div>
                  <h2>学生概览</h2>
                  <p>按最近活跃时间排序</p>
                </div>
              </div>
              {detailError ? (
                <ErrorState error={detailError} onRetry={() => void reload()} />
              ) : roster.length === 0 ? (
                <EmptyState description="该班级目前没有在班学生。" title="暂无学生" />
              ) : (
                <div className="roster-list">
                  {roster.slice(0, 10).map((student) => (
                    <div key={student.membershipId}>
                      <span className="avatar">{student.displayName.slice(-2)}</span>
                      <div>
                        <strong>{student.displayName}</strong>
                        <span>{student.studentNumber}</span>
                      </div>
                      <span>
                        {student.completionRate === undefined
                          ? '暂无进度'
                          : student.completionRate + '% 完成'}
                      </span>
                      {student.overdueTaskCount > 0 ? (
                        <StatusBadge tone="warning">{student.overdueTaskCount} 项逾期</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">正常</StatusBadge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ) : (
          <EmptyState description="选择一个班级查看详情。" title="没有选中班级" />
        )}
      </div>
    </>
  );
}
