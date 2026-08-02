export interface SatGrammarExample {
  correct: string;
  incorrect: string;
}

export interface SatGrammarRule {
  id: string;
  sequence: number;
  title: string;
  core: string;
  method: string;
  examples: SatGrammarExample[];
  trap: string;
  notes: string[];
}

export interface SatGrammarList {
  ordered: boolean;
  items: string[];
}

export interface SatGrammarTable {
  headers: string[];
  rows: string[][];
}

export interface SatGrammarSection {
  id: string;
  sequence: number;
  title: string;
  notes: string[];
  lists: SatGrammarList[];
  tables: SatGrammarTable[];
  rules: SatGrammarRule[];
}

export interface SatGrammarEntry {
  id: string;
  sequence: number;
  kind: 'chapter' | 'appendix';
  label: string;
  title: string;
  intro: string[];
  sections: SatGrammarSection[];
}

export interface SatGrammarLibrary {
  version: string;
  title: string;
  english: string;
  description: string;
  source: {
    fileName: string;
    scope: string;
  };
  summary: {
    chapterCount: number;
    appendixCount: number;
    ruleCount: number;
    examplePairCount: number;
  };
  chapters: SatGrammarEntry[];
  appendices: SatGrammarEntry[];
}

export interface SatGrammarCatalogEntry {
  id: string;
  sequence: number;
  kind: 'chapter' | 'appendix';
  label: string;
  title: string;
  summary: string;
  sectionCount: number;
  ruleCount: number;
  practiceCount?: number;
  knowledgePoints: Array<{
    id: string;
    title: string;
    sectionTitle: string;
    practiceCount?: number;
  }>;
}

export interface SatGrammarCatalog {
  title: string;
  english: string;
  description: string;
  source: SatGrammarLibrary['source'];
  summary: SatGrammarLibrary['summary'];
  entries: SatGrammarCatalogEntry[];
}

export type SatGrammarPracticeAnswer = 'A' | 'B' | 'C' | 'D';

export type SatGrammarPracticeAnswerStatus =
  'original_answer' | 'inferred_duplicate' | 'pending_verification' | 'conflict_review';

export interface SatGrammarPracticeItem {
  id: string;
  chapterId: string;
  category: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  officialSkill: 'Boundaries' | 'Form, Structure, and Sense';
  difficulty: 'Easy' | 'Medium' | 'Hard';
  answer: SatGrammarPracticeAnswer | null;
  answerStatus: SatGrammarPracticeAnswerStatus;
  answerCandidates: SatGrammarPracticeAnswer[];
  gradable: boolean;
  questionText: string;
  choiceTexts: string[];
  explanation: string;
}

export interface SatGrammarPracticeLibrary {
  version: string;
  source: string;
  summary: {
    sourceItemCount: number;
    interactiveItemCount: number;
    excludedItemCount: number;
    gradableItemCount: number;
    pendingVerificationCount: number;
    conflictReviewCount: number;
    embeddedItemCount: number;
    imageItemCount: number;
    textItemCount: number;
    categoryCounts: Record<string, number>;
    chapterCounts: Record<string, number>;
    knowledgePointCounts: Record<string, number>;
  };
  items: SatGrammarPracticeItem[];
}

export interface SatGrammarPracticeSet {
  chapterId: string | null;
  knowledgePointId: string | null;
  scopeLabel: string;
  title: string;
  description: string;
  source: string;
  totalCount: number;
  items: SatGrammarPracticeItem[];
}

export type SatGrammarPracticeMode = 'full' | 'random';

export const SAT_GRAMMAR_RANDOM_SESSION_SIZE = 20;

export function selectSatGrammarSessionItems(
  items: SatGrammarPracticeItem[],
  mode: SatGrammarPracticeMode,
): SatGrammarPracticeItem[] {
  return mode === 'full'
    ? items
    : items.slice(0, Math.min(SAT_GRAMMAR_RANDOM_SESSION_SIZE, items.length));
}
