import { notFound } from 'next/navigation';
import { SatGrammarPractice } from '@/components/grammar-course/sat-grammar-practice';
import { getSatGrammarPracticeSet } from '@/lib/sat-grammar-catalog.server';

export default async function SatGrammarChapterPracticePage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;
  const practice = getSatGrammarPracticeSet(chapterId);
  if (!practice) notFound();
  return <SatGrammarPractice practice={practice} />;
}
