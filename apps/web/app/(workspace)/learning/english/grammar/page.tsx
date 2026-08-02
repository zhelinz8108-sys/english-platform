import { GrammarShelf } from '@/components/grammar-course/grammar-shelf';
import { getOtherGrammarCatalog } from '@/lib/other-grammar-catalog.server';
import { getSatGrammarCatalog } from '@/lib/sat-grammar-catalog.server';

export default function GrammarPage() {
  return (
    <GrammarShelf
      otherSummary={getOtherGrammarCatalog().summary}
      satSummary={getSatGrammarCatalog().summary}
    />
  );
}
