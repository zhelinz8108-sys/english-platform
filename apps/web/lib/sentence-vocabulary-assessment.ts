import type { VocabularyBookUnitContent } from '@/data/vocabulary-library';

export type SentenceVocabularyAssessmentMode = 'sample-100' | 'all';

export interface SentenceVocabularyEntry {
  id: string;
  unitId: string;
  unitTitle: string;
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
}

export interface SentenceVocabularyOption {
  id: string;
  label: string;
}

export interface SentenceVocabularyQuestion {
  id: string;
  unitId: string;
  unitTitle: string;
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  options: SentenceVocabularyOption[];
  correctOptionId: string;
}

export interface SentenceVocabularyAssessmentPayload {
  bookId: string;
  mode: SentenceVocabularyAssessmentMode;
  selectedUnitIds: string[];
  sourceWordCount: number;
  questionCount: number;
  questions: SentenceVocabularyQuestion[];
}

const CJK_CHARACTER = /[\u3400-\u9fff]/u;
const PART_OF_SPEECH = /\b(vt|vi|adj|adv|prep|pron|conj|n|v|ad|a)\s*\./iu;

function normalizePartOfSpeech(value: string) {
  const normalized = value.toLocaleLowerCase('en');
  if (normalized === 'a' || normalized === 'adj') return 'adj';
  if (normalized === 'ad' || normalized === 'adv') return 'adv';
  if (normalized === 'vt' || normalized === 'vi') return 'v';
  return normalized;
}

function parseEntryDetail(detail: string) {
  const pronunciation = detail.match(/\/[^/]+\/|\[[^\]]+\]/u)?.[0] ?? '';
  const partOfSpeech = normalizePartOfSpeech(PART_OF_SPEECH.exec(detail)?.[1] ?? '');
  const withoutPronunciation = pronunciation ? detail.replace(pronunciation, '').trim() : detail;
  const definitionSource = withoutPronunciation.replace(PART_OF_SPEECH, '').trim();
  const chineseIndex = definitionSource.search(CJK_CHARACTER);
  const opener =
    chineseIndex > 0 && /[（【《“‘]$/u.test(definitionSource.slice(0, chineseIndex))
      ? definitionSource[chineseIndex - 1]
      : '';
  const definition =
    chineseIndex >= 0
      ? `${opener}${definitionSource.slice(chineseIndex)}`.replace(/\s+/gu, ' ').trim()
      : '';
  return { definition, partOfSpeech, pronunciation };
}

export function extractSentenceVocabularyEntries(content: VocabularyBookUnitContent) {
  const entries: SentenceVocabularyEntry[] = [];
  const seenWords = new Set<string>();
  for (const page of content.pages) {
    for (const block of page.blocks) {
      if (block.type !== 'entry' || !block.headword) continue;
      const word = block.headword.replace(/\s+/gu, ' ').trim();
      const normalizedWord = word.toLocaleLowerCase('en');
      if (!/[a-z]/iu.test(word) || seenWords.has(normalizedWord)) continue;
      const detail = block.text.slice(block.headword.length).trim();
      const parsed = parseEntryDetail(detail);
      if (!parsed.definition) continue;
      seenWords.add(normalizedWord);
      entries.push({
        id: `${content.unitId}:${normalizedWord}`,
        unitId: content.unitId,
        unitTitle: content.title,
        word,
        ...parsed,
      });
    }
  }
  return entries;
}

function shuffled<T>(values: T[], random: () => number) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function appendUniqueCandidates(
  target: SentenceVocabularyEntry,
  source: SentenceVocabularyEntry[] | undefined,
  candidates: SentenceVocabularyEntry[],
  definitions: Set<string>,
  random: () => number,
) {
  if (!source?.length || candidates.length >= 3) return;
  for (const candidate of shuffled(source, random)) {
    if (candidate.id === target.id || definitions.has(candidate.definition)) continue;
    definitions.add(candidate.definition);
    candidates.push(candidate);
    if (candidates.length === 3) return;
  }
}

function addToIndex(
  index: Map<string, SentenceVocabularyEntry[]>,
  key: string,
  entry: SentenceVocabularyEntry,
) {
  const bucket = index.get(key) ?? [];
  bucket.push(entry);
  index.set(key, bucket);
}

export function createSentenceVocabularyQuestions(
  sourceEntries: SentenceVocabularyEntry[],
  mode: SentenceVocabularyAssessmentMode,
  random: () => number = Math.random,
) {
  const uniqueEntries = sourceEntries.filter(
    (entry, index, all) =>
      all.findIndex((candidate) => candidate.word.toLocaleLowerCase('en') === entry.word.toLocaleLowerCase('en')) ===
      index,
  );
  if (uniqueEntries.length < 4) throw new Error('至少需要 4 个有效词条才能生成检测题。');

  const byPartOfSpeech = new Map<string, SentenceVocabularyEntry[]>();
  const byUnit = new Map<string, SentenceVocabularyEntry[]>();
  const byUnitAndPart = new Map<string, SentenceVocabularyEntry[]>();
  for (const entry of uniqueEntries) {
    addToIndex(byPartOfSpeech, entry.partOfSpeech, entry);
    addToIndex(byUnit, entry.unitId, entry);
    addToIndex(byUnitAndPart, `${entry.unitId}:${entry.partOfSpeech}`, entry);
  }

  const targets = shuffled(uniqueEntries, random).slice(
    0,
    mode === 'sample-100' ? Math.min(100, uniqueEntries.length) : uniqueEntries.length,
  );

  return targets.map<SentenceVocabularyQuestion>((target, questionIndex) => {
    const candidates: SentenceVocabularyEntry[] = [];
    const definitions = new Set([target.definition]);
    appendUniqueCandidates(
      target,
      byUnitAndPart.get(`${target.unitId}:${target.partOfSpeech}`),
      candidates,
      definitions,
      random,
    );
    appendUniqueCandidates(
      target,
      byPartOfSpeech.get(target.partOfSpeech),
      candidates,
      definitions,
      random,
    );
    appendUniqueCandidates(target, byUnit.get(target.unitId), candidates, definitions, random);
    appendUniqueCandidates(target, uniqueEntries, candidates, definitions, random);
    if (candidates.length < 3) throw new Error('可用的不同中文释义不足，无法生成四选一题目。');

    const optionDefinitions = shuffled(
      [
        { correct: true, label: target.definition },
        ...candidates.map((candidate) => ({ correct: false, label: candidate.definition })),
      ],
      random,
    );
    const options = optionDefinitions.map((option, optionIndex) => ({
      id: `q${questionIndex + 1}-o${optionIndex + 1}`,
      label: option.label,
    }));
    const correctIndex = optionDefinitions.findIndex((option) => option.correct);
    return {
      id: `q${questionIndex + 1}-${target.id}`,
      unitId: target.unitId,
      unitTitle: target.unitTitle,
      word: target.word,
      pronunciation: target.pronunciation,
      partOfSpeech: target.partOfSpeech,
      options,
      correctOptionId: options[correctIndex]!.id,
    };
  });
}
