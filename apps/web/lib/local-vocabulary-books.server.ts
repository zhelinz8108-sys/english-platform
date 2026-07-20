import 'server-only';

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  findVocabularyBook,
  type VocabularyBook,
  type VocabularyBookUnitContent,
} from '@/data/vocabulary-library';

function projectRoot() {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}apps${path.sep}web`) ? path.resolve(cwd, '..', '..') : cwd;
}

function contentRoot() {
  return path.join(projectRoot(), 'apps', 'web', 'data', 'vocabulary-book-content');
}

export function getLocalVocabularyBook(bookId: string): VocabularyBook | null {
  return findVocabularyBook(bookId);
}

function hasUnit(book: VocabularyBook, unitId: string) {
  return book.sections.some((section) => section.items.some((item) => item.id === unitId));
}

export async function getLocalVocabularyBookUnit(book: VocabularyBook, unitId: string) {
  if (!hasUnit(book, unitId)) return null;
  const root = contentRoot();
  const candidate = path.resolve(root, book.id, `${unitId}.json`);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    const source = await readFile(candidate, 'utf8');
    return JSON.parse(source) as VocabularyBookUnitContent;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
