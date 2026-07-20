export const grammarLevelIds = ['beginner', 'intermediate', 'advanced'] as const;
export type GrammarLevelId = (typeof grammarLevelIds)[number];

export const grammarQuestionKinds = [
  'single_choice',
  'true_false',
  'fill_blank',
  'error_correction',
] as const;
export type GrammarQuestionKind = (typeof grammarQuestionKinds)[number];

export interface GrammarSourceRef {
  bookId: GrammarLevelId;
  levelLabel: string;
  rangeLabel: string;
}

export interface GrammarRuleBlock {
  title: string;
  body: string;
  pattern?: string;
}

export interface GrammarExample {
  english: string;
  chinese: string;
  note?: string;
}

export interface GrammarMistake {
  wrong: string;
  right: string;
  explanation: string;
}

export interface GrammarStage {
  id: string;
  level: GrammarLevelId;
  label: string;
  focus: string;
  estimatedMinutes: number;
  objectives: string[];
  rules: GrammarRuleBlock[];
  examples: GrammarExample[];
  mistakes: GrammarMistake[];
  sources: GrammarSourceRef[];
  questionCount: number;
  practiceAvailable: boolean;
}

export interface GrammarLesson {
  topicId: string;
  title: string;
  english: string;
  overview: string;
  pilot: boolean;
  stages: GrammarStage[];
}

export interface GrammarTopicSummary {
  id: string;
  sequence: number;
  globalSequence: number;
  title: string;
  english: string;
  overview: string;
  pilot: boolean;
}

export interface GrammarModuleSummary {
  id: string;
  sequence: number;
  title: string;
  english: string;
  summary: string;
  topics: GrammarTopicSummary[];
}

export interface GrammarCatalog {
  title: string;
  description: string;
  summary: {
    partCount: number;
    topicCount: number;
    levelLessonCount: number;
    sourceUnitCount: number;
    publishedTopicCount: number;
  };
  modules: GrammarModuleSummary[];
}

export type GrammarProgressStatus = 'not_started' | 'in_progress' | 'practiced' | 'mastered';

export interface GrammarProgressEntry {
  topicId: string;
  level: GrammarLevelId;
  status: GrammarProgressStatus;
  attemptCount: number;
  bestAccuracy: number | null;
  lastAccuracy: number | null;
  activeSessionId: string | null;
  updatedAt: string | null;
}

export interface GrammarProgressEnvelope {
  entries: GrammarProgressEntry[];
  summary: {
    startedStageCount: number;
    practicedStageCount: number;
    masteredStageCount: number;
    publishedStageCount: number;
  };
}

export interface GrammarQuestionOption {
  id: string;
  label: string;
}

export interface GrammarPublicQuestion {
  id: string;
  kind: GrammarQuestionKind;
  prompt: string;
  instruction: string;
  options?: GrammarQuestionOption[];
}

export interface GrammarPracticeResultItem {
  questionId: string;
  kind: GrammarQuestionKind;
  prompt: string;
  selectedAnswer: string;
  correctAnswer: string;
  correct: boolean;
  explanation: string;
}

export interface GrammarPracticeResult {
  sessionId: string;
  topicId: string;
  level: GrammarLevelId;
  correctCount: number;
  questionCount: number;
  accuracy: number;
  bestAccuracy: number;
  mastered: boolean;
  completedAt: string;
  review: GrammarPracticeResultItem[];
}

export interface GrammarPracticeSessionEnvelope {
  sessionId: string;
  topicId: string;
  level: GrammarLevelId;
  status: 'active' | 'completed';
  revision: number;
  answeredCount: number;
  questionCount: number;
  answers: Record<string, string>;
  questions: GrammarPublicQuestion[];
  startedAt: string;
  updatedAt: string;
  result: GrammarPracticeResult | null;
}
