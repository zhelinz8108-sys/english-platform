'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
type BbcYearFilter = number | 'all' | 'latest';

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
  year?: number | null;
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
  partOfSpeech?: string;
  definition: string;
  englishDefinition?: string;
  context?: string;
  contextTranslation?: string;
}

interface StudyContent {
  id: string;
  sequence: number;
  title: string;
  durationSeconds: number | null;
  transcriptWordCount: number;
  transcript: string;
  vocabulary: VocabularyEntry[];
  studyAidsLocked: boolean;
  questionBankStatus: 'ready' | 'generating' | 'missing-transcript';
  questionSet: ListeningQuestionSet | null;
  playbackUrl?: string | null;
  documentUrl?: string | null;
}

type ListeningQuestionType =
  'main_idea' | 'detail' | 'rhetorical_purpose' | 'inference' | 'organization' | 'prediction';

interface ListeningQuestionOption {
  id: 'a' | 'b' | 'c' | 'd';
  text: string;
}

interface ListeningQuestion {
  id: string;
  position: number;
  type: ListeningQuestionType;
  difficulty: 'low' | 'medium' | 'high';
  prompt: string;
  options: ListeningQuestionOption[];
}

interface ListeningQuestionSet {
  sourceId: string;
  label: string;
  exactSimulation: boolean;
  reviewStatus: 'reviewed' | 'adjudicated' | 'approved';
  questions: ListeningQuestion[];
}

interface ListeningAnswerEvidence {
  start: number;
  end: number;
  quote: string;
  region: '开头' | '中段' | '结尾';
  progressPercent: number;
}

interface ListeningAnswerResult {
  questionId: string;
  selectedOptionId: string | null;
  correctOptionId: 'a' | 'b' | 'c' | 'd';
  correct: boolean;
  explanationZh: string;
  optionRationalesZh: Record<'a' | 'b' | 'c' | 'd', string>;
  evidence: ListeningAnswerEvidence[];
}

interface ListeningCheckResult {
  sourceId: string;
  answeredCount: number;
  correctCount: number;
  totalCount: number;
  percentage: number;
  reviewStatus: 'reviewed' | 'adjudicated' | 'approved';
  results: ListeningAnswerResult[];
  studyAids: {
    transcriptWordCount: number;
    transcript: string;
    vocabulary: VocabularyEntry[];
  };
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
    description: 'BBC 六分钟英语，含音频、原版对话稿和全库首次出现词汇。',
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

function questionTypeLabel(type: ListeningQuestionType): string {
  const labels: Record<ListeningQuestionType, string> = {
    main_idea: '主旨题',
    detail: '细节题',
    rhetorical_purpose: '修辞作用题',
    inference: '推断题',
    organization: '组织结构题',
    prediction: '后续内容题',
  };
  return labels[type];
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

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function vocabularyContextPattern(word: string): RegExp | null {
  const normalized = word.trim().toLocaleLowerCase('en');
  if (!normalized) return null;

  const variants = new Set([
    normalized,
    normalized
      .replace(/\([^)]*\)/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
    normalized.replace(/[()]/gu, '').replace(/\s+/gu, ' ').trim(),
  ]);
  const irregularForms: Record<string, string[]> = {
    bacterium: ['bacteria'],
    bind: ['bound', 'binding'],
    bite: ['bit', 'bitten', 'biting'],
    commit: ['committed', 'committing'],
    compel: ['compelled', 'compelling'],
    criterion: ['criteria'],
    fungus: ['fungi'],
    jog: ['jogged', 'jogging'],
    larva: ['larvae'],
    recur: ['recurred', 'recurring'],
    spin: ['spinning', 'spun'],
  };

  for (const irregular of irregularForms[normalized] ?? []) variants.add(irregular);
  if (/^[a-z]+$/u.test(normalized)) {
    if (normalized.endsWith('y') && normalized.length > 4) {
      variants.add(`${normalized.slice(0, -1)}(?:y|ies|ied|ying)`);
    } else if (normalized.endsWith('e')) {
      variants.add(`${normalized}(?:s|d)?`);
      variants.add(`${normalized.slice(0, -1)}ing`);
    } else {
      variants.add(`${normalized}(?:s|es|ed|ing|er|ers|ly)?`);
    }
  }

  const expressions = [...variants]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map((variant) => (variant.includes('(?:') ? variant : escapeRegularExpression(variant)));
  return expressions.length ? new RegExp(`\\b(?:${expressions.join('|')})\\b`, 'giu') : null;
}

function highlightedVocabularyContext(context: string, word: string): ReactNode {
  const pattern = vocabularyContextPattern(word);
  if (!pattern) return context;
  const matches = [...context.matchAll(pattern)];
  if (matches.length === 0) return context;

  const content: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index;
    if (start > cursor) content.push(context.slice(cursor, start));
    content.push(
      <mark key={`${start}-${match[0]}`} className="vocabulary-context-highlight">
        {match[0]}
      </mark>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < context.length) content.push(context.slice(cursor));
  return content;
}

export default function ToeflListeningPage() {
  const pathname = usePathname();
  const { currentTenant } = useWorkspace();
  const toeflHome = pathname.startsWith('/student/')
    ? '/student/learning/toefl'
    : '/learning/toefl';
  const [tracks, setTracks] = useState<ListeningTrack[]>([]);
  const [collections, setCollections] = useState<ListeningCollection[]>(fallbackCollections);
  const [collectionId, setCollectionId] = useState<ListeningCollectionId | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiProblemError | null>(null);
  const [query, setQuery] = useState('');
  const [bbcYear, setBbcYear] = useState<BbcYearFilter>('latest');
  const [visibleCount, setVisibleCount] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [studyById, setStudyById] = useState<Record<string, StudyContent>>({});
  const [playbackById, setPlaybackById] = useState<Record<string, string>>({});
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [revealedQuestionIds, setRevealedQuestionIds] = useState<Set<string>>(new Set());
  const [questionAnswersById, setQuestionAnswersById] = useState<
    Record<string, Record<string, string>>
  >({});
  const [questionResultsById, setQuestionResultsById] = useState<
    Record<string, ListeningCheckResult>
  >({});
  const [questionMessagesById, setQuestionMessagesById] = useState<Record<string, string>>({});
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);

  async function load() {
    const activeCollectionId = collectionId;
    if (!activeCollectionId) {
      setTracks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode()) {
        const response = await apiRequest<ListeningResponse>(
          `/api/local-listening?collection=${encodeURIComponent(activeCollectionId)}&pageSize=2000`,
        );
        setTracks(response.data);
        if (response.collections) setCollections(response.collections);
        setExpandedId(null);
        setStudyById({});
        setPlaybackById({});
        setRevealedQuestionIds(new Set());
        setQuestionAnswersById({});
        setQuestionResultsById({});
        setQuestionMessagesById({});
        return;
      }

      const response = await apiRequest<ListeningResponse>(
        tenantPath(currentTenant.id, '/learning/toefl/listening?pageSize=300'),
      );
      setTracks(response.data.filter((track) => track.collection === activeCollectionId));
      setExpandedId(null);
      setStudyById({});
      setPlaybackById({});
      setRevealedQuestionIds(new Set());
      setQuestionAnswersById({});
      setQuestionResultsById({});
      setQuestionMessagesById({});
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

  useEffect(() => {
    const updateVisibility = () => setShowBackToTop(window.scrollY > 600);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  const bbcYearCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const track of tracks) {
      const year = track.year ?? Number(track.publishedAt?.slice(0, 4));
      if (Number.isInteger(year)) counts.set(year, (counts.get(year) ?? 0) + 1);
    }
    return counts;
  }, [tracks]);
  const bbcYears = useMemo(
    () => [...bbcYearCounts.keys()].sort((left, right) => right - left),
    [bbcYearCounts],
  );
  const selectedBbcYear = bbcYear === 'latest' ? (bbcYears[0] ?? 'all') : bbcYear;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en');
    return tracks.filter((track) => {
      const year = track.year ?? Number(track.publishedAt?.slice(0, 4));
      const matchesYear =
        collectionId !== 'bbc-6-minute-english' ||
        selectedBbcYear === 'all' ||
        year === selectedBbcYear;
      const matchesQuery =
        !normalized ||
        track.title.toLocaleLowerCase('en').includes(normalized) ||
        String(track.sequence).includes(normalized) ||
        String(track.year ?? '').includes(normalized) ||
        (track.publishedAt?.includes(normalized) ?? false);
      return matchesYear && matchesQuery;
    });
  }, [collectionId, query, selectedBbcYear, tracks]);
  const selectedCollection = collections.find((collection) => collection.id === collectionId);

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

  function revealQuestions(trackId: string) {
    setRevealedQuestionIds((current) => new Set(current).add(trackId));
    window.setTimeout(
      () =>
        document
          .getElementById(`listening-questions-${trackId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      0,
    );
  }

  async function submitListeningQuestions(trackId: string, questionSet: ListeningQuestionSet) {
    const answers = questionAnswersById[trackId] ?? {};
    const firstUnanswered = questionSet.questions.find((question) => !answers[question.id]);
    if (firstUnanswered) {
      setQuestionMessagesById((current) => ({
        ...current,
        [trackId]: `还有 ${questionSet.questions.length - Object.keys(answers).length} 题未作答。`,
      }));
      document
        .getElementById(`listening-question-${firstUnanswered.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmittingQuestionId(trackId);
    setQuestionMessagesById((current) => ({ ...current, [trackId]: '' }));
    try {
      const response = await fetch(
        `/api/local-listening/${encodeURIComponent(trackId)}/questions/check`,
        {
          body: JSON.stringify({ answers }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      if (!response.ok) throw new Error('答案暂时无法核对');
      const checked = (await response.json()) as ListeningCheckResult;
      setQuestionResultsById((current) => ({ ...current, [trackId]: checked }));
      setStudyById((current) => {
        const study = current[trackId];
        if (!study) return current;
        return {
          ...current,
          [trackId]: {
            ...study,
            ...checked.studyAids,
            studyAidsLocked: false,
          },
        };
      });
      setQuestionMessagesById((current) => ({
        ...current,
        [trackId]: `已完成：答对 ${checked.correctCount}/${checked.totalCount} 题。`,
      }));
    } catch {
      setQuestionMessagesById((current) => ({
        ...current,
        [trackId]: '提交失败，请稍后重试。',
      }));
    } finally {
      setSubmittingQuestionId(null);
    }
  }

  function resetListeningQuestions(trackId: string) {
    setQuestionAnswersById((current) => ({ ...current, [trackId]: {} }));
    setQuestionResultsById((current) => {
      const next = { ...current };
      delete next[trackId];
      return next;
    });
    setQuestionMessagesById((current) => ({ ...current, [trackId]: '' }));
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
            aria-expanded={collection.id === collectionId}
            aria-selected={collection.id === collectionId}
            className={
              collection.id === collectionId
                ? 'listening-collection-tab is-active'
                : 'listening-collection-tab'
            }
            key={collection.id}
            onClick={() => {
              const nextCollectionId = collection.id === collectionId ? null : collection.id;
              setCollectionId(nextCollectionId);
              setTracks([]);
              setQuery('');
              setBbcYear(nextCollectionId === 'bbc-6-minute-english' ? 'latest' : 'all');
              setVisibleCount(50);
              setExpandedId(null);
              setStudyById({});
              setPlaybackById({});
            }}
            role="tab"
            type="button"
          >
            <span>{collection.label}</span>
            <small>{collection.count} 组</small>
          </button>
        ))}
      </div>

      {!selectedCollection ? (
        <div className="listening-library-prompt">
          <span>
            <Icon name="headphones" size={21} />
          </span>
          <div>
            <strong>选择一个听力资料库</strong>
            <p>点击上方 Minute Earth 或 BBC 6 Minute English 后，再展开具体学习内容。</p>
          </div>
        </div>
      ) : null}

      {collectionId === 'bbc-6-minute-english' && bbcYears.length ? (
        <section aria-label="BBC 年份筛选" className="listening-year-filter">
          <div className="listening-year-filter-heading">
            <div>
              <strong>按年份浏览</strong>
              <small>沿用原文件夹的年份分类</small>
            </div>
            <span>{bbcYears.length} 个年份</span>
          </div>
          <div className="listening-year-list">
            <button
              aria-pressed={selectedBbcYear === 'all'}
              className={
                selectedBbcYear === 'all'
                  ? 'listening-year-button is-active'
                  : 'listening-year-button'
              }
              onClick={() => {
                setBbcYear('all');
                setVisibleCount(50);
                setExpandedId(null);
              }}
              type="button"
            >
              全部 <small>{tracks.length}</small>
            </button>
            {bbcYears.map((year) => (
              <button
                aria-pressed={selectedBbcYear === year}
                className={
                  selectedBbcYear === year
                    ? 'listening-year-button is-active'
                    : 'listening-year-button'
                }
                key={year}
                onClick={() => {
                  setBbcYear(year);
                  setVisibleCount(50);
                  setExpandedId(null);
                }}
                type="button"
              >
                {year} <small>{bbcYearCounts.get(year)}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedCollection ? (
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
                const questionSet = study?.questionSet ?? null;
                const questionsRevealed = revealedQuestionIds.has(track.id);
                const questionAnswers = questionAnswersById[track.id] ?? {};
                const questionResult = questionResultsById[track.id];
                const questionResultById = new Map(
                  questionResult?.results.map((result) => [result.questionId, result]) ?? [],
                );
                const answeredQuestionCount = questionSet
                  ? questionSet.questions.filter((question) => questionAnswers[question.id]).length
                  : 0;
                const showStudyAids = !questionSet || Boolean(questionResult);
                const publishedDate = formatPublishedDate(track.publishedAt);
                const publishedLabel = publishedDate ?? (track.year ? `${track.year} 年` : null);
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
                          {publishedLabel ? `${publishedLabel} · ` : null}
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
                                <audio
                                  controls
                                  onEnded={() => {
                                    if (questionSet) revealQuestions(track.id);
                                  }}
                                  preload="metadata"
                                  src={playbackUrl}
                                >
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

                            {questionSet ? (
                              <section
                                className="listening-question-section"
                                id={`listening-questions-${track.id}`}
                              >
                                <div className="listening-question-heading">
                                  <div>
                                    <p className="eyebrow">TOEFL Academic Listening</p>
                                    <h3>听力理解题</h3>
                                    <p>
                                      {questionSet.label} ·
                                      四题全部提交后，统一显示答案、中文解析和原文位置。
                                    </p>
                                  </div>
                                  <span>{questionSet.questions.length} 题</span>
                                </div>

                                {!questionsRevealed ? (
                                  <div className="listening-question-gate">
                                    <span>
                                      <Icon name="headphones" size={22} />
                                    </span>
                                    <div>
                                      <strong>先完整听一遍，再开始作答</strong>
                                      <p>
                                        音频播放结束后题目会自动出现；也可以在确认听完后手动开始。
                                      </p>
                                    </div>
                                    <button
                                      className="button button-primary"
                                      onClick={() => revealQuestions(track.id)}
                                      type="button"
                                    >
                                      我已听完，开始答题
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="listening-question-list">
                                      {questionSet.questions.map((question) => {
                                        const result = questionResultById.get(question.id);
                                        return (
                                          <fieldset
                                            className="listening-question-card"
                                            id={`listening-question-${question.id}`}
                                            key={question.id}
                                          >
                                            <legend>
                                              <span>{question.position}</span>
                                              <span>
                                                <small>
                                                  {questionTypeLabel(question.type)} ·{' '}
                                                  {question.difficulty === 'low'
                                                    ? '基础'
                                                    : question.difficulty === 'medium'
                                                      ? '中等'
                                                      : '进阶'}
                                                </small>
                                                {question.prompt}
                                              </span>
                                            </legend>
                                            <div className="listening-question-options">
                                              {question.options.map((option) => {
                                                const optionState = result
                                                  ? option.id === result.correctOptionId
                                                    ? ' is-correct'
                                                    : option.id === result.selectedOptionId
                                                      ? ' is-incorrect'
                                                      : ''
                                                  : '';
                                                return (
                                                  <label
                                                    className={optionState.trim()}
                                                    key={`${question.id}-${option.id}`}
                                                  >
                                                    <input
                                                      checked={
                                                        questionAnswers[question.id] === option.id
                                                      }
                                                      disabled={Boolean(questionResult)}
                                                      name={`${track.id}-${question.id}`}
                                                      onChange={() => {
                                                        setQuestionAnswersById((current) => ({
                                                          ...current,
                                                          [track.id]: {
                                                            ...(current[track.id] ?? {}),
                                                            [question.id]: option.id,
                                                          },
                                                        }));
                                                        setQuestionMessagesById((current) => ({
                                                          ...current,
                                                          [track.id]: '',
                                                        }));
                                                      }}
                                                      type="radio"
                                                    />
                                                    <span>{option.id.toUpperCase()}</span>
                                                    <p>{option.text}</p>
                                                  </label>
                                                );
                                              })}
                                            </div>

                                            {result ? (
                                              <div
                                                className={
                                                  result.correct
                                                    ? 'listening-answer-panel is-correct'
                                                    : 'listening-answer-panel is-incorrect'
                                                }
                                              >
                                                <div className="listening-answer-summary">
                                                  <strong>
                                                    {result.correct ? '回答正确' : '回答错误'}
                                                  </strong>
                                                  <span>
                                                    正确答案：{result.correctOptionId.toUpperCase()}
                                                  </span>
                                                </div>
                                                <p>{result.explanationZh}</p>
                                                <details>
                                                  <summary>查看四个选项解析</summary>
                                                  <div className="listening-option-rationales">
                                                    {question.options.map((option) => (
                                                      <p
                                                        key={`${question.id}-rationale-${option.id}`}
                                                      >
                                                        <strong>{option.id.toUpperCase()}.</strong>{' '}
                                                        {result.optionRationalesZh[option.id]}
                                                      </p>
                                                    ))}
                                                  </div>
                                                </details>
                                                <div className="listening-answer-evidence">
                                                  <strong>对应原文位置</strong>
                                                  {result.evidence.map((span, evidenceIndex) => (
                                                    <blockquote
                                                      id={`listening-evidence-${question.id}-${evidenceIndex}`}
                                                      key={`${span.start}-${span.end}`}
                                                    >
                                                      <small>
                                                        原文{span.region} · 约全文{' '}
                                                        {span.progressPercent}% 处
                                                      </small>
                                                      <p>{span.quote}</p>
                                                    </blockquote>
                                                  ))}
                                                </div>
                                              </div>
                                            ) : null}
                                          </fieldset>
                                        );
                                      })}
                                    </div>

                                    <div className="listening-question-submit">
                                      <div>
                                        <strong>
                                          作答进度 {answeredQuestionCount}/
                                          {questionSet.questions.length}
                                        </strong>
                                        <p>提交前不会显示单题答案；四题完成后统一判分。</p>
                                        {questionMessagesById[track.id] ? (
                                          <span role="status">
                                            {questionMessagesById[track.id]}
                                          </span>
                                        ) : null}
                                      </div>
                                      {questionResult ? (
                                        <button
                                          className="button button-secondary"
                                          onClick={() => resetListeningQuestions(track.id)}
                                          type="button"
                                        >
                                          重新作答
                                        </button>
                                      ) : (
                                        <button
                                          className="button button-primary"
                                          disabled={submittingQuestionId === track.id}
                                          onClick={() =>
                                            void submitListeningQuestions(track.id, questionSet)
                                          }
                                          type="button"
                                        >
                                          {submittingQuestionId === track.id
                                            ? '正在判分'
                                            : '提交全部四题'}
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </section>
                            ) : (
                              <section className="listening-question-pending">
                                <span>
                                  <Icon name="book" size={20} />
                                </span>
                                <div>
                                  <strong>
                                    {study.questionBankStatus === 'missing-transcript'
                                      ? '原文待补齐，暂时不能可靠命题'
                                      : 'TOEFL 听力题正在命题与复核中'}
                                  </strong>
                                  <p>
                                    {study.questionBankStatus === 'missing-transcript'
                                      ? '必须先获得完整原文，才能提供可验证的答案和原文证据。'
                                      : '题组通过独立盲审后会自动显示在音频下方。'}
                                  </p>
                                </div>
                              </section>
                            )}

                            {!showStudyAids ? (
                              <div className="listening-study-locked">
                                <Icon name="book" size={19} />
                                <div>
                                  <strong>原文和重点词汇将在提交四题后解锁</strong>
                                  <p>避免提前看到文字线索影响听力练习的真实性。</p>
                                </div>
                              </div>
                            ) : null}

                            {showStudyAids && study.vocabulary.length ? (
                              <section className="listening-study-section">
                                <div className="listening-section-heading">
                                  <div>
                                    <p className="eyebrow">
                                      {collectionId === 'bbc-6-minute-english'
                                        ? 'BBC Vocabulary · 全库去重'
                                        : 'TOEFL / SAT Vocabulary'}
                                    </p>
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
                                        {entry.partOfSpeech ? (
                                          <small className="vocabulary-part-of-speech">
                                            {entry.partOfSpeech}
                                          </small>
                                        ) : null}
                                      </div>
                                      <div className="listening-vocabulary-details">
                                        <p>
                                          <strong>中文释义：</strong>
                                          {entry.definition}
                                        </p>
                                        {entry.context ? (
                                          <p className="vocabulary-context">
                                            <strong>原文语境：</strong>
                                            {highlightedVocabularyContext(
                                              entry.context,
                                              entry.word,
                                            )}
                                          </p>
                                        ) : null}
                                        {entry.contextTranslation ? (
                                          <p className="vocabulary-context-translation">
                                            <strong>中文语境：</strong>
                                            {entry.contextTranslation}
                                          </p>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            ) : null}

                            {showStudyAids ? (
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
                            ) : null}
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
      ) : null}

      {showBackToTop ? (
        <button
          aria-label="回到页面顶部"
          className="listening-back-to-top"
          onClick={() => {
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ behavior: reduceMotion ? 'auto' : 'smooth', top: 0 });
          }}
          title="回到顶部"
          type="button"
        >
          <Icon name="arrow" size={17} />
          <span>顶部</span>
        </button>
      ) : null}
    </>
  );
}
