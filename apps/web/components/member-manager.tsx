'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiProblemError, apiRequest, isDemoMode, tenantPath } from '@/lib/api';
import { demoMemberships } from '@/lib/demo-data';
import type { ApiMembership, ApiPage, ApiStudentCredential } from '@/lib/api-models';
import { formatDate, roleLabels } from '@/lib/format';
import {
  credentialsCsv,
  parseStudentAccountCsv,
  studentAccountTemplateCsv,
  type StudentAccountDraft,
} from '@/lib/student-accounts';
import type { Membership } from '@/lib/types';
import { Icon } from './icon';
import { Card, EmptyState, InlineNotice, LoadingState, StatusBadge } from './ui';
import { useWorkspace } from './workspace-provider';

const emptyStudent: StudentAccountDraft = {
  loginName: '',
  displayName: '',
  email: null,
  studentNumber: null,
  gradeLevel: null,
};

function downloadCsv(filename: string, content: string) {
  const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function adaptMember(member: ApiMembership): Membership {
  return {
    id: member.membershipId ?? member.id,
    email: member.email,
    loginName: member.loginName,
    displayName: member.displayName,
    status: member.status,
    roles: member.roles,
    joinedAt: member.joinedAt,
    mustChangePassword: member.mustChangePassword,
    studentNumber: member.studentNumber,
    gradeLevel: member.gradeLevel,
  };
}

export function MemberManager() {
  const { currentTenant } = useWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<StudentAccountDraft>(emptyStudent);
  const [submitting, setSubmitting] = useState(false);
  const [workingMemberId, setWorkingMemberId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<ApiStudentCredential[]>([]);
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
      setMembers(page.data.map(adaptMember));
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
    return members.filter((member) =>
      [member.displayName, member.email ?? '', member.loginName ?? '', member.studentNumber ?? '']
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(term),
    );
  }, [members, query]);

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isDemoMode()) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        setCredentials([
          {
            membershipId: `demo-${Date.now()}`,
            loginName: draft.loginName,
            displayName: draft.displayName,
            studentNumber: draft.studentNumber ?? null,
            gradeLevel: draft.gradeLevel ?? null,
            email: draft.email ?? null,
            temporaryPassword: 'Demo-Temp-2026!',
            mustChangePassword: true,
          },
        ]);
      } else {
        const result = await apiRequest<{ data: ApiStudentCredential }>(
          tenantPath(currentTenant.id, '/admin/student-accounts'),
          { method: 'POST', json: draft },
        );
        setCredentials([result.data]);
        await load();
      }
      setDraft(emptyStudent);
      setCreateOpen(false);
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '学生账号开通失败',
              status: 500,
              detail: '请检查登录名是否重复后重试。',
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function importCsv(file: File) {
    setSubmitting(true);
    setError(null);
    try {
      const students = parseStudentAccountCsv(await file.text());
      if (students.length === 0) throw new Error('CSV 中没有学生记录。');
      if (students.length > 200) throw new Error('每次最多导入 200 个学生账号。');
      const result = await apiRequest<{ data: ApiStudentCredential[] }>(
        tenantPath(currentTenant.id, '/admin/student-accounts/bulk'),
        { method: 'POST', json: { students } },
      );
      setCredentials(result.data);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: 'CSV 导入失败',
              status: 400,
              detail: caught instanceof Error ? caught.message : '请检查 CSV 内容。',
            }),
      );
    } finally {
      setSubmitting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function resetPassword(member: Membership) {
    if (!window.confirm(`确定重置 ${member.displayName} 的密码吗？该学生当前登录会立即失效。`)) {
      return;
    }
    setWorkingMemberId(member.id);
    setError(null);
    try {
      const result = await apiRequest<ApiStudentCredential>(
        tenantPath(currentTenant.id, `/admin/memberships/${member.id}/reset-password`),
        { method: 'POST' },
      );
      setCredentials([result]);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '密码重置失败',
              status: 500,
              detail: '请稍后重试。',
            }),
      );
    } finally {
      setWorkingMemberId(null);
    }
  }

  async function setMemberStatus(member: Membership, status: 'active' | 'suspended') {
    setWorkingMemberId(member.id);
    setError(null);
    try {
      await apiRequest(tenantPath(currentTenant.id, `/admin/memberships/${member.id}`), {
        method: 'PATCH',
        json: { status },
      });
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '成员状态更新失败',
              status: 500,
              detail: '请稍后重试。',
            }),
      );
    } finally {
      setWorkingMemberId(null);
    }
  }

  if (loading) return <LoadingState label="正在加载成员" />;

  return (
    <>
      {credentials.length > 0 ? (
        <Card>
          <InlineNotice title={`已生成 ${credentials.length} 个临时登录凭据`} tone="warning">
            临时密码只在这里显示一次。请立即下载或复制，并通过安全渠道分别交给学生。
          </InlineNotice>
          <div className="credential-toolbar">
            <button
              className="button button-secondary"
              onClick={() =>
                void navigator.clipboard.writeText(
                  credentials
                    .map(
                      (item) =>
                        `${item.displayName ?? item.loginName}：${item.loginName} / ${item.temporaryPassword}`,
                    )
                    .join('\n'),
                )
              }
              type="button"
            >
              复制全部
            </button>
            <button
              className="button button-primary"
              onClick={() =>
                downloadCsv(
                  `student-credentials-${new Date().toISOString().slice(0, 10)}.csv`,
                  credentialsCsv(credentials),
                )
              }
              type="button"
            >
              下载凭据 CSV
            </button>
            <button
              className="button button-ghost"
              onClick={() => setCredentials([])}
              type="button"
            >
              我已保存，关闭
            </button>
          </div>
          <div className="credential-list">
            {credentials.map((item) => (
              <code key={item.membershipId}>
                {item.displayName ?? item.loginName}　账号：{item.loginName}　临时密码：
                {item.temporaryPassword}
              </code>
            ))}
          </div>
        </Card>
      ) : null}
      <Card padding={false}>
        <div className="list-toolbar">
          <label className="search-box">
            <span className="sr-only">搜索成员</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="姓名、账号、邮箱或学号"
              type="search"
              value={query}
            />
          </label>
          <div className="toolbar-actions">
            <input
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCsv(file);
              }}
              ref={fileInput}
              type="file"
            />
            <button
              className="button button-secondary"
              onClick={() =>
                downloadCsv('student-account-template.csv', studentAccountTemplateCsv())
              }
              type="button"
            >
              下载模板
            </button>
            <button
              className="button button-secondary"
              disabled={submitting}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              批量导入 CSV
            </button>
            <button
              className="button button-primary"
              onClick={() => setCreateOpen((open) => !open)}
              type="button"
            >
              <Icon name={createOpen ? 'close' : 'plus'} size={17} />
              {createOpen ? '取消' : '开通学生账号'}
            </button>
          </div>
        </div>
        {createOpen ? (
          <form
            className="invite-form student-account-form"
            onSubmit={(event) => void createStudent(event)}
          >
            <label className="field">
              <span>学生姓名</span>
              <input
                autoFocus
                maxLength={100}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, displayName: event.target.value }))
                }
                required
                value={draft.displayName}
              />
            </label>
            <label className="field">
              <span>登录名</span>
              <input
                autoCapitalize="none"
                maxLength={64}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, loginName: event.target.value }))
                }
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}"
                placeholder="student001"
                required
                value={draft.loginName}
              />
            </label>
            <label className="field">
              <span>学号（可选）</span>
              <input
                maxLength={64}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, studentNumber: event.target.value || null }))
                }
                value={draft.studentNumber ?? ''}
              />
            </label>
            <label className="field">
              <span>年级（可选）</span>
              <input
                maxLength={64}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, gradeLevel: event.target.value || null }))
                }
                placeholder="Grade 7"
                value={draft.gradeLevel ?? ''}
              />
            </label>
            <label className="field">
              <span>邮箱（可选）</span>
              <input
                maxLength={254}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, email: event.target.value || null }))
                }
                type="email"
                value={draft.email ?? ''}
              />
            </label>
            <button className="button button-primary" disabled={submitting} type="submit">
              {submitting ? '正在开通' : '生成账号和临时密码'}
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
          <EmptyState description="调整搜索条件，或开通学生账号。" title="没有找到成员" />
        ) : (
          <div className="member-table">
            <div className="member-table-head">
              <span>成员</span>
              <span>角色</span>
              <span>状态</span>
              <span>加入时间</span>
              <span>操作</span>
            </div>
            {filtered.map((member) => (
              <div className="member-table-row" key={member.id}>
                <span className="student-cell">
                  <span className="avatar">{member.displayName.slice(-2)}</span>
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>
                      {member.loginName ? `账号：${member.loginName}` : member.email}
                      {member.studentNumber ? ` · 学号：${member.studentNumber}` : ''}
                    </small>
                  </span>
                </span>
                <span className="role-list">
                  {member.roles.map((item) => (
                    <StatusBadge key={item}>{roleLabels[item]}</StatusBadge>
                  ))}
                </span>
                <span>
                  <StatusBadge tone={member.status === 'active' ? 'success' : 'neutral'}>
                    {member.status === 'active' ? '正常' : '已停用'}
                  </StatusBadge>
                  {member.mustChangePassword ? (
                    <small className="status-hint">待首次改密</small>
                  ) : null}
                </span>
                <span>{formatDate(member.joinedAt)}</span>
                <span className="member-actions">
                  {member.roles.includes('student') ? (
                    <Link className="button-link" href={`/teacher/students/${member.id}`}>
                      查看进度
                    </Link>
                  ) : null}
                  {member.roles.includes('student') ? (
                    <button
                      className="button-link"
                      disabled={workingMemberId === member.id}
                      onClick={() => void resetPassword(member)}
                      type="button"
                    >
                      重置密码
                    </button>
                  ) : null}
                  <button
                    className="button-link"
                    disabled={workingMemberId === member.id}
                    onClick={() =>
                      void setMemberStatus(
                        member,
                        member.status === 'active' ? 'suspended' : 'active',
                      )
                    }
                    type="button"
                  >
                    {member.status === 'active' ? '停用' : '恢复'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
