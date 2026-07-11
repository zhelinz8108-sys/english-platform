'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiProblemError, apiRequest, isDemoMode, tenantPath } from '@/lib/api';
import { useWorkspace } from '@/components/workspace-provider';

type QueryState = 'loading' | 'success' | 'error';

export function useTenantQuery<T, Raw = T>(
  suffix: string,
  demoFallback: T,
  adapt: (raw: Raw) => T = (raw) => raw as unknown as T,
) {
  const { currentTenant } = useWorkspace();
  const demoMode = isDemoMode();
  const [data, setData] = useState<T | null>(demoMode ? demoFallback : null);
  const [state, setState] = useState<QueryState>(demoMode ? 'success' : 'loading');
  const [error, setError] = useState<ApiProblemError | null>(null);
  const adaptRef = useRef(adapt);
  adaptRef.current = adapt;

  const load = useCallback(async () => {
    if (demoMode) {
      setData(demoFallback);
      setError(null);
      setState('success');
      return;
    }

    setState('loading');
    setError(null);
    try {
      const nextData = await apiRequest<Raw>(tenantPath(currentTenant.id, suffix));
      setData(adaptRef.current(nextData));
      setState('success');
    } catch (caught) {
      const nextError =
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '数据加载失败',
              status: 500,
              detail: caught instanceof Error ? caught.message : '未知错误',
            });
      setError(nextError);
      setState('error');
    }
  }, [currentTenant.id, demoFallback, demoMode, suffix]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    error,
    isLoading: state === 'loading',
    isError: state === 'error',
    reload: load,
  };
}
