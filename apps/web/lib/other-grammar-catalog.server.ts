import 'server-only';
import otherGrammarLibrary from '@/data/other-grammar-library';
import type { SatGrammarCatalog, SatGrammarEntry, SatGrammarLibrary } from '@/lib/sat-grammar';

const library = otherGrammarLibrary as SatGrammarLibrary;

function allEntries(): SatGrammarEntry[] {
  return [...library.chapters, ...library.appendices];
}

export function getOtherGrammarCatalog(): SatGrammarCatalog {
  return {
    title: library.title,
    english: library.english,
    description: library.description,
    source: library.source,
    summary: library.summary,
    entries: allEntries().map((entry) => {
      const knowledgePoints = entry.sections.flatMap((section) =>
        section.rules.map((rule) => ({
          id: rule.id,
          title: rule.title,
          sectionTitle: section.title,
        })),
      );
      return {
        id: entry.id,
        sequence: entry.sequence,
        kind: entry.kind,
        label: entry.label,
        title: entry.title,
        summary: entry.intro[0] ?? '按知识点逐项学习，并结合正误例句判断。',
        sectionCount: entry.sections.length,
        ruleCount: knowledgePoints.length,
        knowledgePoints,
      };
    }),
  };
}

export function getOtherGrammarEntryContext(entryId: string): {
  entry: SatGrammarEntry;
  previous: Pick<SatGrammarEntry, 'id' | 'label' | 'title'> | null;
  next: Pick<SatGrammarEntry, 'id' | 'label' | 'title'> | null;
} | null {
  const entries = allEntries();
  const index = entries.findIndex((entry) => entry.id === entryId);
  const entry = entries[index];
  if (!entry) return null;
  const pick = (item: SatGrammarEntry | undefined) =>
    item ? { id: item.id, label: item.label, title: item.title } : null;
  return {
    entry,
    previous: pick(entries[index - 1]),
    next: pick(entries[index + 1]),
  };
}
