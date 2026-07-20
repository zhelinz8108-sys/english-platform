import { notFound } from 'next/navigation';
import type { GrammarLevelId } from '@english/shared';
import { GrammarPractice } from '@/components/grammar-course/grammar-practice';
import { getGrammarTopicContext } from '@/lib/grammar-catalog.server';

export default async function StudentGrammarPracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ topicId: string }>;
  searchParams: Promise<{ level?: string }>;
}) {
  const [{ topicId }, query] = await Promise.all([params, searchParams]);
  const level = query.level as GrammarLevelId;
  if (!['beginner', 'intermediate', 'advanced'].includes(level)) notFound();
  const context = getGrammarTopicContext(topicId);
  const stage = context?.lesson.stages.find((item) => item.level === level);
  if (!context?.lesson.pilot || !stage?.practiceAvailable) notFound();
  return <GrammarPractice level={level} title={context.lesson.title} topicId={topicId} />;
}
