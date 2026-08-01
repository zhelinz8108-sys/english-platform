import { GrammarShelf } from '@/components/grammar-course/grammar-shelf';
import { getSatGrammarCatalog } from '@/lib/sat-grammar-catalog.server';

export default function GrammarPage() {
  return <GrammarShelf summary={getSatGrammarCatalog().summary} />;
}
