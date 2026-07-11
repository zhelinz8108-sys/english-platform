import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, StatusBadge } from './ui';

describe('shared UI states', () => {
  it('renders a semantic status badge', () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="success">已完成</StatusBadge>);
    expect(markup).toContain('badge-success');
    expect(markup).toContain('已完成');
  });

  it('renders an accessible empty state message', () => {
    const markup = renderToStaticMarkup(
      <EmptyState description="新的任务会显示在这里。" title="暂无任务" />,
    );
    expect(markup).toContain('暂无任务');
    expect(markup).toContain('新的任务会显示在这里。');
    expect(markup).toContain('empty-state');
  });
});
