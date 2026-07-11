import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ApiProblemError } from '@/lib/api';
import { Icon, type IconName } from './icon';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className,
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  const classes = ['card', padding ? 'card-padded' : '', className ?? ''].filter(Boolean).join(' ');
  return <section className={classes}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: IconName;
  tone?: Tone;
}) {
  return (
    <Card className={'stat-card tone-' + tone}>
      <div className="stat-icon">
        <Icon name={icon} size={21} />
      </div>
      <div>
        <p className="stat-label">{label}</p>
        <strong>{value}</strong>
        <p className="stat-hint">{hint}</p>
      </div>
    </Card>
  );
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={'badge badge-' + tone}>{children}</span>;
}

export function ProgressBar({
  value,
  label,
  tone = 'brand',
}: {
  value: number;
  label: string;
  tone?: Tone;
}) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-wrap">
      <div className="progress-meta">
        <span>{label}</span>
        <strong>{Math.round(safeValue)}%</strong>
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={safeValue}
        className="progress-track"
        role="progressbar"
      >
        <span className={'progress-fill tone-' + tone} style={{ width: safeValue + '%' }} />
      </div>
    </div>
  );
}

export function EmptyState({
  icon = 'spark',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel empty-state">
      <span className="state-icon">
        <Icon name={icon} size={24} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = '正在加载内容' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="state-panel loading-state" role="status">
      <span className="spinner" />
      <p>{label}…</p>
      <div className="skeleton-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiProblemError; onRetry: () => void }) {
  return (
    <div className="state-panel error-state" role="alert">
      <span className="state-icon">
        <Icon name="alert" size={24} />
      </span>
      <h2>{error.problem.title}</h2>
      <p>{error.problem.detail ?? '请求未完成，请稍后重试。'}</p>
      {error.problem.requestId ? <small>请求编号：{error.problem.requestId}</small> : null}
      <button className="button button-secondary" onClick={onRetry} type="button">
        重新加载
      </button>
    </div>
  );
}

export function InlineNotice({
  title,
  children,
  tone = 'info',
}: {
  title: string;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={'inline-notice notice-' + tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={tone === 'danger' || tone === 'warning' ? 'alert' : 'spark'} size={19} />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  icon,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
}) {
  return (
    <Link className={'button button-' + variant} href={href}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </Link>
  );
}

export function SectionLabel({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="section-label">
      <Icon name={icon} size={17} />
      <span>{children}</span>
    </div>
  );
}
