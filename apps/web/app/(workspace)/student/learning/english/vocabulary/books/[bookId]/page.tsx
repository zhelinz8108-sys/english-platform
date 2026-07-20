import { notFound } from 'next/navigation';
import { VocabularyBookReader } from '@/components/vocabulary-book-reader/vocabulary-book-reader';
import { findVocabularyBook } from '@/data/vocabulary-library';

export default async function StudentVocabularyBookPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
  const book = findVocabularyBook(bookId);
  if (!book) notFound();
  return <VocabularyBookReader book={book} />;
}
