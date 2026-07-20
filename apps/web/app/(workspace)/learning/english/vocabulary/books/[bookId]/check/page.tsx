import { notFound } from 'next/navigation';
import { SentenceVocabularyCheck } from '@/components/sentence-vocabulary-check/sentence-vocabulary-check';
import { findVocabularyBook } from '@/data/vocabulary-library';

export default async function SentenceVocabularyCheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ sentence?: string }>;
}) {
  const [{ bookId }, { sentence }] = await Promise.all([params, searchParams]);
  const book = findVocabularyBook(bookId);
  if (!book || book.id !== 'toefl-sentences') notFound();
  return <SentenceVocabularyCheck book={book} initialUnitId={sentence} studentRoute={false} />;
}
