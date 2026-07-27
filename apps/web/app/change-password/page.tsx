import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/change-password-form';

export const metadata: Metadata = {
  title: '修改临时密码',
};

export default function ChangePasswordPage() {
  return (
    <main className="login-page" id="main-content">
      <section className="login-story" aria-label="账号安全说明">
        <div className="login-brand">
          <span className="brand-mark brand-mark-large">E</span>
          <div>
            <strong>English Compass</strong>
            <span>个性化英语学习平台</span>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow eyebrow-light">Secure account</p>
          <h2>先保护好账号，再开始学习。</h2>
          <p>临时密码只用于首次登录。新密码不会展示给管理员，也不会以明文保存。</p>
        </div>
      </section>
      <section className="login-panel">
        <ChangePasswordForm />
      </section>
    </main>
  );
}
