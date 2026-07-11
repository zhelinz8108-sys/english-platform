'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TenantRole } from '@english/shared';
import { authApi, isDemoMode } from '@/lib/api';
import { getInitials, roleLabels } from '@/lib/format';
import { persistTenantSelection } from '@/lib/session';
import { Icon, type IconName } from './icon';
import { useWorkspace } from './workspace-provider';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

interface NavGroup {
  label: string;
  roles: TenantRole[];
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    label: '学生工作台',
    roles: ['student'],
    items: [
      { href: '/student', label: '学习总览', icon: 'home' },
      { href: '/student/tasks', label: '我的任务', icon: 'tasks' },
      { href: '/student/paths', label: '学习路径', icon: 'path' },
      { href: '/student/feedback', label: '成绩反馈', icon: 'feedback' },
      { href: '/student/progress', label: '学习进度', icon: 'chart' },
    ],
  },
  {
    label: '教师工作台',
    roles: ['teacher'],
    items: [
      { href: '/teacher', label: '教学总览', icon: 'home' },
      { href: '/teacher/classes', label: '班级', icon: 'classes' },
      { href: '/teacher/students', label: '学生', icon: 'students' },
      { href: '/teacher/assignments/new', label: '布置任务', icon: 'assign' },
      { href: '/teacher/grading', label: '待批改', icon: 'grade' },
    ],
  },
  {
    label: '学习板块',
    roles: ['owner', 'admin', 'teacher', 'student', 'content_editor', 'analyst'],
    items: [{ href: '/learning/toefl', label: '托福', icon: 'book' }],
  },
  {
    label: '机构管理',
    roles: ['owner', 'admin', 'content_editor'],
    items: [
      { href: '/admin', label: '机构总览', icon: 'building' },
      { href: '/admin/members', label: '成员与角色', icon: 'users' },
      { href: '/admin/content', label: '内容与版本', icon: 'library' },
    ],
  },
];

function isItemActive(pathname: string, href: string): boolean {
  if (href === '/student' || href === '/teacher' || href === '/admin') {
    return pathname === href;
  }
  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentTenant, switchTenant, tenants, user } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const visibleGroups = useMemo(
    () =>
      groups
        .filter((group) => group.roles.some((role) => currentTenant.roles.includes(role)))
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (item.href === '/admin' || item.href === '/admin/members') {
              return currentTenant.roles.some((role) => role === 'owner' || role === 'admin');
            }
            return true;
          }),
        }))
        .filter((group) => group.items.length > 0),
    [currentTenant.roles],
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    setLoggingOut(true);
    try {
      if (!isDemoMode()) {
        await authApi.logout();
      }
      persistTenantSelection(null);
      window.sessionStorage.removeItem('english-platform:demo-session');
      router.push('/login');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-frame">
      <button
        aria-label="关闭导航"
        className={'nav-backdrop ' + (menuOpen ? 'is-open' : '')}
        onClick={() => setMenuOpen(false)}
        type="button"
      />
      <aside className={'sidebar ' + (menuOpen ? 'is-open' : '')}>
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <div>
            <strong>English Compass</strong>
            <span>个性化学习平台</span>
          </div>
          <button
            aria-label="关闭导航"
            className="icon-button sidebar-close"
            onClick={() => setMenuOpen(false)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav aria-label="主导航" className="sidebar-nav">
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <Link
                  aria-current={isItemActive(pathname, item.href) ? 'page' : undefined}
                  className={isItemActive(pathname, item.href) ? 'nav-link is-active' : 'nav-link'}
                  href={item.href}
                  key={item.href}
                >
                  <Icon name={item.icon} size={19} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="avatar">{getInitials(user.displayName)}</span>
            <div>
              <strong>{user.displayName}</strong>
              <span>{roleLabels[currentTenant.roles[0]!]}</span>
            </div>
          </div>
          <button
            aria-label="退出登录"
            className="icon-button"
            disabled={loggingOut}
            onClick={() => void logout()}
            type="button"
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>

      <div className="app-content">
        <header className="topbar">
          <button
            aria-expanded={menuOpen}
            aria-label="打开导航"
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <div className="tenant-control">
            <Icon name="building" size={18} />
            <label className="sr-only" htmlFor="tenant-switcher">
              切换机构
            </label>
            <select
              id="tenant-switcher"
              onChange={(event) => switchTenant(event.target.value)}
              value={currentTenant.id}
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={15} />
          </div>
          <div className="topbar-actions">
            {isDemoMode() ? <span className="demo-pill">演示环境</span> : null}
            <button
              aria-label="通知（暂无未读）"
              className="icon-button notification-button"
              disabled
              title="暂无通知"
              type="button"
            >
              <Icon name="bell" size={19} />
            </button>
            <span className="avatar avatar-small">{getInitials(user.displayName)}</span>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
