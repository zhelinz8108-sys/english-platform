import { SatGrammarOverview } from '@/components/grammar-course/sat-grammar-overview';
import { getSatGrammarCatalog, getSatGrammarPracticeCount } from '@/lib/sat-grammar-catalog.server';

export default function SatGrammarPage() {
  return (
    <SatGrammarOverview
      catalog={getSatGrammarCatalog()}
      practiceItemCount={getSatGrammarPracticeCount()}
    />
  );
}
