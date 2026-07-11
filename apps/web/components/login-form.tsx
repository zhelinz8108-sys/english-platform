'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiProblemError, authApi, isDemoMode } from '@/lib/api';
import {
  chooseTenantId,
  landingRouteForRoles,
  loadWorkspaceSession,
  persistTenantSelection,
  tenantStorageKey,
} from '@/lib/session';
import { Icon } from './icon';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(() => (isDemoMode() ? 'student@example.test' : ''));
  const [password, setPassword] = useState(() => (isDemoMode() ? 'Demo123!' : ''));
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiProblemError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isDemoMode()) {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        window.sessionStorage.setItem('english-platform:demo-session', 'active');
        router.push('/student');
      } else {
        await authApi.login(email, password);
        const session = await loadWorkspaceSession();
        const selectedTenantId = chooseTenantId(
          session.tenants,
          window.localStorage.getItem(tenantStorageKey),
        );
        const selectedTenant = session.tenants.find((tenant) => tenant.id === selectedTenantId);
        if (!selectedTenant) {
          throw new ApiProblemError({
            type: 'about:blank',
            title: '没有可用机构',
            status: 403,
            detail: '账号登录成功，但没有活跃的机构成员资格。',
          });
        }
        persistTenantSelection(selectedTenant.id);
        router.push(landingRouteForRoles(selectedTenant.roles));
      }
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '登录失败',
              status: 500,
              detail: caught instanceof Error ? caught.message : '请稍后重试。',
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={(event) => void submit(event)}>
      <div className="login-heading">
        <p className="eyebrow">欢迎回来</p>
        <h1>登录学习平台</h1>
        <p>使用机构账号继续你的学习或教学工作。</p>
      </div>

      {error ? (
        <div className="login-error" role="alert">
          <Icon name="alert" size={19} />
          <div>
            <strong>{error.problem.title}</strong>
            <p>{error.problem.detail}</p>
            {error.problem.requestId ? <small>请求编号：{error.problem.requestId}</small> : null}
          </div>
        </div>
      ) : null}

      <label className="field">
        <span>邮箱</span>
        <input
          autoComplete="email"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="field">
        <span>密码</span>
        <span className="password-field">
          <input
            autoComplete="current-password"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type={showPassword ? 'text' : 'password'}
            value={password}
          />
          <button
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? '隐藏' : '显示'}
          </button>
        </span>
      </label>

      <div className="login-options">
        <span>登录状态由安全会话策略自动管理</span>
        <span>忘记密码请联系机构管理员</span>
      </div>

      <button className="button button-primary login-submit" disabled={submitting} type="submit">
        {submitting ? <span className="spinner spinner-light" /> : null}
        {submitting ? '正在登录' : '登录'}
      </button>

      {isDemoMode() ? (
        <div className="demo-login-note">
          <Icon name="spark" size={17} />
          <span>当前为显式演示模式，表单不会请求真实后端。</span>
        </div>
      ) : null}
    </form>
  );
}
