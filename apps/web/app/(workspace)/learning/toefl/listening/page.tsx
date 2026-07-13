'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
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
import { ApiProblemError, apiRequest, isDemoMode, tenantPath } from '@/lib/api';

type ListeningCollectionId = 'minute-earth' | 'bbc-6-minute-english';

interface ListeningCollection {
  id: ListeningCollectionId;
  label: string;
  description: string;
  count: number;
}

interface ListeningTrack {
  id: string;
  collection: string;
  sequence: number;
  title: string;
  durationSeconds: number | null;
  sizeBytes: number;
  hasStudyContent: boolean;
  hasAudio?: boolean;
  hasDocument?: boolean;
  publishedAt?: string | null;
  transcriptWordCount: number | null;
  vocabularyCount: number;
}

interface VocabularyEntry {
  word: string;
  ipa: string;
  definition: string;
}

interface StudyContent {
  id: string;
  sequence: number;
  title: string;
  durationSeconds: number | null;
  transcriptWordCount: number;
  transcript: string;
  vocabulary: VocabularyEntry[];
  playbackUrl?: string | null;
  documentUrl?: string | null;
}

interface ListeningResponse {
  data: ListeningTrack[];
  collections?: ListeningCollection[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

const fallbackCollections: ListeningCollection[] = [
  {
    id: 'minute-earth',
    label: 'Minute Earth',
    description: '科学与地球主题短篇，含音频、英文原文和 TOEFL/SAT 词汇。',
    count: 270,
  },
  {
    id: 'bbc-6-minute-english',
    label: 'BBC 6 Minute English',
    description: 'BBC 六分钟英语，含音频和原版对话稿。',
    count: 0,
  },
];

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '时长待补充';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatPublishedDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{8}$/u.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function preferredAmericanVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const americanVoices = voices.filter((voice) => voice.lang.toLowerCase() === 'en-us');
  return (
    americanVoices.find((voice) =>
      /natural|aria|jenny|guy|samantha|google us english|zira|david/iu.test(voice.name),
    ) ??
    americanVoices[0] ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ??
    null
  );
}

export default function ToeflListeningPage() {
  const pathname = usePathname();
  const { currentTenant } = useWorkspace();
  const toeflHome = pathname.startsWith('/student/')
    ? '/student/learning/toefl'
    : '/learning/toefl';
  const [tracks, setTracks] = useState<ListeningTrack[]>([]);
  const [collections, setCollections] = useState<ListeningCollection[]>(fallbackCollections);
  const [collectionId, setCollectionId] = useState<ListeningCollectionId>('minute-earth');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiProblemError | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [studyById, setStudyById] = useState<Record<string, StudyContent>>({});
  const [playbackById, setPlaybackById] = useState<Record<string, string>>({});
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);
  const [speechAvailable, setSpeechAvailable] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode()) {
        const response = await apiRequest<ListeningResponse>(
          `/api/local-listening?collection=${encodeURIComponent(collectionId)}&pageSize=2000`,
        );
        setTracks(response.data);
        if (response.collections) setCollections(response.collections);
        setExpandedId(null);
        setStudyById({});
        setPlaybackById({});
        return;
      }

      const response = await apiRequest<ListeningResponse>(
        tenantPath(currentTenant.id, '/learning/toefl/listening?pageSize=300'),
      );
      setTracks(response.data.filter((track) => track.collection === collectionId));
      setExpandedId(null);
      setStudyById({});
      setPlaybackById({});
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '听力资料加载失败',
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
  }, [collectionId, currentTenant.id]);

  useEffect(() => {
    const available =
      typeof window !== 'undefined' &&
      typeof window.speechSynthesis !== 'undefined' &&
      typeof window.speechSynthesis.speak === 'function' &&
      typeof window.SpeechSynthesisUtterance !== 'undefined';
    setSpeechAvailable(available);
    return () => {
      if (available) window.speechSynthesis.cancel();
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en');
    if (!normalized) return tracks;
    return tracks.filter(
      (track) =>
        track.title.toLocaleLowerCase('en').includes(normalized) ||
        String(track.sequence).includes(normalized) ||
        (track.publishedAt?.includes(normalized) ?? false),
    );
  }, [query, tracks]);
  const selectedCollection =
    collections.find((collection) => collection.id === collectionId) ?? fallbackCollections[0]!;

  async function toggleStudy(track: ListeningTrack) {
    if (expandedId === track.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(track.id);
    if (studyById[track.id]) return;

    setLoadingDetailId(track.id);
    setError(null);
    try {
      if (isDemoMode()) {
        const study = await apiRequest<StudyContent>(
          `/api/local-listening/${encodeURIComponent(track.id)}`,
        );
        setStudyById((current) => ({ ...current, [track.id]: study }));
        if (study.playbackUrl) {
          setPlaybackById((current) => ({ ...current, [track.id]: study.playbackUrl! }));
        }
        return;
      }

      const [study, playback] = await Promise.all([
        apiRequest<StudyContent>(
          tenantPath(currentTenant.id, `/learning/toefl/listening/${track.id}/study-content`),
        ),
        apiRequest<{ url: string; expiresAt: string }>(
          tenantPath(currentTenant.id, `/learning/toefl/listening/${track.id}/playback`),
        ),
      ]);
      setStudyById((current) => ({ ...current, [track.id]: study }));
      setPlaybackById((current) => ({ ...current, [track.id]: playback.url }));
    } catch (caught) {
      setExpandedId(null);
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '学习资料加载失败',
              status: 500,
              detail: '原文、词汇或音频地址加载失败，请重试。',
            }),
      );
    } finally {
      setLoadingDetailId(null);
    }
  }

  function speakWord(word: string) {
    if (
      !speechAvailable ||
      typeof window.speechSynthesis === 'undefined' ||
      typeof window.SpeechSynthesisUtterance === 'undefined'
    )
      return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.82;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.voice = preferredAmericanVoice(window.speechSynthesis.getVoices());
    utterance.onstart = () => setSpeakingWord(word);
    utterance.onend = () => setSpeakingWord(null);
    utterance.onerror = () => setSpeakingWord(null);
    setSpeakingWord(word);
    window.speechSynthesis.speak(utterance);
  }

  if (loading) return <LoadingState label="正在加载听力资料库" />;
  if (error && tracks.length === 0) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href={toeflHome} variant="secondary">
            返回托福
          </ButtonLink>
        }
        description="选择 Minute Earth 或 BBC 6 Minute English，学习音频、原文与重点词汇。"
        eyebrow="英语 · 听力"
        title="听力资料库"
      />

      {error ? <ErrorState error={error} onRetry={() => void load()} /> : null}

      <div aria-label="听力资料系列" className="listening-collection-tabs" role="tablist">
        {collections.map((collection) => (
          <button
            aria-selected={collection.id === collectionId}
            className={
              collection.id === collectionId
                ? 'listening-collection-tab is-active'
                : 'listening-collection-tab'
            }
            key={collection.id}
            onClick={() => {
              setCollectionId(collection.id);
              setQuery('');
              setVisibleCount(50);
              setExpandedId(null);
            }}
            role="tab"
            type="button"
          >
            <span>{collection.label}</span>
            <small>{collection.count} 组</small>
          </button>
        ))}
      </div>

      <Card padding={false}>
        <div className="list-toolbar">
          <div>
            <strong>{selectedCollection.label}</strong>
            <small className="listening-count">{filtered.length} 组学习资料</small>
            <p className="listening-collection-description">{selectedCollection.description}</p>
          </div>
          <label className="search-box">
            <span className="sr-only">搜索听力资料</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(50);
                setExpandedId(null);
              }}
              placeholder="按标题、编号或日期搜索"
              type="search"
              value={query}
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            description="换一个关键词或编号再试试。"
            icon="headphones"
            title="没有匹配的听力资料"
          />
        ) : (
          <div className="listening-track-list">
            {filtered.slice(0, visibleCount).map((track) => {
              const expanded = expandedId === track.id;
              const study = studyById[track.id];
              const playbackUrl = playbackById[track.id];
              return (
                <article
                  className={expanded ? 'listening-track is-active' : 'listening-track'}
                  key={track.id}
                >
                  <div className="listening-track-summary">
                    <span className="listening-sequence">
                      {String(track.sequence).padStart(3, '0')}
                    </span>
                    <div className="listening-track-title">
                      <strong>{track.title}</strong>
                      <small>
                        {formatPublishedDate(track.publishedAt)
                          ? `${formatPublishedDate(track.publishedAt)} · `
                          : null}
                        {formatDuration(track.durationSeconds)} · {formatSize(track.sizeBytes)} ·{' '}
                        {track.transcriptWordCount ?? 0} 词原文
                        {track.vocabularyCount ? ` · ${track.vocabularyCount} 个重点词` : ''}
                      </small>
                    </div>
                    <button
                      aria-expanded={expanded}
                      className="button button-secondary"
                      disabled={
                        (!track.hasStudyContent && !track.hasDocument && !track.hasAudio) ||
                        loadingDetailId !== null
                      }
                      onClick={() => void toggleStudy(track)}
                      type="button"
                    >
                      <Icon name={expanded ? 'chevron' : 'book'} size={15} />
                      {loadingDetailId === track.id
                        ? '载入中'
                        : expanded
                          ? '收起资料'
                          : track.hasStudyContent || track.hasDocument || track.hasAudio
                            ? '展开学习'
                            : '资料准备中'}
                    </button>
                  </div>

                  {expanded ? (
                    <div className="listening-study-panel">
                      {study ? (
                        <>
                          <section
                            className="listening-audio-section"
                            aria-labelledby={`audio-${track.id}`}
                          >
                            <div>
                              <p className="eyebrow">听力音频</p>
                              <h2 id={`audio-${track.id}`}>
                                {String(track.sequence).padStart(3, '0')}. {track.title}
                              </h2>
                            </div>
                            {playbackUrl ? (
                              <audio controls preload="metadata" src={playbackUrl}>
                                当前浏览器不支持音频播放。
                              </audio>
                            ) : (
                              <p className="listening-empty-note">
                                当前音频文件不可用；请检查本地资源目录或对象存储配置。
                              </p>
                            )}
                            {study.documentUrl ? (
                              <a
                                className="button button-secondary listening-document-link"
                                href={study.documentUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <Icon name="book" size={15} /> 查看原版资料
                              </a>
                            ) : null}
                          </section>

                          {study.vocabulary.length ? (
                            <section className="listening-study-section">
                              <div className="listening-section-heading">
                                <div>
                                  <p className="eyebrow">TOEFL / SAT Vocabulary</p>
                                  <h3>重点词汇</h3>
                                </div>
                                <span>{study.vocabulary.length} 词</span>
                              </div>
                              <div className="listening-vocabulary-grid">
                                {study.vocabulary.map((entry, index) => (
                                  <div
                                    className="listening-vocabulary-entry"
                                    key={`${entry.word}-${index}`}
                                  >
                                    <div className="listening-vocabulary-word">
                                      <div>
                                        <strong>{entry.word}</strong>
                                        <button
                                          aria-label={`播放 ${entry.word} 的美式发音`}
                                          className={
                                            speakingWord === entry.word
                                              ? 'vocabulary-audio-button is-speaking'
                                              : 'vocabulary-audio-button'
                                          }
                                          disabled={!speechAvailable}
                                          onClick={() => speakWord(entry.word)}
                                          title={
                                            speechAvailable
                                              ? `播放 ${entry.word} 的美式发音`
                                              : '当前浏览器不支持单词发音'
                                          }
                                          type="button"
                                        >
                                          <Icon name="volume" size={14} />
                                        </button>
                                      </div>
                                      {entry.ipa ? <span>{entry.ipa}</span> : null}
                                    </div>
                                    <p>{entry.definition}</p>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ) : null}

                          <section className="listening-study-section">
                            <div className="listening-section-heading">
                              <div>
                                <p className="eyebrow">Transcript</p>
                                <h3>英文原文</h3>
                              </div>
                              <span>{study.transcriptWordCount} 词</span>
                            </div>
                            {study.transcript ? (
                              <div className="listening-transcript">
                                {study.transcript.split(/\n\n+/u).map((paragraph, index) => (
                                  <p key={index}>{paragraph}</p>
                                ))}
                              </div>
                            ) : (
                              <p className="listening-empty-note">
                                这组旧资料暂未提取出文本
                                {study.documentUrl ? '，请查看原版资料。' : '。'}
                              </p>
                            )}
                          </section>
                        </>
                      ) : (
                        <LoadingState label="正在加载音频、词汇和原文" />
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
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
