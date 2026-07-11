import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';
import { Icon } from '@/components/icon';

export const metadata: Metadata = {
  title: '登录',
};

export default function LoginPage() {
  return (
    <main className="login-page" id="main-content">
      <section className="login-story" aria-label="平台介绍">
        <div className="login-brand">
          <span className="brand-mark brand-mark-large">E</span>
          <div>
            <strong>English Compass</strong>
            <span>个性化英语学习平台</span>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow eyebrow-light">General + TOEFL</p>
          <h2>把每一次练习，连接成清晰的成长路径。</h2>
          <p>
            一个账号连接学生、教师与机构。任务来源可解释，学习进度看得见，反馈可以真正进入下一次练习。
          </p>
        </div>
        <div className="story-features">
          <div>
            <Icon name="target" size={21} />
            <span>个性化路径</span>
          </div>
          <div>
            <Icon name="tasks" size={21} />
            <span>可审计任务</span>
          </div>
          <div>
            <Icon name="feedback" size={21} />
            <span>连续反馈</span>
          </div>
        </div>
        <div className="story-orbit orbit-one" />
        <div className="story-orbit orbit-two" />
      </section>
      <section className="login-panel">
        <LoginForm />
        <p className="login-footer">登录即表示你已阅读并同意隐私说明与使用条款。</p>
      </section>
    </main>
  );
}
