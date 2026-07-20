import { VocabularyLibrary } from '@/components/vocabulary-library/vocabulary-library';
import { vocabularyBookCatalog } from '@/data/vocabulary-library';

export default function VocabularyPage() {
  return <VocabularyLibrary catalog={vocabularyBookCatalog} />;
}
