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
import { adaptStudentPage } from '@/lib/adapters';
import type { ApiPage, ApiTeacherStudent } from '@/lib/api-models';
import { demoStudents } from '@/lib/demo-data';
import { formatDateTime } from '@/lib/format';
import type { PageEnvelope, StudentSummary } from '@/lib/types';

const demoStudentPage: PageEnvelope<StudentSummary> = {
  data: demoStudents,
  page: { nextCursor: null, limit: 50 },
};

export default function TeacherStudentsPage() {
  const [query, setQuery] = useState('');
  const [riskOnly, setRiskOnly] = useState(false);
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    PageEnvelope<StudentSummary>,
    ApiPage<ApiTeacherStudent>
  >('/teacher/students?pageSize=50', demoStudentPage, adaptStudentPage);
  const students = useMemo(
    () =>
      (data?.data ?? []).filter((student) => {
        const term = query.trim().toLocaleLowerCase('zh-CN');
        const matches =
          term.length === 0 ||
          student.displayName.toLocaleLowerCase('zh-CN').includes(term) ||
          (student.studentNumber ?? '').toLocaleLowerCase('zh-CN').includes(term);
        return matches && (!riskOnly || student.overdueTaskCount > 0);
      }),
    [data?.data, query, riskOnly],
  );

  if (isLoading) return <LoadingState label="正在加载学生列表" />;
  if (isError && error) return <ErrorState error={error} onRetry={() => void reload()} />;
  if (!data) return <LoadingState label="正在加载学生列表" />;

  return (
    <>
      <PageHeader
        description="只显示通过班级或直接师生关系与你关联的学生。"
        eyebrow="教师工作台"
        title="学生"
      />
      <Card padding={false}>
        <div className="list-toolbar">
          <label className="search-box">
            <span className="sr-only">搜索学生</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="姓名或学号"
              type="search"
              value={query}
            />
          </label>
          <label className="toggle-filter">
            <input
              checked={riskOnly}
              onChange={(event) => setRiskOnly(event.target.checked)}
              type="checkbox"
            />
            <span>只看需关注学生</span>
          </label>
        </div>
        {students.length === 0 ? (
          <EmptyState description="调整搜索或筛选条件后再试。" title="没有符合条件的学生" />
        ) : (
          <div className="student-table">
            <div className="student-table-head">
              <span>学生</span>
              <span>班级</span>
              <span>进度</span>
              <span>最近活跃</span>
              <span />
            </div>
            {students.map((student) => (
              <Link
                className="student-table-row"
                href={'/teacher/students/' + student.membershipId}
                key={student.membershipId}
              >
                <span className="student-cell">
                  <span className="avatar">{student.displayName.slice(-2)}</span>
                  <span>
                    <strong>{student.displayName}</strong>
                    <small>{student.studentNumber}</small>
                  </span>
                </span>
                <span>
                  {student.classNames?.join('、') || `${student.classIds?.length ?? 0} 个班级`}
                </span>
                <span>
                  <strong>
                    {student.completionRate === undefined ? '—' : student.completionRate + '%'}
                  </strong>
                  <small>均分 {student.averageScore ?? '—'}</small>
                </span>
                <span>
                  {student.lastActiveAt ? formatDateTime(student.lastActiveAt) : '暂无记录'}
                </span>
                <span>
                  {student.overdueTaskCount > 0 ? (
                    <StatusBadge tone="warning">{student.overdueTaskCount} 项逾期</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">正常</StatusBadge>
                  )}
                  <Icon name="chevron" size={17} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
