'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { demoCatalog } from '@/lib/demo-data';
import { adaptCatalog } from '@/lib/adapters';
import {
  ApiProblemError,
  apiRequest,
  createIdempotencyKey,
  isDemoMode,
  tenantPath,
} from '@/lib/api';
import type { ApiCatalogEntity, ApiPage } from '@/lib/api-models';
import { formatDateTime } from '@/lib/format';
import type { CatalogItem } from '@/lib/types';
import { Icon } from './icon';
import { Card, EmptyState, InlineNotice, LoadingState, StatusBadge } from './ui';
import { useWorkspace } from './workspace-provider';

type CatalogFilter = 'all' | CatalogItem['type'];

const typeLabels: Record<CatalogItem['type'], string> = {
  content: '内容',
  question: '题目',
  task: '任务',
  path: '路径',
};

export function ContentManager() {
  const { currentTenant } = useWorkspace();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiProblemError | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      setItems(demoCatalog);
      setLoading(false);
      return;
    }
    try {
      const resources = await Promise.all([
        apiRequest<ApiPage<ApiCatalogEntity>>(
          tenantPath(currentTenant.id, '/admin/contents?pageSize=100'),
        ),
        apiRequest<ApiPage<ApiCatalogEntity>>(
          tenantPath(currentTenant.id, '/admin/questions?pageSize=100'),
        ),
        apiRequest<ApiPage<ApiCatalogEntity>>(
          tenantPath(currentTenant.id, '/admin/tasks?pageSize=100'),
        ),
        apiRequest<ApiPage<ApiCatalogEntity>>(
          tenantPath(currentTenant.id, '/admin/learning-paths?pageSize=100'),
        ),
      ]);
      setItems(
        resources.flatMap((page, index) =>
          page.data.map((item) =>
            adaptCatalog(item, (['content', 'question', 'task', 'path'] as const)[index]!),
          ),
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '目录加载失败',
              status: 500,
              detail: '请刷新后重试。',
            }),
      );
    } finally {
      setLoading(false);
    }
  }, [currentTenant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const term = query.trim().toLocaleLowerCase('zh-CN');
        return (
          (filter === 'all' || item.type === filter) &&
          (term.length === 0 ||
            item.title.toLocaleLowerCase('zh-CN').includes(term) ||
            item.slug.includes(term))
        );
      }),
    [filter, items, query],
  );

  async function cloneItem(item: CatalogItem) {
    setSubmitting(true);
    setError(null);
    try {
      if (isDemoMode()) {
        const clone: CatalogItem = {
          ...item,
          id: 'catalog-clone-' + Date.now(),
          ownership: 'tenant',
          publicationState: 'draft',
          versionNumber: 1,
          title: item.title + ' · 机构副本',
          slug: item.slug + '-copy',
          updatedAt: new Date().toISOString(),
        };
        setItems((current) => [clone, ...current]);
      } else {
        if (item.type !== 'content' || !item.sourceVersionId)
          throw new ApiProblemError({
            type: 'about:blank',
            title: '暂不支持复制',
            status: 422,
            detail: '当前后端只支持从平台内容版本复制内容实体。',
          });
        await apiRequest(tenantPath(currentTenant.id, '/admin/contents'), {
          method: 'POST',
          idempotencyKey: createIdempotencyKey('clone-content'),
          json: {
            cloneFromPlatformVersionId: item.sourceVersionId,
            slug: item.slug + '-copy-' + Date.now(),
          },
        });
        await load();
      }
      setNotice('已复制为机构草稿。官方版本保持只读。');
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({ type: 'about:blank', title: '复制失败', status: 500 }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function createDraft() {
    const type = filter === 'all' ? 'content' : filter;
    const slug = 'untitled-' + Date.now();
    setSubmitting(true);
    setError(null);
    try {
      if (isDemoMode()) {
        const draft: CatalogItem = {
          id: 'catalog-new-' + Date.now(),
          type,
          title: '未命名机构内容',
          slug,
          ownership: 'tenant',
          publicationState: 'draft',
          versionNumber: 1,
          updatedAt: new Date().toISOString(),
          kind:
            type === 'path'
              ? 'general'
              : type === 'question'
                ? 'single_choice'
                : type === 'content'
                  ? 'passage'
                  : 'task',
        };
        setItems((current) => [draft, ...current]);
      } else {
        const suffix =
          type === 'content'
            ? '/admin/contents'
            : type === 'question'
              ? '/admin/questions'
              : type === 'task'
                ? '/admin/tasks'
                : '/admin/learning-paths';
        const json =
          type === 'content'
            ? { kind: 'passage', slug }
            : type === 'question'
              ? { kind: 'single_choice', slug }
              : type === 'path'
                ? { track: 'general', slug }
                : { slug };
        await apiRequest(tenantPath(currentTenant.id, suffix), {
          method: 'POST',
          idempotencyKey: createIdempotencyKey('create-' + type),
          json,
        });
        await load();
      }
      setNotice('已创建草稿。发布前可继续编辑；发布后需要创建新版本。');
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({ type: 'about:blank', title: '创建失败', status: 500 }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="正在加载内容目录" />;

  return (
    <>
      {notice ? (
        <InlineNotice title="操作完成" tone="success">
          {notice}
        </InlineNotice>
      ) : null}
      {error ? (
        <InlineNotice title={error.problem.title} tone="danger">
          {error.problem.detail}
        </InlineNotice>
      ) : null}
      <Card padding={false}>
        <div className="catalog-toolbar">
          <div className="segmented-control">
            {[
              ['all', '全部'],
              ['content', '内容'],
              ['question', '题目'],
              ['task', '任务'],
              ['path', '路径'],
            ].map(([value, label]) => (
              <button
                aria-pressed={filter === value}
                className={filter === value ? 'is-active' : ''}
                key={value}
                onClick={() => setFilter(value as CatalogFilter)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="catalog-actions">
            <label className="search-box">
              <span className="sr-only">搜索目录</span>
              <Icon name="search" size={17} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="标题或 slug"
                type="search"
                value={query}
              />
            </label>
            <button
              className="button button-primary"
              disabled={submitting}
              onClick={() => void createDraft()}
              type="button"
            >
              <Icon name="plus" size={17} />
              新建草稿
            </button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            description="调整筛选条件或创建新草稿。"
            icon="library"
            title="没有目录内容"
          />
        ) : (
          <div className="catalog-table">
            <div className="catalog-table-head">
              <span>标题</span>
              <span>类型</span>
              <span>归属</span>
              <span>版本</span>
              <span>更新时间</span>
              <span />
            </div>
            {filtered.map((item) => (
              <div className="catalog-table-row" key={item.id}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.slug}</small>
                </span>
                <span>
                  <StatusBadge>
                    {typeLabels[item.type]} · {item.kind}
                  </StatusBadge>
                </span>
                <span>
                  <StatusBadge tone={item.ownership === 'platform' ? 'info' : 'brand'}>
                    {item.ownership === 'platform' ? '平台只读' : '机构自有'}
                  </StatusBadge>
                </span>
                <span>
                  <strong>
                    {item.versionNumber === undefined ? '—' : 'v' + item.versionNumber}
                  </strong>
                  <small>{item.publicationState === 'published' ? '已发布' : '草稿'}</small>
                </span>
                <span>{formatDateTime(item.updatedAt)}</span>
                <span>
                  {item.ownership === 'platform' ? (
                    item.type === 'content' && (isDemoMode() || item.sourceVersionId) ? (
                      <button
                        className="button button-secondary"
                        disabled={submitting}
                        onClick={() => void cloneItem(item)}
                        type="button"
                      >
                        复制并编辑
                      </button>
                    ) : (
                      <small>需完整依赖图导入</small>
                    )
                  ) : (
                    <small>机构内容</small>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
