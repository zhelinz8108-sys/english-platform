'use client';

import { useEffect } from 'react';
import { ApiProblemError } from '@/lib/api';
import { ErrorState } from '@/components/ui';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const problemDetails = {
    type: 'about:blank',
    title: '页面暂时不可用',
    status: 500,
    detail: '工作台加载时出现问题，请重试。若问题持续，请联系机构管理员。',
  };
  const problem = new ApiProblemError(
    error.digest ? { ...problemDetails, requestId: error.digest } : problemDetails,
  );

  return <ErrorState error={problem} onRetry={reset} />;
}
