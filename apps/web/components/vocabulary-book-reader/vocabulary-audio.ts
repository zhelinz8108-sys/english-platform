import type { VocabularyContentBlock, VocabularyContentPage } from '@/data/vocabulary-library';

export interface PreparedVocabularyBlock extends VocabularyContentBlock {
  presentation?: 'sentence-translation';
}

const CJK_TEXT = /[\u3400-\u9fff]/u;
const ENGLISH_WORD = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/gu;
const ENGLISH_FRAGMENT = /[A-Za-z][A-Za-z0-9'’.,!?;:"()\- ]*/gu;
const PART_OF_SPEECH =
  /^(?<headword>[A-Za-z][A-Za-z'’\-]{1,40})\s+(?:n|v|vt|vi|adj|adv|ad|a|prep|pron|conj)\s*\.\s*(?=[\u3400-\u9fff])/iu;
const BILINGUAL_TERM =
  /^(?<headword>[A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,5})\s+(?:[（(])?(?=[\u3400-\u9fff])/u;

function englishWordCount(text: string) {
  return text.match(ENGLISH_WORD)?.length ?? 0;
}

function endsSentence(text: string) {
  return /[.!?]["')\]]?\s*$/u.test(text);
}

function startsEnglishExample(block: VocabularyContentBlock) {
  if (block.type !== 'text') return false;
  const text = block.text.trim();
  if (CJK_TEXT.test(text) || englishWordCount(text) < 4) return false;
  return /^["'(]?[A-Z]/u.test(text) && !/^[A-Z\d\s-]+$/u.test(text);
}

function continuesEnglishExample(block: VocabularyContentBlock) {
  if (block.type !== 'text') return false;
  const text = block.text.trim();
  return (
    !CJK_TEXT.test(text) &&
    !text.startsWith('[') &&
    !/^Word\s*List/iu.test(text) &&
    englishWordCount(text) >= 2
  );
}

export function prepareVocabularyBlocks(blocks: VocabularyContentBlock[]) {
  const prepared: PreparedVocabularyBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (!startsEnglishExample(block)) {
      prepared.push(block);
      continue;
    }

    let text = block.text.trim();
    while (!endsSentence(text)) {
      const next = blocks[index + 1];
      if (!next || !continuesEnglishExample(next)) break;
      text += ` ${next.text.trim()}`;
      index += 1;
    }
    prepared.push({ type: 'example', text });

    let translation = '';
    while (index + 1 < blocks.length) {
      const next = blocks[index + 1];
      if (!next || next.type !== 'text' || !CJK_TEXT.test(next.text)) break;
      translation += next.text.trim();
      index += 1;
      if (/[。！？][”’」』）)]?$/u.test(translation)) break;
    }
    if (translation) {
      prepared.push({
        type: 'text',
        text: translation,
        presentation: 'sentence-translation',
      });
    }
  }
  return prepared;
}

function isGrammarNotesHeading(block: VocabularyContentBlock) {
  return block.type === 'section' && block.text.replace(/\s+/gu, '') === '语法笔记';
}

export function prepareVocabularyPages(pages: VocabularyContentPage[]) {
  let skippingGrammarNotes = false;
  return pages.map((page) => {
    const visibleBlocks: VocabularyContentBlock[] = [];
    for (const block of page.blocks) {
      if (isGrammarNotesHeading(block)) {
        skippingGrammarNotes = true;
        continue;
      }
      if (block.type === 'section') {
        skippingGrammarNotes = false;
      }
      if (!skippingGrammarNotes) visibleBlocks.push(block);
    }
    return { ...page, blocks: prepareVocabularyBlocks(visibleBlocks) };
  });
}

export function extractEnglishSpeechText(text: string) {
  const candidates = text.match(ENGLISH_FRAGMENT) ?? [];
  const best = candidates
    .map((candidate) => candidate.replace(/^\s*[AB]\s*:\s*/u, '').trim())
    .filter((candidate) => /[A-Za-z]{2}/u.test(candidate))
    .sort((left, right) => {
      const wordDifference = englishWordCount(right) - englishWordCount(left);
      return wordDifference || right.length - left.length;
    })[0];
  return best?.replace(/\s+/gu, ' ').trim() ?? '';
}

export function extractStandaloneVocabularySpeechText(text: string) {
  const trimmed = text.trim();
  const match = PART_OF_SPEECH.exec(trimmed) ?? BILINGUAL_TERM.exec(trimmed);
  return match?.groups?.headword?.replace(/\s+/gu, ' ').trim() ?? '';
}
