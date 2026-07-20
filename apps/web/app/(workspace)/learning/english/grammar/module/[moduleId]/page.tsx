import { notFound } from 'next/navigation';
import { GrammarModule } from '@/components/grammar-course/grammar-module';
import { getGrammarModule } from '@/lib/grammar-catalog.server';

export default async function GrammarModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = await params;
  const module = getGrammarModule(moduleId);
  if (!module) notFound();
  return <GrammarModule module={module} />;
}
