'use client';

import { useEffect, useState } from 'react';
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
import { useWorkspace } from '@/components/workspace-provider';
import { adaptCatalog } from '@/lib/adapters';
import { ApiProblemError, apiRequest, isDemoMode, tenantPath } from '@/lib/api';
import type { ApiCatalogEntity, ApiMembership, ApiPage } from '@/lib/api-models';
import { demoCatalog, demoMemberships } from '@/lib/demo-data';
import { formatDateTime, roleLabels } from '@/lib/format';
import type { CatalogItem, Membership } from '@/lib/types';

export default function AdminDashboardPage() {
  const { currentTenant } = useWorkspace();
  const [members, setMembers] = useState<Membership[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiProblemError | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      setMembers(demoMemberships);
      setCatalog(demoCatalog);
      setLoading(false);
      return;
    }
    void Promise.all([
      apiRequest<ApiPage<ApiMembership>>(
        tenantPath(currentTenant.id, '/admin/memberships?pageSize=100'),
      ),
      apiRequest<ApiPage<ApiCatalogEntity>>(
        tenantPath(currentTenant.id, '/admin/contents?pageSize=100'),
      ),
      apiRequest<ApiPage<ApiCatalogEntity>>(
        tenantPath(currentTenant.id, '/admin/questions?pageSize=100'),
      ),
      apiRequest<ApiPage<ApiCatalogEntity>>(
        tenantPath(currentTenant.id, '/admin/tasks?pageSize=100'),
      ),
      apiRequest<ApiPage<ApiCatalogEntity>>(
        tenantPath(currentTenant.id, '/admin/learning-paths?pageSize=100'),
      ),
    ])
      .then(([membershipPage, ...pages]) => {
        if (!active) return;
        setMembers(
          membershipPage.data.map((member) => ({
            id: member.membershipId ?? member.id,
            email: member.email,
            displayName: member.displayName,
            status: member.status,
            roles: member.roles,
            joinedAt: member.joinedAt,
          })),
        );
        setCatalog(
          pages.flatMap((page, index) =>
            page.data.map((item) =>
              adaptCatalog(item, (['content', 'question', 'task', 'path'] as const)[index]!),
            ),
          ),
        );
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof ApiProblemError
              ? caught
              : new ApiProblemError({
                  type: 'about:blank',
                  title: '机构总览加载失败',
                  status: 500,
                }),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentTenant.id]);

  if (loading) return <LoadingState label="正在加载机构总览" />;
  if (error) return <ErrorState error={error} onRetry={() => window.location.reload()} />;

  const activeMembers = members.filter((member) => member.status === 'active').length;
  const teacherCount = members.filter((member) => member.roles.includes('teacher')).length;
  const draftCount = catalog.filter((item) => item.publicationState === 'draft').length;

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/admin/members" icon="plus">
            邀请成员
          </ButtonLink>
        }
        description="管理成员权限、租户内容副本与不可变发布版本。"
        eyebrow="机构管理"
        title="机构总览"
      />
      <div className="stats-grid">
        <StatCard hint="跨角色去重" icon="users" label="活跃成员" value={activeMembers} />
        <StatCard
          hint="教师与协作教师"
          icon="students"
          label="教师"
          tone="info"
          value={teacherCount}
        />
        <StatCard
          hint="租户自有与平台只读"
          icon="library"
          label="内容实体"
          tone="success"
          value={catalog.length}
        />
        <StatCard
          hint="需要编辑后发布"
          icon="alert"
          label="草稿版本"
          tone="warning"
          value={draftCount}
        />
      </div>
      <div className="content-grid">
        <Card>
          <CardHeader
            action={
              <ButtonLink href="/admin/members" variant="ghost">
                管理成员
              </ButtonLink>
            }
            title="最近成员"
          />
          {members.length === 0 ? (
            <EmptyState description="邀请成员后会显示在这里。" title="暂无成员" />
          ) : (
            <div className="compact-list">
              {members.slice(0, 4).map((member) => (
                <div className="compact-row" key={member.id}>
                  <span className="avatar">{member.displayName.slice(-2)}</span>
                  <div>
                    <strong>{member.displayName}</strong>
                    <span>{member.email}</span>
                  </div>
                  <span className="role-list">
                    {member.roles.map((role) => (
                      <StatusBadge key={role}>{roleLabels[role]}</StatusBadge>
                    ))}
                  </span>
                  <StatusBadge tone={member.status === 'active' ? 'success' : 'warning'}>
                    {member.status === 'active' ? '正常' : '待加入'}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader
            action={
              <ButtonLink href="/admin/content" variant="ghost">
                内容管理
              </ButtonLink>
            }
            title="最近更新"
          />
          {catalog.length === 0 ? (
            <EmptyState description="创建或复制内容后会显示在这里。" title="暂无内容" />
          ) : (
            <div className="catalog-mini-list">
              {catalog.slice(0, 4).map((item) => (
                <div key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.ownership === 'platform' ? '平台只读目录' : '机构内容'}
                      {item.versionNumber === undefined ? '' : ' · v' + item.versionNumber}
                    </span>
                  </div>
                  <StatusBadge tone={item.publicationState === 'published' ? 'success' : 'warning'}>
                    {item.publicationState === 'published' ? '已发布' : '草稿'}
                  </StatusBadge>
                  <small>{formatDateTime(item.updatedAt)}</small>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
