import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findVocabularyBook, vocabularyBookCatalog } from '@/data/vocabulary-library';
import type { VocabularyBookUnitContent } from '@/data/vocabulary-library';

function contentRoot() {
  const cwd = process.cwd();
  const webRoot = cwd.endsWith(`${path.sep}apps${path.sep}web`)
    ? cwd
    : path.join(cwd, 'apps', 'web');
  return path.join(webRoot, 'data', 'vocabulary-book-content');
}

describe('local vocabulary book catalog', () => {
  it('indexes all source books and their complete navigation structure', () => {
    expect(vocabularyBookCatalog.summary).toEqual(
      expect.objectContaining({
        bookCount: 4,
        pageCount: 3631,
        learningUnitCount: 662,
      }),
    );
    expect(vocabularyBookCatalog.books.map((book) => book.id)).toEqual([
      'toefl-sentences',
      'gre-random',
      'high-frequency',
      'situational-15000',
    ]);
    expect(findVocabularyBook('missing-book')).toBeNull();
  });

  it('organizes high-frequency vocabulary by continuous ranges instead of grades', () => {
    const book = findVocabularyBook('high-frequency');
    const items = book?.sections.flatMap((section) => section.items) ?? [];
    expect(book).not.toBeNull();
    expect(book?.sections).toHaveLength(7);
    expect(items).toHaveLength(68);
    expect(book?.sections[0]).toEqual(
      expect.objectContaining({
        id: 'range-0001-1000',
        title: '高频词汇 0001–1000',
      }),
    );
    expect(book?.sections.at(-1)).toEqual(
      expect.objectContaining({
        id: 'range-6001-6734',
        title: '高频词汇 6001–6734',
      }),
    );
    expect(book?.sections.some((section) => /grade/i.test(`${section.id} ${section.title}`))).toBe(
      false,
    );
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: 'word-list-001',
        title: '高频词汇 0001–0100',
      }),
    );
    expect(items.at(-1)).toEqual(
      expect.objectContaining({
        id: 'word-list-068',
        title: '高频词汇 6701–6734',
      }),
    );
    expect(items.some((item) => /grade/i.test(`${item.id} ${item.title}`))).toBe(false);
  });

  it('publishes recognized web text and word-level deduplication metadata', () => {
    expect(vocabularyBookCatalog.schemaVersion).toBe(2);
    expect(vocabularyBookCatalog.summary.uniqueWordEntryCount).toBeGreaterThan(0);
    expect(vocabularyBookCatalog.summary.duplicateEntryCount).toBeGreaterThan(0);
    for (const book of vocabularyBookCatalog.books) {
      expect(['text-layer', 'ocr']).toContain(book.extractionMethod);
      expect(book.contentReady).toBe(true);
      expect(book.wordEntryCount).toBeGreaterThan(0);
      expect(book.duplicateEntryCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every section and item id unique inside its source book', () => {
    for (const book of vocabularyBookCatalog.books) {
      const sectionIds = book.sections.map((section) => section.id);
      const itemIds = book.sections.flatMap((section) => section.items.map((item) => item.id));
      expect(new Set(sectionIds).size).toBe(sectionIds.length);
      expect(new Set(itemIds).size).toBe(itemIds.length);
    }
  });

  it('only links catalog entries to valid pages in the original PDF', () => {
    for (const book of vocabularyBookCatalog.books) {
      for (const section of book.sections) {
        expect(section.page).toBeGreaterThanOrEqual(1);
        expect(section.page).toBeLessThanOrEqual(book.pageCount);
        for (const item of section.items) {
          expect(item.page).toBeGreaterThanOrEqual(section.page);
          expect(item.page).toBeLessThanOrEqual(book.pageCount);
          expect(item.title.trim()).not.toBe('');
        }
      }
    }
  });

  it('stores source books without later duplicates and the derived overlap as intentional copies', () => {
    const seen = new Set<string>();
    const commonLitHeadwords = new Set<string>();
    const commonLitPhonetics = new Map<string, string>();
    for (let grade = 3; grade <= 12; grade += 1) {
      const source = readFileSync(
        path.join(
          contentRoot(),
          '..',
          'commonlit-reading-vocabulary',
          `grade-${String(grade).padStart(2, '0')}.json`,
        ),
        'utf8',
      );
      const document = JSON.parse(source) as {
        articles: Array<{ vocabulary: Array<{ word: string; ipa?: string }> }>;
      };
      for (const article of document.articles) {
        for (const entry of article.vocabulary) {
          const normalized = entry.word.trim().toLocaleLowerCase('en-US');
          commonLitHeadwords.add(normalized);
          if (entry.ipa?.trim()) commonLitPhonetics.set(normalized, entry.ipa.trim());
        }
      }
    }

    let derivedEntryCount = 0;
    let derivedPhoneticCount = 0;
    let derivedEnrichedEntryCount = 0;
    let derivedDetailBlockCount = 0;
    for (const book of vocabularyBookCatalog.books) {
      const seenInsideBook = new Set<string>();
      for (const section of book.sections) {
        for (const item of section.items) {
          const source = readFileSync(path.join(contentRoot(), book.id, `${item.id}.json`), 'utf8');
          const unit = JSON.parse(source) as VocabularyBookUnitContent;
          expect(unit.bookId).toBe(book.id);
          expect(unit.unitId).toBe(item.id);
          expect(unit.pages.length).toBeGreaterThan(0);
          if (book.id === 'high-frequency') {
            for (const page of unit.pages) {
              page.blocks.forEach((block, blockIndex) => {
                if (block.type === 'entry') {
                  const nextBlock = page.blocks[blockIndex + 1];
                  if (nextBlock && nextBlock.type !== 'entry') {
                    derivedEnrichedEntryCount += 1;
                  }
                  return;
                }
                expect(['definition', 'note', 'text']).toContain(block.type);
                expect(block.text).not.toMatch(/^(?:原句|出处|中文语境)[：:]/u);
                if (block.type === 'note') {
                  expect(block.text).toMatch(/^(?:记忆|搭配|同义|反义|同根|参考)\s/u);
                }
                derivedDetailBlockCount += 1;
              });
            }
          }
          for (const block of unit.pages.flatMap((page) => page.blocks)) {
            if (book.id === 'high-frequency' && block.type === 'entry') {
              expect(block.text.startsWith(`${block.headword} `)).toBe(true);
              expect(block.text).toMatch(/[\u3400-\u9fff]/u);
            }
            if (block.type !== 'entry' || !block.headword) continue;
            const normalized = block.headword
              .replaceAll('’', "'")
              .trim()
              .toLocaleLowerCase('en-US');
            expect(
              seenInsideBook.has(normalized),
              `duplicate inside ${book.id}: ${normalized}`,
            ).toBe(false);
            seenInsideBook.add(normalized);
            if (book.id === 'high-frequency') {
              expect(seen.has(normalized), `not present in TOEFL/SAT books: ${normalized}`).toBe(
                true,
              );
              expect(
                commonLitHeadwords.has(normalized),
                `not present in CommonLit vocabulary: ${normalized}`,
              ).toBe(true);
              const phonetic = commonLitPhonetics.get(normalized);
              if (phonetic) {
                expect(block.text.startsWith(`${block.headword} ${phonetic} `)).toBe(true);
                derivedPhoneticCount += 1;
              }
              derivedEntryCount += 1;
              continue;
            }
            expect(seen.has(normalized), `duplicate headword: ${normalized}`).toBe(false);
            seen.add(normalized);
          }
        }
      }
    }
    expect(seen.size).toBe(vocabularyBookCatalog.summary.uniqueWordEntryCount);
    expect(derivedEntryCount).toBe(6_734);
    expect(derivedPhoneticCount).toBe(6_679);
    expect(derivedEnrichedEntryCount).toBe(4_108);
    expect(derivedDetailBlockCount).toBe(5_482);
    expect(derivedEntryCount).toBe(findVocabularyBook('high-frequency')?.wordEntryCount);
  });
});
