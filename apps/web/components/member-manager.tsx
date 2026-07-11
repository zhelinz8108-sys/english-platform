'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { TenantRole } from '@english/shared';
import {
  ApiProblemError,
  apiRequest,
  createIdempotencyKey,
  isDemoMode,
  tenantPath,
} from '@/lib/api';
import { demoMemberships } from '@/lib/demo-data';
import type { ApiMembership, ApiPage } from '@/lib/api-models';
import { formatDate, roleLabels } from '@/lib/format';
import type { Membership } from '@/lib/types';
import { Icon } from './icon';
import { Card, EmptyState, InlineNotice, LoadingState, StatusBadge } from './ui';
import { useWorkspace } from './workspace-provider';

export function MemberManager() {
  const { currentTenant } = useWorkspace();
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TenantRole>('student');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiProblemError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      setMembers(demoMemberships);
      setLoading(false);
      return;
    }
    try {
      const page = await apiRequest<ApiPage<ApiMembership>>(
        tenantPath(currentTenant.id, '/admin/memberships?pageSize=100'),
      );
      setMembers(
        page.data.map((member) => ({
          id: member.membershipId ?? member.id,
          email: member.email,
          displayName: member.displayName,
          status: member.status,
          roles: member.roles,
          joinedAt: member.joinedAt,
        })),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '成员加载失败',
              status: 500,
              detail: '请刷新后重试。',
            }),
      );
    } finally {
      setLoading(false);
    }
  }, [currentTenant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('zh-CN');
    return members.filter(
      (member) =>
        member.displayName.toLocaleLowerCase('zh-CN').includes(term) ||
        member.email.toLocaleLowerCase('zh-CN').includes(term),
    );
  }, [members, query]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!isDemoMode()) {
        await apiRequest(tenantPath(currentTenant.id, '/admin/memberships'), {
          method: 'POST',
          idempotencyKey: createIdempotencyKey('invite-membership'),
          json: { email, roles: [role], displayName: null },
        });
        await load();
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        const local: Membership = {
          id: 'member-local-' + Date.now(),
          email,
          displayName: email.split('@')[0] || '新成员',
          status: 'invited',
          roles: [role],
          joinedAt: null,
        };
        setMembers((current) => [local, ...current]);
      }
      setEmail('');
      setInviteOpen(false);
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '邀请失败',
              status: 500,
              detail: '请检查邮箱和角色后重试。',
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="正在加载机构成员" />;

  return (
    <>
      <Card padding={false}>
        <div className="list-toolbar">
          <label className="search-box">
            <span className="sr-only">搜索成员</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="姓名或邮箱"
              type="search"
              value={query}
            />
          </label>
          <button
            className="button button-primary"
            onClick={() => setInviteOpen((open) => !open)}
            type="button"
          >
            <Icon name={inviteOpen ? 'close' : 'plus'} size={17} />
            {inviteOpen ? '取消' : '邀请成员'}
          </button>
        </div>
        {inviteOpen ? (
          <form className="invite-form" onSubmit={(event) => void invite(event)}>
            <label className="field">
              <span>邮箱</span>
              <input
                autoFocus
                onChange={(event) => setEmail(event.target.value)}
                placeholder="member@example.com"
                required
                type="email"
                value={email}
              />
            </label>
            <label className="field">
              <span>初始角色</span>
              <select onChange={(event) => setRole(event.target.value as TenantRole)} value={role}>
                <option value="student">学生</option>
                <option value="teacher">教师</option>
                <option value="admin">机构管理员</option>
                <option value="content_editor">内容编辑</option>
              </select>
            </label>
            <button className="button button-primary" disabled={submitting} type="submit">
              {submitting ? '发送中' : '发送邀请'}
            </button>
          </form>
        ) : null}
        {error ? (
          <div className="panel-message">
            <InlineNotice title={error.problem.title} tone="danger">
              {error.problem.detail}
            </InlineNotice>
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <EmptyState description="调整搜索条件，或邀请新成员。" title="没有找到成员" />
        ) : (
          <div className="member-table">
            <div className="member-table-head">
              <span>成员</span>
              <span>角色</span>
              <span>状态</span>
              <span>加入时间</span>
              <span />
            </div>
            {filtered.map((member) => (
              <div className="member-table-row" key={member.id}>
                <span className="student-cell">
                  <span className="avatar">{member.displayName.slice(-2)}</span>
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>{member.email}</small>
                  </span>
                </span>
                <span className="role-list">
                  {member.roles.map((item) => (
                    <StatusBadge key={item}>{roleLabels[item]}</StatusBadge>
                  ))}
                </span>
                <span>
                  <StatusBadge
                    tone={
                      member.status === 'active'
                        ? 'success'
                        : member.status === 'invited'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {member.status === 'active'
                      ? '正常'
                      : member.status === 'invited'
                        ? '待加入'
                        : '已停用'}
                  </StatusBadge>
                </span>
                <span>{formatDate(member.joinedAt)}</span>
                <span aria-label={member.displayName + ' 的成员记录'}>—</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
