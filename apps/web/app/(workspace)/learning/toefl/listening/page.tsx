'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { useWorkspace } from '@/components/workspace-provider';
import { ApiProblemError, apiRequest, tenantPath } from '@/lib/api';

interface ListeningTrack {
  id: string;
  collection: string;
  sequence: number;
  title: string;
  durationSeconds: number | null;
  sizeBytes: number;
}

interface ListeningResponse {
  data: ListeningTrack[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ToeflListeningPage() {
  const { currentTenant } = useWorkspace();
  const [tracks, setTracks] = useState<ListeningTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiProblemError | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [selected, setSelected] = useState<ListeningTrack | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<ListeningResponse>(
        tenantPath(currentTenant.id, '/learning/toefl/listening?pageSize=300'),
      );
      setTracks(response.data);
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '听力音频加载失败',
              status: 500,
              detail: '请稍后重试。',
            }),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [currentTenant.id]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en');
    if (!normalized) return tracks;
    return tracks.filter(
      (track) =>
        track.title.toLocaleLowerCase('en').includes(normalized) ||
        String(track.sequence).includes(normalized),
    );
  }, [query, tracks]);

  async function play(track: ListeningTrack) {
    setLoadingAudioId(track.id);
    setError(null);
    try {
      const response = await apiRequest<{ url: string; expiresAt: string }>(
        tenantPath(currentTenant.id, `/learning/toefl/listening/${track.id}/playback`),
      );
      setSelected(track);
      setPlaybackUrl(response.url);
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '无法播放音频',
              status: 500,
              detail: '播放地址生成失败，请重试。',
            }),
      );
    } finally {
      setLoadingAudioId(null);
    }
  }

  if (loading) return <LoadingState label="正在加载 Minute Earth 听力音频" />;
  if (error && tracks.length === 0) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/learning/toefl" variant="secondary">
            返回托福
          </ButtonLink>
        }
        description={`Minute Earth 听力素材库，共 ${tracks.length} 条音频。`}
        eyebrow="托福 · 听力"
        title="听力训练"
      />

      {error ? <ErrorState error={error} onRetry={() => void load()} /> : null}

      <Card className="listening-player-card">
        <span className="listening-player-icon">
          <Icon name="headphones" size={25} />
        </span>
        <div>
          <p className="eyebrow">当前播放</p>
          <h2>{selected ? `${selected.sequence}. ${selected.title}` : '选择一条音频开始训练'}</h2>
          <p>{selected ? 'Minute Earth · 托福听力素材' : '音频采用私有对象存储和临时播放地址。'}</p>
        </div>
        {playbackUrl ? (
          <audio autoPlay controls key={playbackUrl} preload="metadata" src={playbackUrl}>
            当前浏览器不支持音频播放。
          </audio>
        ) : null}
      </Card>

      <Card padding={false}>
        <div className="list-toolbar">
          <div>
            <strong>Minute Earth</strong>
            <small className="listening-count">{filtered.length} 条音频</small>
          </div>
          <label className="search-box">
            <span className="sr-only">搜索听力音频</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(50);
              }}
              placeholder="按标题或序号搜索"
              type="search"
              value={query}
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <EmptyState description="换一个关键词再试试。" icon="headphones" title="没有匹配的音频" />
        ) : (
          <div className="listening-track-list">
            {filtered.slice(0, visibleCount).map((track) => (
              <div
                className={
                  selected?.id === track.id ? 'listening-track is-active' : 'listening-track'
                }
                key={track.id}
              >
                <span className="listening-sequence">
                  {String(track.sequence).padStart(3, '0')}
                </span>
                <div>
                  <strong>{track.title}</strong>
                  <small>Minute Earth · {formatSize(track.sizeBytes)}</small>
                </div>
                <button
                  className="button button-secondary"
                  disabled={loadingAudioId !== null}
                  onClick={() => void play(track)}
                  type="button"
                >
                  <Icon name={selected?.id === track.id ? 'headphones' : 'arrow'} size={15} />
                  {loadingAudioId === track.id
                    ? '载入中'
                    : selected?.id === track.id
                      ? '正在播放'
                      : '播放'}
                </button>
              </div>
            ))}
          </div>
        )}

        {visibleCount < filtered.length ? (
          <div className="listening-load-more">
            <button
              className="button button-secondary"
              onClick={() => setVisibleCount((count) => count + 50)}
              type="button"
            >
              加载更多
            </button>
          </div>
        ) : null}
      </Card>
    </>
  );
}
