import { notFound } from 'next/navigation';
import { GrammarTopic } from '@/components/grammar-course/grammar-topic';
import { getGrammarTopicContext } from '@/lib/grammar-catalog.server';

export default async function GrammarTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  const context = getGrammarTopicContext(topicId);
  if (!context) notFound();
  return <GrammarTopic {...context} />;
}
