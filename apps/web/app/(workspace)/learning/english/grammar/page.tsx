import { GrammarOverview } from '@/components/grammar-course/grammar-overview';
import { getGrammarCatalog } from '@/lib/grammar-catalog.server';

export default function GrammarPage() {
  return <GrammarOverview catalog={getGrammarCatalog()} />;
}
