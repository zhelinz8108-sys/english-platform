'use client';

import type { ReactNode } from 'react';
import { StudentShell } from './student-dashboard/student-dashboard';

export function AppShell({ children }: { children: ReactNode }) {
  return <StudentShell>{children}</StudentShell>;
}
