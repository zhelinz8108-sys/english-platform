import { notFound } from 'next/navigation';
import { SatGrammarChapter } from '@/components/grammar-course/sat-grammar-chapter';
import { getSatGrammarEntryContext } from '@/lib/sat-grammar-catalog.server';

export default async function SatGrammarChapterPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;
  const context = getSatGrammarEntryContext(chapterId);
  if (!context) notFound();
  return <SatGrammarChapter {...context} />;
}
