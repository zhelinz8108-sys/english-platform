'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ListTree,
  ScanText,
  Search,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui';
import type {
  VocabularyBook,
  VocabularyBookItem,
  VocabularyBookUnitContent,
  VocabularyContentBlock,
} from '@/data/vocabulary-library';
import {
  extractEnglishSpeechText,
  extractStandaloneVocabularySpeechText,
  prepareVocabularyPages,
  type PreparedVocabularyBlock,
} from './vocabulary-audio';
import styles from './vocabulary-book-reader.module.css';

interface LocatedItem {
  item: VocabularyBookItem;
  sectionId: string;
  sectionTitle: string;
}

type SpeechKind = 'word' | 'example';
type SpeakHandler = (audioId: string, text: string, kind: SpeechKind) => void;

interface IndexedVocabularyBlock {
  block: PreparedVocabularyBlock;
  index: number;
}

type VocabularyRenderItem =
  | ({ kind: 'block' } & IndexedVocabularyBlock)
  | {
      kind: 'entry';
      entry: IndexedVocabularyBlock;
      details: IndexedVocabularyBlock[];
    };

const AMERICAN_VOICE_PREFERENCES = [
  /Microsoft Aria/iu,
  /Microsoft Jenny/iu,
  /Google US English/iu,
  /Samantha/iu,
  /Alex/iu,
  /Microsoft David/iu,
];

const SPEECH_RESTART_DELAY_MS = 80;
const SPEECH_START_TIMEOUT_MS = 2_500;
const SPEECH_MIN_PLAYBACK_TIMEOUT_MS = 4_000;
const SPEECH_MAX_PLAYBACK_TIMEOUT_MS = 30_000;

function speechPlaybackTimeout(text: string, rate: number) {
  const estimated = Math.ceil((text.length * 180) / rate);
  return Math.min(
    SPEECH_MAX_PLAYBACK_TIMEOUT_MS,
    Math.max(SPEECH_MIN_PLAYBACK_TIMEOUT_MS, estimated),
  );
}

function chooseAmericanVoice(voices: SpeechSynthesisVoice[]) {
  const americanVoices = voices.filter(
    (voice) => voice.lang.replace('_', '-').toLowerCase() === 'en-us',
  );
  for (const preference of AMERICAN_VOICE_PREFERENCES) {
    const preferred = americanVoices.find((voice) => preference.test(voice.name));
    if (preferred) return preferred;
  }
  return americanVoices[0];
}

function AudioButton({
  audioId,
  disabled,
  isSpeaking,
  kind,
  onSpeak,
  text,
}: {
  audioId: string;
  disabled: boolean;
  isSpeaking: boolean;
  kind: SpeechKind;
  onSpeak: SpeakHandler;
  text: string;
}) {
  const label = kind === 'word' ? '单词' : '例句';
  return (
    <button
      aria-label={`${isSpeaking ? '停止' : '播放'}${label}美式发音：${text}`}
      aria-pressed={isSpeaking}
      className={`${styles.audioButton} ${isSpeaking ? styles.audioButtonPlaying : ''}`}
      disabled={disabled}
      onClick={() => onSpeak(audioId, text, kind)}
      title={disabled ? '当前浏览器不支持语音播放' : `${isSpeaking ? '停止' : '播放'}美式发音`}
      type="button"
    >
      {isSpeaking ? <Square size={12} fill="currentColor" /> : <Volume2 size={15} />}
    </button>
  );
}

function EntryBlock({
  audioId,
  audioSupported,
  block,
  isSpeaking,
  onSpeak,
}: {
  audioId: string;
  audioSupported: boolean;
  block: VocabularyContentBlock;
  isSpeaking: boolean;
  onSpeak: SpeakHandler;
}) {
  const headword = block.headword ?? block.text;
  const detail = block.text.slice(headword.length).trim();
  const speechText = extractEnglishSpeechText(headword);
  return (
    <div className={styles.entryBlock}>
      <strong>{headword}</strong>
      {speechText ? (
        <AudioButton
          audioId={audioId}
          disabled={!audioSupported}
          isSpeaking={isSpeaking}
          kind="word"
          onSpeak={onSpeak}
          text={speechText}
        />
      ) : null}
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function TextBlock({
  audioId,
  audioSupported,
  block,
  isSpeaking,
  onSpeak,
}: {
  audioId: string;
  audioSupported: boolean;
  block: PreparedVocabularyBlock;
  isSpeaking: boolean;
  onSpeak: SpeakHandler;
}) {
  if (block.type === 'title') return <h2 className={styles.contentTitle}>{block.text}</h2>;
  if (block.type === 'section') return <h3 className={styles.contentSection}>{block.text}</h3>;
  if (block.type === 'entry') {
    return (
      <EntryBlock
        audioId={audioId}
        audioSupported={audioSupported}
        block={block}
        isSpeaking={isSpeaking}
        onSpeak={onSpeak}
      />
    );
  }
  if (block.type === 'definition') return <p className={styles.definition}>{block.text}</p>;
  if (block.type === 'note') {
    const noteMatch = /^(记忆|搭配|同义|反义|同根|参考)\s*/u.exec(block.text.trim());
    return (
      <p className={styles.note}>
        {noteMatch ? <span className={styles.noteLabel}>{noteMatch[1]}</span> : null}
        <span>{noteMatch ? block.text.trim().slice(noteMatch[0].length) : block.text}</span>
      </p>
    );
  }
  if (block.type === 'example') {
    const speechText = extractEnglishSpeechText(block.text);
    return (
      <div className={styles.exampleRow}>
        <p className={styles.example}>{block.text}</p>
        {speechText ? (
          <AudioButton
            audioId={audioId}
            disabled={!audioSupported}
            isSpeaking={isSpeaking}
            kind="example"
            onSpeak={onSpeak}
            text={speechText}
          />
        ) : null}
      </div>
    );
  }
  const supplementalWord =
    block.type === 'text' ? extractStandaloneVocabularySpeechText(block.text) : '';
  if (supplementalWord) {
    return (
      <div className={styles.bodyAudioRow}>
        <p className={styles.bodyText}>{block.text}</p>
        <AudioButton
          audioId={audioId}
          disabled={!audioSupported}
          isSpeaking={isSpeaking}
          kind="word"
          onSpeak={onSpeak}
          text={supplementalWord}
        />
      </div>
    );
  }
  return (
    <p
      className={
        block.presentation === 'sentence-translation' ? styles.sentenceTranslation : styles.bodyText
      }
    >
      {block.text}
    </p>
  );
}

function groupVocabularyBlocks(blocks: PreparedVocabularyBlock[]): VocabularyRenderItem[] {
  const items: VocabularyRenderItem[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.type !== 'entry') {
      items.push({ block, index, kind: 'block' });
      continue;
    }

    const details: IndexedVocabularyBlock[] = [];
    while (index + 1 < blocks.length) {
      const next = blocks[index + 1];
      if (!next) break;
      const isPlainDetail =
        next.type === 'text' &&
        next.presentation !== 'sentence-translation' &&
        !/[：:]\s*$/u.test(next.text);
      if (next.type !== 'definition' && next.type !== 'note' && !isPlainDetail) break;
      index += 1;
      details.push({ block: next, index });
    }
    items.push({ entry: { block, index: index - details.length }, details, kind: 'entry' });
  }
  return items;
}

function VocabularyEntryGroup({
  audioIdPrefix,
  audioSupported,
  details,
  entry,
  onSpeak,
  speakingId,
}: {
  audioIdPrefix: string;
  audioSupported: boolean;
  details: IndexedVocabularyBlock[];
  entry: IndexedVocabularyBlock;
  onSpeak: SpeakHandler;
  speakingId: string | null;
}) {
  const headword = entry.block.headword ?? entry.block.text;
  const rawDetail = entry.block.text.slice(headword.length).trim();
  const detailMatch = /^(?<phonetic>\/[^/]+\/|\[[^\]]+\])?\s*(?<meaning>.*)$/u.exec(rawDetail);
  const phonetic = detailMatch?.groups?.phonetic ?? '';
  const meaning = detailMatch?.groups?.meaning?.trim() ?? rawDetail;
  const entryAudioId = `${audioIdPrefix}-${entry.index}-entry`;
  const speechText = extractEnglishSpeechText(headword);

  return (
    <section className={styles.entryGroup}>
      <div className={styles.entryLead}>
        <div>
          <strong>{headword}</strong>
          {speechText ? (
            <AudioButton
              audioId={entryAudioId}
              disabled={!audioSupported}
              isSpeaking={speakingId === entryAudioId}
              kind="word"
              onSpeak={onSpeak}
              text={speechText}
            />
          ) : null}
        </div>
        {phonetic ? <span>{phonetic}</span> : null}
      </div>
      <div className={styles.entryDetails}>
        {meaning ? <p className={styles.entryMeaning}>{meaning}</p> : null}
        {details.map(({ block, index }) => {
          const audioId = `${audioIdPrefix}-${index}`;
          return (
            <TextBlock
              audioId={audioId}
              audioSupported={audioSupported}
              block={block}
              isSpeaking={speakingId === audioId}
              key={audioId}
              onSpeak={onSpeak}
            />
          );
        })}
      </div>
    </section>
  );
}

export function VocabularyBookReader({ book }: { book: VocabularyBook }) {
  const pathname = usePathname();
  const vocabularyBase = pathname.startsWith('/student/')
    ? '/student/learning/english/vocabulary'
    : '/learning/english/vocabulary';
  const allItems = useMemo<LocatedItem[]>(
    () =>
      book.sections.flatMap((section) =>
        section.items.map((item) => ({
          item,
          sectionId: section.id,
          sectionTitle: section.title,
        })),
      ),
    [book.sections],
  );
  const first = allItems[0];
  const [activeSectionId, setActiveSectionId] = useState(first?.sectionId ?? '');
  const [currentUnitId, setCurrentUnitId] = useState(first?.item.id ?? '');
  const [query, setQuery] = useState('');
  const [content, setContent] = useState<VocabularyBookUnitContent | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [audioSupported, setAudioSupported] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const activeSpeechIdRef = useRef<string | null>(null);
  const speechStartTimerRef = useRef<number | null>(null);
  const speechWatchdogTimerRef = useRef<number | null>(null);
  const catalogSearchRef = useRef<HTMLInputElement | null>(null);
  const catalogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const readerTopRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const currentIndex = Math.max(
    0,
    allItems.findIndex(({ item }) => item.id === currentUnitId),
  );
  const current = allItems[currentIndex] ?? first;
  const activeSection =
    book.sections.find((section) => section.id === activeSectionId) ?? book.sections[0];

  const clearSpeechTimers = useCallback(() => {
    if (speechStartTimerRef.current !== null) {
      window.clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
    }
    if (speechWatchdogTimerRef.current !== null) {
      window.clearTimeout(speechWatchdogTimerRef.current);
      speechWatchdogTimerRef.current = null;
    }
  }, []);

  const resetSpeech = useCallback(() => {
    clearSpeechTimers();
    const utterance = utteranceRef.current;
    if (utterance) {
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    }
    utteranceRef.current = null;
    activeSpeechIdRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }, [clearSpeechTimers]);

  const searchResults = useMemo<LocatedItem[]>(() => {
    if (!normalizedQuery) return [];
    return allItems.filter(({ item, sectionTitle }) =>
      [item.title, item.label ?? '', sectionTitle]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(normalizedQuery),
    );
  }, [allItems, normalizedQuery]);

  useEffect(() => {
    if (!currentUnitId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setContent(null);
    fetch(
      `/api/local-vocabulary-books/${encodeURIComponent(book.id)}/units/${encodeURIComponent(currentUnitId)}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as VocabularyBookUnitContent;
      })
      .then(setContent)
      .catch((requestError: unknown) => {
        if ((requestError as Error).name !== 'AbortError') {
          setError('这个单元的识别文字暂时无法读取，请稍后重试。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [book.id, currentUnitId]);

  useEffect(() => {
    setAudioSupported('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    return () => {
      clearSpeechTimers();
      const utterance = utteranceRef.current;
      if (utterance) {
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
      }
      utteranceRef.current = null;
      activeSpeechIdRef.current = null;
      window.speechSynthesis?.cancel();
    };
  }, [clearSpeechTimers]);

  useEffect(() => {
    resetSpeech();
  }, [currentUnitId, resetSpeech]);

  useEffect(() => {
    if (!catalogOpen) return;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => catalogSearchRef.current?.focus());
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setCatalogOpen(false);
    }
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      catalogTriggerRef.current?.focus();
    };
  }, [catalogOpen]);

  const playAmericanAudio = useCallback<SpeakHandler>(
    (audioId, text, kind) => {
      if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
      const synthesis = window.speechSynthesis;
      const previousUtterance = utteranceRef.current;
      const hadActiveSpeech =
        previousUtterance !== null || synthesis.speaking || synthesis.pending || synthesis.paused;
      clearSpeechTimers();
      if (previousUtterance) {
        previousUtterance.onstart = null;
        previousUtterance.onend = null;
        previousUtterance.onerror = null;
      }
      const isSameAudio = activeSpeechIdRef.current === audioId;
      utteranceRef.current = null;
      activeSpeechIdRef.current = null;
      if (hadActiveSpeech) synthesis.cancel();
      if (isSameAudio) {
        setSpeakingId(null);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = kind === 'word' ? 0.76 : 0.9;
      utterance.pitch = 1;
      const voice = chooseAmericanVoice(synthesis.getVoices());
      if (voice) utterance.voice = voice;
      let started = false;
      const finish = () => {
        if (utteranceRef.current !== utterance) return;
        clearSpeechTimers();
        utteranceRef.current = null;
        activeSpeechIdRef.current = null;
        setSpeakingId((current) => (current === audioId ? null : current));
      };
      utterance.onstart = () => {
        if (utteranceRef.current !== utterance) return;
        started = true;
        setSpeakingId(audioId);
        if (speechWatchdogTimerRef.current !== null) {
          window.clearTimeout(speechWatchdogTimerRef.current);
        }
        speechWatchdogTimerRef.current = window.setTimeout(
          () => {
            if (utteranceRef.current !== utterance) return;
            synthesis.cancel();
            finish();
          },
          speechPlaybackTimeout(text, utterance.rate),
        );
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      utteranceRef.current = utterance;
      activeSpeechIdRef.current = audioId;
      speechStartTimerRef.current = window.setTimeout(
        () => {
          speechStartTimerRef.current = null;
          if (utteranceRef.current !== utterance) return;
          if (synthesis.paused) synthesis.resume();
          speechWatchdogTimerRef.current = window.setTimeout(() => {
            if (utteranceRef.current !== utterance || started) return;
            synthesis.cancel();
            finish();
          }, SPEECH_START_TIMEOUT_MS);
          synthesis.speak(utterance);
        },
        hadActiveSpeech ? SPEECH_RESTART_DELAY_MS : 0,
      );
    },
    [clearSpeechTimers],
  );

  function openItem(located: LocatedItem) {
    setCurrentUnitId(located.item.id);
    setActiveSectionId(located.sectionId);
    setCatalogOpen(false);
    window.requestAnimationFrame(() =>
      readerTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  function move(offset: number) {
    const next = allItems[currentIndex + offset];
    if (next) openItem(next);
  }

  const visiblePages = useMemo(
    () =>
      content ? prepareVocabularyPages(content.pages).filter((page) => page.blocks.length > 0) : [],
    [content],
  );

  return (
    <div className={styles.page}>
      <PageHeader
        actions={
          <Link className={styles.backLink} href={vocabularyBase}>
            <ArrowLeft size={17} /> 返回词汇书架
          </Link>
        }
        description={book.description}
        eyebrow={`英语 · 词汇 · ${book.category}`}
        title={book.shortTitle}
      />

      <section className={styles.readerShell}>
        <div className={styles.viewerPanel}>
          <div className={styles.viewerToolbar} ref={readerTopRef}>
            <button
              aria-controls="vocabulary-catalog-drawer"
              aria-expanded={catalogOpen}
              className={styles.catalogTrigger}
              onClick={() => setCatalogOpen(true)}
              ref={catalogTriggerRef}
              type="button"
            >
              <ListTree size={17} /> 目录
            </button>
            <div>
              <small>正在阅读 · {current?.sectionTitle}</small>
              <strong>{current?.item.title}</strong>
            </div>
            {book.id === 'toefl-sentences' ? (
              <Link
                className={styles.checkLink}
                href={`${vocabularyBase}/books/${book.id}/check?sentence=${encodeURIComponent(currentUnitId)}`}
              >
                <ClipboardCheck size={16} /> 检测
              </Link>
            ) : null}
            <nav aria-label="切换学习单元">
              <button
                aria-label="上一个单元"
                disabled={currentIndex === 0}
                onClick={() => move(-1)}
                type="button"
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {currentIndex + 1} / {allItems.length}
              </span>
              <button
                aria-label="下一个单元"
                disabled={currentIndex === allItems.length - 1}
                onClick={() => move(1)}
                type="button"
              >
                <ChevronRight size={17} />
              </button>
            </nav>
          </div>

          <div className={styles.contentViewport}>
            {loading ? (
              <div className={styles.loadingState} role="status">
                <ScanText size={28} />
                <strong>正在载入识别文字…</strong>
                <span>内容按单元读取，不会加载或嵌入 PDF。</span>
              </div>
            ) : null}
            {error ? <div className={styles.errorState}>{error}</div> : null}
            {content && !loading ? (
              <article className={styles.webText}>
                <header className={styles.unitHeader}>
                  <p>{content.sectionTitle}</p>
                  <h1>{content.title}</h1>
                  <div>
                    <span>
                      原书 P. {content.pageStart}
                      {content.pageEnd > content.pageStart ? `–${content.pageEnd}` : ''}
                    </span>
                    <span>{content.wordEntryCount} 个首次出现词条</span>
                    {content.duplicateEntryCount > 0 ? (
                      <span>已去除 {content.duplicateEntryCount} 个重复词条</span>
                    ) : null}
                  </div>
                </header>
                {visiblePages.length ? (
                  visiblePages.map((page) => (
                    <section className={styles.contentPage} key={page.number}>
                      <div className={styles.pageMarker}>原书第 {page.number} 页</div>
                      <div className={styles.blockList}>
                        {groupVocabularyBlocks(page.blocks).map((item) => {
                          const audioIdPrefix = `${content.unitId}-${page.number}`;
                          if (item.kind === 'entry') {
                            return (
                              <VocabularyEntryGroup
                                audioIdPrefix={audioIdPrefix}
                                audioSupported={audioSupported}
                                details={item.details}
                                entry={item.entry}
                                key={`${audioIdPrefix}-${item.entry.index}-group`}
                                onSpeak={playAmericanAudio}
                                speakingId={speakingId}
                              />
                            );
                          }
                          const audioId = `${audioIdPrefix}-${item.index}`;
                          return (
                            <TextBlock
                              audioId={audioId}
                              audioSupported={audioSupported}
                              block={item.block}
                              isSpeaking={speakingId === audioId}
                              key={audioId}
                              onSpeak={playAmericanAudio}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className={styles.emptyState}>
                    本单元词条均已在前面的书或单元中出现，已按你的规则移除后续重复内容。
                  </div>
                )}
              </article>
            ) : null}
          </div>
        </div>
      </section>

      {catalogOpen ? (
        <div className={styles.catalogOverlay}>
          <button
            aria-label="关闭文字目录"
            className={styles.catalogBackdrop}
            onClick={() => setCatalogOpen(false)}
            type="button"
          />
          <aside
            aria-label={`${book.shortTitle}目录`}
            aria-modal="true"
            className={styles.catalogPanel}
            id="vocabulary-catalog-drawer"
            role="dialog"
          >
            <div className={styles.catalogTitle}>
              <div>
                <p className={styles.kicker}>BOOK CONTENTS</p>
                <h2>文字目录</h2>
              </div>
              <span>{allItems.length} 单元</span>
              <button
                aria-label="关闭文字目录"
                className={styles.catalogClose}
                onClick={() => setCatalogOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </div>
            <label className={styles.searchBox}>
              <Search size={16} />
              <span className="sr-only">搜索原书目录</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 Sentence、Word List 或场景"
                ref={catalogSearchRef}
                type="search"
                value={query}
              />
            </label>

            {normalizedQuery ? (
              <div className={styles.searchResults}>
                <p>找到 {searchResults.length} 个目录项</p>
                {searchResults.slice(0, 120).map((located) => (
                  <button
                    className={located.item.id === currentUnitId ? styles.activeItem : undefined}
                    key={`${located.sectionId}-${located.item.id}`}
                    onClick={() => openItem(located)}
                    type="button"
                  >
                    <span>
                      <strong>{located.item.title}</strong>
                      <small>{located.sectionTitle}</small>
                    </span>
                    <em>P. {located.item.page}</em>
                  </button>
                ))}
                {searchResults.length > 120 ? (
                  <small>结果较多，请输入更具体的关键词。</small>
                ) : null}
              </div>
            ) : (
              <div className={styles.sectionList}>
                {book.sections.map((section) => {
                  const expanded = section.id === activeSection?.id;
                  return (
                    <div className={expanded ? styles.sectionOpen : undefined} key={section.id}>
                      <button
                        aria-expanded={expanded}
                        className={styles.sectionButton}
                        onClick={() => setActiveSectionId(expanded ? '' : section.id)}
                        type="button"
                      >
                        <span>
                          <small>{section.label ?? '目录分组'}</small>
                          <strong>{section.title}</strong>
                        </span>
                        <em>{section.items.length}</em>
                        <ChevronDown size={17} />
                      </button>
                      {expanded ? (
                        <div className={styles.itemList}>
                          {section.items.map((item) => (
                            <button
                              className={item.id === currentUnitId ? styles.activeItem : undefined}
                              key={item.id}
                              onClick={() =>
                                openItem({
                                  item,
                                  sectionId: section.id,
                                  sectionTitle: section.title,
                                })
                              }
                              type="button"
                            >
                              <span>
                                {item.label ? <small>{item.label}</small> : null}
                                <strong>{item.title}</strong>
                              </span>
                              <em>P. {item.page}</em>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
