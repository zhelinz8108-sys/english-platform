import type {
  GrammarLesson,
  GrammarLevelId,
  GrammarPublicQuestion,
  GrammarQuestionKind,
  GrammarQuestionOption,
  GrammarStage,
} from './grammar.js';
import grammarLibraryData from './grammar-library.generated.js';

export interface GrammarQuestionDefinition {
  id: string;
  topicId: string;
  level: GrammarLevelId;
  kind: GrammarQuestionKind;
  prompt: string;
  instruction: string;
  options?: GrammarQuestionOption[];
  correctAnswer: string;
  acceptedAnswers?: string[];
  explanation: string;
}

type GeneratedTopic = (typeof grammarLibraryData.parts)[number]['topics'][number];

const generatedTopics = grammarLibraryData.parts.flatMap((part) => [...part.topics]);
const generatedTopicById = new Map<string, GeneratedTopic>(
  generatedTopics.map((topic) => [topic.id, topic]),
);

function inferredRuleTitle(body: string, index: number): string {
  const title = body.split(/[：。；]/u)[0]?.trim() ?? '';
  return title || `核心要点 ${index + 1}`;
}

function toStage(topic: GeneratedTopic): GrammarStage {
  const level = topic.levels[0]!;
  const rules = level.content.map((body, index) => ({
    title: inferredRuleTitle(body, index),
    body,
  }));
  return {
    id: `${topic.id}:beginner`,
    level: 'beginner',
    label: level.label,
    focus: level.focus,
    estimatedMinutes: Math.max(
      6,
      Math.min(18, Math.ceil((rules.length + topic.examples.length + topic.mistakes.length) / 2)),
    ),
    objectives: [],
    rules,
    examples: topic.examples.map((example) => ({ ...example })),
    mistakes: topic.mistakes.map((mistake) => ({ ...mistake })),
    sources: level.source
      ? [
          {
            bookId: 'beginner',
            levelLabel: level.source.level,
            rangeLabel: level.source.rangeLabel,
          },
        ]
      : [],
    questionCount: 0,
    practiceAvailable: false,
  };
}

function toLesson(topic: GeneratedTopic): GrammarLesson {
  return {
    topicId: topic.id,
    title: topic.title,
    english: topic.english,
    overview: topic.overview,
    pilot: true,
    patterns: [...topic.patterns],
    related: [...topic.related],
    stages: [toStage(topic)],
  };
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.。!?！？]+$/u, '');
}

const questions: GrammarQuestionDefinition[] = [];
const questionById = new Map<string, GrammarQuestionDefinition>();

export const grammarContentVersion = 'sat-grammar-3000-v2';
export const grammarTopicIds = generatedTopics.map((topic) => topic.id);
/** @deprecated Use grammarTopicIds. */
export const pilotGrammarTopicIds = grammarTopicIds;

export function getGrammarLesson(topicId: string): GrammarLesson | null {
  const topic = generatedTopicById.get(topicId);
  return topic ? toLesson(topic) : null;
}

/** @deprecated Use getGrammarLesson. */
export const getPilotGrammarLesson = getGrammarLesson;

export function getGrammarQuestionDefinitions(
  topicId: string,
  level: GrammarLevelId,
): GrammarQuestionDefinition[] {
  return questions.filter((question) => question.topicId === topicId && question.level === level);
}

export function getGrammarQuestionDefinition(questionId: string): GrammarQuestionDefinition | null {
  return questionById.get(questionId) ?? null;
}

export function toPublicGrammarQuestion(
  question: GrammarQuestionDefinition,
): GrammarPublicQuestion {
  return {
    id: question.id,
    kind: question.kind,
    prompt: question.prompt,
    instruction: question.instruction,
    ...(question.options ? { options: question.options } : {}),
  };
}

export function isGrammarAnswerCorrect(
  question: GrammarQuestionDefinition,
  answer: string,
): boolean {
  if (question.kind === 'fill_blank') {
    return (question.acceptedAnswers ?? [question.correctAnswer])
      .map(normalizeAnswer)
      .includes(normalizeAnswer(answer));
  }
  return answer === question.correctAnswer;
}

export function grammarCorrectAnswerLabel(question: GrammarQuestionDefinition): string {
  if (question.kind === 'fill_blank') {
    return question.acceptedAnswers?.[0] ?? question.correctAnswer;
  }
  return (
    question.options?.find((option) => option.id === question.correctAnswer)?.label ??
    question.correctAnswer
  );
}

export function validateGrammarContent(): {
  lessonCount: number;
  stageCount: number;
  questionCount: number;
} {
  if (grammarTopicIds.length !== 27) {
    throw new Error(`Expected 27 SAT grammar chapters, found ${grammarTopicIds.length}.`);
  }
  if (new Set(grammarTopicIds).size !== grammarTopicIds.length) {
    throw new Error('Duplicate SAT grammar chapter id.');
  }
  for (const topicId of grammarTopicIds) {
    const lesson = getGrammarLesson(topicId);
    if (!lesson) throw new Error(`Missing SAT grammar chapter: ${topicId}.`);
    if (lesson.stages.length !== 1 || lesson.stages[0]?.level !== 'beginner') {
      throw new Error(`Invalid SAT grammar chapter stage: ${topicId}.`);
    }
    if (lesson.stages[0].practiceAvailable || lesson.stages[0].questionCount !== 0) {
      throw new Error(`SAT grammar practice must stay disabled during rebuild: ${topicId}.`);
    }
  }
  return {
    lessonCount: grammarTopicIds.length,
    stageCount: grammarTopicIds.length,
    questionCount: questions.length,
  };
}

/** @deprecated Use validateGrammarContent. */
export const validateGrammarPilotContent = validateGrammarContent;

validateGrammarContent();
