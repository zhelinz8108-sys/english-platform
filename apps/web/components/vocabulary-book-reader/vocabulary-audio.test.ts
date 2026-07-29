import { describe, expect, it } from 'vitest';
import {
  extractEnglishSpeechText,
  extractStandaloneVocabularySpeechText,
  prepareVocabularyBlocks,
  prepareVocabularyPages,
} from './vocabulary-audio';

describe('vocabulary American-audio helpers', () => {
  it('joins wrapped English example lines into one playable example', () => {
    expect(
      prepareVocabularyBlocks([
        { type: 'text', text: 'Essentially, a theory is an abstract representation of what is' },
        { type: 'text', text: 'conceived to be reality.' },
        { type: 'text', text: '理论是现实的一种抽象表达。' },
      ]),
    ).toEqual([
      {
        type: 'example',
        text: 'Essentially, a theory is an abstract representation of what is conceived to be reality.',
      },
      {
        type: 'text',
        text: '理论是现实的一种抽象表达。',
        presentation: 'sentence-translation',
      },
    ]);
  });

  it('removes a grammar-notes section and its content through the next section', () => {
    expect(
      prepareVocabularyPages([
        {
          number: 1,
          blocks: [
            { type: 'title', text: 'Sentence 01' },
            { type: 'section', text: '语法笔记' },
            { type: 'text', text: '本句主干说明。' },
          ],
        },
        {
          number: 2,
          blocks: [
            { type: 'text', text: '跨页的语法说明。' },
            { type: 'section', text: '核心词表' },
            { type: 'entry', text: 'theory n. 理论', headword: 'theory' },
          ],
        },
      ]),
    ).toEqual([
      { number: 1, blocks: [{ type: 'title', text: 'Sentence 01' }] },
      {
        number: 2,
        blocks: [
          { type: 'section', text: '核心词表' },
          { type: 'entry', text: 'theory n. 理论', headword: 'theory' },
        ],
      },
    ]);
  });

  it('does not turn lowercase definition fragments into examples', () => {
    const blocks = [{ type: 'text' as const, text: 'determination or decision)' }];
    expect(prepareVocabularyBlocks(blocks)).toEqual(blocks);
  });

  it('extracts only the English side of a bilingual dialogue line', () => {
    expect(
      extractEnglishSpeechText("A：I'm late! Why didn't the alarm go off?（我迟到了！）"),
    ).toBe("I'm late! Why didn't the alarm go off?");
  });

  it('finds supplemental terms without treating grammar prose as a word', () => {
    expect(extractStandaloneVocabularySpeechText('language acquisition 语言习得')).toBe(
      'language acquisition',
    );
    expect(extractStandaloneVocabularySpeechText('essential a. 本质的')).toBe('essential');
    expect(extractStandaloneVocabularySpeechText('what引导名词性从句')).toBe('');
  });
});
