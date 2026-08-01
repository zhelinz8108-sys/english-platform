import { SatGrammarPractice } from '@/components/grammar-course/sat-grammar-practice';
import { getSatGrammarPracticeSet } from '@/lib/sat-grammar-catalog.server';

export default function StudentSatGrammarPracticePage() {
  const practice = getSatGrammarPracticeSet();
  if (!practice) return null;
  return <SatGrammarPractice practice={practice} />;
}
