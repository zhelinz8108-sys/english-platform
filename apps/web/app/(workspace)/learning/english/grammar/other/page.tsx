import { OtherGrammarOverview } from '@/components/grammar-course/other-grammar-overview';
import { getOtherGrammarCatalog } from '@/lib/other-grammar-catalog.server';

export default function OtherGrammarPage() {
  return <OtherGrammarOverview catalog={getOtherGrammarCatalog()} />;
}
