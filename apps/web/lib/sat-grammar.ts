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
  knowledgePoints: Array<{
    id: string;
    title: string;
    sectionTitle: string;
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
