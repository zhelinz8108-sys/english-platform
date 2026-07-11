'use client';

import { useEffect, useState } from 'react';
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
import { adaptFeedbackPage } from '@/lib/adapters';
import type { ApiFeedbackItem, ApiPage } from '@/lib/api-models';
import { demoFeedback } from '@/lib/demo-data';
import { formatDateTime } from '@/lib/format';
import type { FeedbackItem, PageEnvelope } from '@/lib/types';

const fallback: PageEnvelope<FeedbackItem> = {
  data: demoFeedback,
  page: { nextCursor: null, limit: 20 },
};

export default function StudentFeedbackPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, error, isError, isLoading, reload } = useTenantQuery<
    PageEnvelope<FeedbackItem>,
    ApiPage<ApiFeedbackItem>
  >('/student/feedback?pageSize=20', fallback, adaptFeedbackPage);

  useEffect(() => {
    if (!isLoading && !isError && !expandedId && data?.data[0]) setExpandedId(data.data[0].id);
  }, [data, expandedId, isError, isLoading]);

  if (isLoading) {
    return <LoadingState label="正在加载成绩与反馈" />;
  }
  if (isError && error) {
    return <ErrorState error={error} onRetry={() => void reload()} />;
  }
  if (!data) return <LoadingState label="正在加载成绩与反馈" />;

  return (
    <>
      <PageHeader
        description="最终成绩优先采用管理员修正，其次是教师确认，再次是自动评分。"
        eyebrow="学生工作台"
        title="成绩反馈"
      />
      {data.data.length === 0 ? (
        <EmptyState
          description="完成任务并返回成绩后，反馈会出现在这里。"
          icon="feedback"
          title="暂时没有反馈"
        />
      ) : (
        <div className="feedback-list">
          {data.data.map((feedback) => {
            const expanded = feedback.id === expandedId;
            const percent =
              feedback.maxScore > 0 ? Math.round((feedback.score / feedback.maxScore) * 100) : 0;
            return (
              <Card className={feedback.readAt ? '' : 'unread-card'} key={feedback.id}>
                <button
                  aria-expanded={expanded}
                  className="feedback-card-button"
                  onClick={() => setExpandedId(expanded ? null : feedback.id)}
                  type="button"
                >
                  <div className="score-ring" style={{ '--score': percent } as React.CSSProperties}>
                    <strong>{feedback.score}</strong>
                    <span>/ {feedback.maxScore}</span>
                  </div>
                  <div className="feedback-card-title">
                    <div>
                      {!feedback.readAt ? <span className="unread-dot">新</span> : null}
                      <h2>{feedback.taskTitle}</h2>
                    </div>
                    <p>
                      {formatDateTime(feedback.returnedAt)} ·{' '}
                      {feedback.source === 'auto_scored' ? '自动评分' : '教师确认'}
                    </p>
                  </div>
                  <StatusBadge
                    tone={percent >= 85 ? 'success' : percent >= 70 ? 'info' : 'warning'}
                  >
                    {percent}%
                  </StatusBadge>
                  <Icon className={expanded ? 'rotate-180' : ''} name="chevron" size={18} />
                </button>
                {expanded ? (
                  <div className="feedback-details">
                    <div className="teacher-feedback">
                      <span className="feedback-quote">“</span>
                      <p>{feedback.feedback}</p>
                    </div>
                    {feedback.rubric.length > 0 ? (
                      <div className="rubric-grid">
                        {feedback.rubric.map((rubric) => (
                          <div key={rubric.label}>
                            <span>{rubric.label}</span>
                            <strong>
                              {rubric.score} / {rubric.maxScore}
                            </strong>
                            <div className="progress-track">
                              <span
                                className="progress-fill"
                                style={{
                                  width:
                                    (rubric.maxScore > 0 ? rubric.score / rubric.maxScore : 0) *
                                      100 +
                                    '%',
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">本次反馈没有分项量规。</p>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
