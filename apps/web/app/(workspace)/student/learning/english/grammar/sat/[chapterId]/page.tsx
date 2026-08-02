import { notFound } from 'next/navigation';
import { SatGrammarChapter } from '@/components/grammar-course/sat-grammar-chapter';
import {
  getSatGrammarEntryContext,
  getSatGrammarKnowledgePointPracticeCounts,
  getSatGrammarPracticeCount,
} from '@/lib/sat-grammar-catalog.server';

export default async function StudentSatGrammarChapterPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;
  const context = getSatGrammarEntryContext(chapterId);
  if (!context) notFound();
  return (
    <SatGrammarChapter
      {...context}
      knowledgePointPracticeCounts={getSatGrammarKnowledgePointPracticeCounts(chapterId)}
      practiceCount={getSatGrammarPracticeCount(chapterId)}
    />
  );
}
