import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { WorkspaceProvider } from '@/components/workspace-provider';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
