import { notFound } from 'next/navigation';
import { SatGrammarPractice } from '@/components/grammar-course/sat-grammar-practice';
import { getSatGrammarPracticeSet } from '@/lib/sat-grammar-catalog.server';

export default async function StudentSatGrammarChapterPracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ point?: string }>;
}) {
  const { chapterId } = await params;
  const { point } = await searchParams;
  const practice = getSatGrammarPracticeSet(chapterId, point);
  if (!practice) notFound();
  return <SatGrammarPractice practice={practice} />;
}
