'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { Icon } from '@/components/icon';

export interface VocabularyCardEntry {
  word: string;
  contextTerm?: string;
  ipa: string;
  partOfSpeech: string;
  definition: string;
  englishDefinition?: string;
  context: string;
  contextTranslation: string;
}

interface VocabularyCardsProps {
  entries: VocabularyCardEntry[];
  eyebrow?: string;
  title?: string;
  className?: string;
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
    fish: ['fish', 'fishes'],
    fungus: ['fungi'],
    jog: ['jogged', 'jogging'],
    larva: ['larvae'],
    recur: ['recurred', 'recurring'],
    spin: ['spinning', 'spun'],
    swallow: ['swallow', 'swallowed', 'swallowing'],
  };

  for (const irregular of irregularForms[normalized] ?? []) variants.add(irregular);
  if (/^[a-z]+$/u.test(normalized)) {
    if (normalized.endsWith('y') && normalized.length > 4) {
      variants.add(`${normalized.slice(0, -1)}(?:y|ies|ied|ying)`);
    } else if (normalized.endsWith('e')) {
      variants.add(`${normalized}(?:s|d)?`);
      variants.add(`${normalized.slice(0, -1)}ing`);
    } else if (normalized.endsWith('t')) {
      variants.add(`${normalized}(?:s|ed|ing)?`);
      variants.add(`${normalized}t(?:ed|ing)`);
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

export function VocabularyCards({
  entries,
  eyebrow = 'TOEFL / SAT Vocabulary',
  title = '重点词汇',
  className = '',
}: VocabularyCardsProps) {
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);
  const [speechAvailable, setSpeechAvailable] = useState(false);

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

  if (entries.length === 0) return null;

  return (
    <section
      className={`listening-study-section ${className}`.trim()}
      aria-labelledby="reading-vocabulary-title"
    >
      <div className="listening-section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3 id="reading-vocabulary-title">{title}</h3>
        </div>
        <span>{entries.length} 词</span>
      </div>
      <div className="listening-vocabulary-grid">
        {entries.map((entry) => (
          <div className="listening-vocabulary-entry" key={entry.word}>
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
              <small className="vocabulary-part-of-speech">{entry.partOfSpeech}</small>
            </div>
            <div className="listening-vocabulary-details">
              <p>
                <strong>中文释义：</strong>
                {entry.definition}
              </p>
              <p className="vocabulary-context">
                <strong>原文语境：</strong>
                {highlightedVocabularyContext(entry.context, entry.contextTerm ?? entry.word)}
              </p>
              <p className="vocabulary-context-translation">
                <strong>中文语境：</strong>
                {entry.contextTranslation}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
