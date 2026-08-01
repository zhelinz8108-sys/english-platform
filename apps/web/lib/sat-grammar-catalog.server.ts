import 'server-only';
import satGrammarLibrary from '@/data/sat-grammar-library.json';
import satGrammarPractice from '@/data/sat-grammar-practice.json';
import type {
  SatGrammarCatalog,
  SatGrammarEntry,
  SatGrammarLibrary,
  SatGrammarPracticeLibrary,
  SatGrammarPracticeSet,
} from '@/lib/sat-grammar';

const library = satGrammarLibrary as SatGrammarLibrary;
const practiceLibrary = satGrammarPractice as SatGrammarPracticeLibrary;

const comprehensiveEntryIds = new Set(['problem-solving-framework', 'exam-checklist']);

function itemsForEntry(entryId: string) {
  if (comprehensiveEntryIds.has(entryId)) return practiceLibrary.items;
  if (entryId === 'punctuation-decision-tree') {
    return practiceLibrary.items.filter((item) => item.officialSkill === 'Boundaries');
  }
  if (entryId === 'form-structure-reference') {
    return practiceLibrary.items.filter(
      (item) => item.officialSkill === 'Form, Structure, and Sense',
    );
  }
  return practiceLibrary.items.filter((item) => item.chapterId === entryId);
}

function allEntries(): SatGrammarEntry[] {
  return [...library.chapters, ...library.appendices];
}

export function getSatGrammarCatalog(): SatGrammarCatalog {
  return {
    title: library.title,
    english: library.english,
    description: library.description,
    source: library.source,
    summary: library.summary,
    entries: allEntries().map((entry) => {
      const rules = entry.sections.flatMap((section) =>
        section.rules.map((rule) => ({
          id: rule.id,
          title: rule.title,
          sectionTitle: section.title,
        })),
      );
      const knowledgePoints = rules.length
        ? rules
        : entry.sections.map((section) => ({
            id: section.id,
            title: section.title,
            sectionTitle: entry.title,
          }));
      return {
        id: entry.id,
        sequence: entry.sequence,
        kind: entry.kind,
        label: entry.label,
        title: entry.title,
        summary: entry.intro[0] ?? '按知识点逐项学习并结合例句判断。',
        sectionCount: entry.sections.length,
        ruleCount: rules.length,
        knowledgePoints,
      };
    }),
  };
}

export function getSatGrammarEntryContext(entryId: string): {
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

export function getSatGrammarPracticeCount(entryId?: string): number {
  return entryId ? itemsForEntry(entryId).length : practiceLibrary.items.length;
}

export function getSatGrammarPracticeSet(entryId?: string): SatGrammarPracticeSet | null {
  if (!entryId) {
    return {
      chapterId: null,
      title: 'SAT语法综合练习',
      description: '覆盖全部已校验题目。逐题选择 A–D，提交后立即判分并查看中文解析。',
      source: practiceLibrary.source,
      totalCount: practiceLibrary.items.length,
      items: practiceLibrary.items,
    };
  }

  const entry = allEntries().find((candidate) => candidate.id === entryId);
  if (!entry) return null;
  const items = itemsForEntry(entryId);
  return {
    chapterId: entryId,
    title: `${entry.title} · 单项练习`,
    description: items.length
      ? `围绕“${entry.title}”逐题练习，提交后立即判分并查看中文解析。`
      : `“${entry.title}”暂时没有题面完整且答案可核验的互动题。`,
    source: practiceLibrary.source,
    totalCount: items.length,
    items,
  };
}
