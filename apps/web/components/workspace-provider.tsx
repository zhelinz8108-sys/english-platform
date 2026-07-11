'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { ApiProblemError, isDemoMode } from '@/lib/api';
import { demoTenants, demoUser } from '@/lib/demo-data';
import {
  chooseTenantId,
  loadWorkspaceSession,
  persistTenantSelection,
  tenantStorageKey,
} from '@/lib/session';
import type { AppTenant, AppUser } from '@/lib/types';
import { Icon } from './icon';

interface WorkspaceContextValue {
  currentTenant: AppTenant;
  tenants: AppTenant[];
  user: AppUser;
  switchTenant: (tenantId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const demoMode = isDemoMode();
  const [tenants, setTenants] = useState<AppTenant[]>(demoMode ? demoTenants : []);
  const [user, setUser] = useState<AppUser | null>(demoMode ? demoUser : null);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(
    demoMode ? demoTenants[0]!.id : null,
  );
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(demoMode ? 'ready' : 'loading');
  const [error, setError] = useState<ApiProblemError | null>(null);

  const load = useCallback(async () => {
    if (demoMode) {
      const selected = chooseTenantId(demoTenants, window.localStorage.getItem(tenantStorageKey));
      setCurrentTenantId(selected);
      persistTenantSelection(selected);
      setState('ready');
      return;
    }

    setState('loading');
    setError(null);
    try {
      const session = await loadWorkspaceSession();
      if (session.tenants.length === 0) {
        setUser(session.user);
        setTenants([]);
        setCurrentTenantId(null);
        persistTenantSelection(null);
        setError(
          new ApiProblemError({
            type: 'about:blank',
            title: '没有可用机构',
            status: 403,
            detail: '当前账号没有活跃的机构成员资格，请联系机构管理员。',
          }),
        );
        setState('error');
        return;
      }

      const selected = chooseTenantId(
        session.tenants,
        window.localStorage.getItem(tenantStorageKey),
      );
      setUser(session.user);
      setTenants(session.tenants);
      setCurrentTenantId(selected);
      persistTenantSelection(selected);
      setState('ready');
    } catch (caught) {
      const nextError =
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '无法加载工作区',
              status: 500,
              detail: caught instanceof Error ? caught.message : '请稍后重试。',
            });
      if (nextError.problem.status === 401) {
        persistTenantSelection(null);
        router.replace('/login?reason=session-expired');
        return;
      }
      setError(nextError);
      setState('error');
    }
  }, [demoMode, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTenant = useCallback(
    (tenantId: string) => {
      if (!tenants.some((tenant) => tenant.id === tenantId)) {
        return;
      }
      persistTenantSelection(tenantId);
      setCurrentTenantId(tenantId);
    },
    [tenants],
  );

  const currentTenant = tenants.find((tenant) => tenant.id === currentTenantId);

  const value = useMemo(
    () =>
      currentTenant && user
        ? {
            currentTenant,
            tenants,
            user,
            switchTenant,
          }
        : null,
    [currentTenant, switchTenant, tenants, user],
  );

  if (state === 'loading' || (!value && state !== 'error')) {
    return (
      <main className="workspace-bootstrap" id="main-content">
        <span className="spinner" />
        <h1>正在载入工作区</h1>
        <p>正在验证账号与机构成员资格…</p>
      </main>
    );
  }

  if (state === 'error' || !value) {
    return (
      <main className="workspace-bootstrap" id="main-content" role="alert">
        <span className="state-icon">
          <Icon name="alert" size={24} />
        </span>
        <h1>{error?.problem.title ?? '无法载入工作区'}</h1>
        <p>{error?.problem.detail ?? '请稍后重试。'}</p>
        <button className="button button-secondary" onClick={() => void load()} type="button">
          重新加载
        </button>
      </main>
    );
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return context;
}
