'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiProblemError, authApi } from '@/lib/api';
import { Icon } from './icon';

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiProblemError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmation) {
      setError(
        new ApiProblemError({
          type: 'about:blank',
          title: '两次密码不一致',
          status: 400,
          detail: '请重新输入新密码。',
        }),
      );
      return;
    }
    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      router.replace('/');
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '密码修改失败',
              status: 500,
              detail: '请稍后重试。',
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={(event) => void submit(event)}>
      <div className="login-heading">
        <p className="eyebrow">账号安全</p>
        <h1>设置你的新密码</h1>
        <p>这是首次登录。修改临时密码后才能进入学习平台。</p>
      </div>
      {error ? (
        <div className="login-error" role="alert">
          <Icon name="alert" size={19} />
          <div>
            <strong>{error.problem.title}</strong>
            <p>{error.problem.detail}</p>
          </div>
        </div>
      ) : null}
      <label className="field">
        <span>临时密码</span>
        <input
          autoComplete="current-password"
          minLength={8}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </label>
      <label className="field">
        <span>新密码</span>
        <input
          autoComplete="new-password"
          minLength={12}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
        <small>至少 12 位，并包含大小写字母、数字和符号。</small>
      </label>
      <label className="field">
        <span>再次输入新密码</span>
        <input
          autoComplete="new-password"
          minLength={12}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
      </label>
      <button className="button button-primary login-submit" disabled={submitting} type="submit">
        {submitting ? <span className="spinner spinner-light" /> : null}
        {submitting ? '正在保存' : '保存并进入平台'}
      </button>
      <button
        className="button button-ghost"
        onClick={() => void authApi.logout().then(() => router.replace('/login'))}
        type="button"
      >
        退出，使用其他账号
      </button>
    </form>
  );
}
