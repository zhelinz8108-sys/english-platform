import { notFound } from 'next/navigation';
import { OtherGrammarChapter } from '@/components/grammar-course/other-grammar-chapter';
import { getOtherGrammarEntryContext } from '@/lib/other-grammar-catalog.server';

export default async function OtherGrammarChapterPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;
  const context = getOtherGrammarEntryContext(chapterId);
  if (!context) notFound();
  return <OtherGrammarChapter {...context} />;
}
