import catalogDocument from './vocabulary-book-catalog.json';

export type VocabularyBookTone = 'teal' | 'amber' | 'plum';
export type VocabularyExtractionMethod = 'text-layer' | 'ocr';
export type VocabularyContentBlockType =
  'title' | 'section' | 'entry' | 'definition' | 'note' | 'example' | 'text';

export interface VocabularyBookItem {
  id: string;
  title: string;
  label?: string;
  page: number;
}

export interface VocabularyBookSection {
  id: string;
  title: string;
  label?: string;
  page: number;
  items: VocabularyBookItem[];
}

export interface VocabularyBook {
  id: string;
  sourceFile: string;
  pageCount: number;
  cover: string;
  title: string;
  shortTitle: string;
  author: string;
  description: string;
  scale: string;
  category: string;
  tone: VocabularyBookTone;
  features: string[];
  extractionMethod: VocabularyExtractionMethod;
  contentReady: boolean;
  wordEntryCount: number;
  duplicateEntryCount: number;
  sections: VocabularyBookSection[];
}

export interface VocabularyContentBlock {
  type: VocabularyContentBlockType;
  text: string;
  headword?: string;
}

export interface VocabularyContentPage {
  number: number;
  blocks: VocabularyContentBlock[];
}

export interface VocabularyBookUnitContent {
  schemaVersion: number;
  bookId: string;
  unitId: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  pageStart: number;
  pageEnd: number;
  extractionMethod: VocabularyExtractionMethod;
  wordEntryCount: number;
  duplicateEntryCount: number;
  pages: VocabularyContentPage[];
}

export interface VocabularyBookCatalog {
  schemaVersion: number;
  sourceDirectory: string;
  summary: {
    bookCount: number;
    pageCount: number;
    learningUnitCount: number;
    uniqueWordEntryCount: number;
    duplicateEntryCount: number;
  };
  books: VocabularyBook[];
}

export const vocabularyBookCatalog = catalogDocument as VocabularyBookCatalog;

export function findVocabularyBook(bookId: string): VocabularyBook | null {
  return vocabularyBookCatalog.books.find((book) => book.id === bookId) ?? null;
}
