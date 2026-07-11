'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiProblemError, isDemoMode } from '@/lib/api';
import {
  chooseTenantId,
  landingRouteForRoles,
  loadWorkspaceSession,
  persistTenantSelection,
  tenantStorageKey,
} from '@/lib/session';

export default function HomePage() {
  const router = useRouter();
  const [message, setMessage] = useState('正在打开工作区…');

  useEffect(() => {
    let active = true;

    async function openWorkspace() {
      if (isDemoMode()) {
        router.replace('/student');
        return;
      }

      try {
        const session = await loadWorkspaceSession();
        const tenantId = chooseTenantId(
          session.tenants,
          window.localStorage.getItem(tenantStorageKey),
        );
        const tenant = session.tenants.find((item) => item.id === tenantId);
        if (!tenant) {
          if (active) setMessage('当前账号没有可用的机构成员资格。');
          return;
        }
        persistTenantSelection(tenant.id);
        router.replace(landingRouteForRoles(tenant.roles));
      } catch (error) {
        if (error instanceof ApiProblemError && error.problem.status === 401) {
          router.replace('/login');
          return;
        }
        if (active) setMessage('暂时无法打开工作区，请刷新后重试。');
      }
    }

    void openWorkspace();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="workspace-bootstrap" id="main-content">
      <span className="spinner" />
      <h1>{message}</h1>
    </main>
  );
}
