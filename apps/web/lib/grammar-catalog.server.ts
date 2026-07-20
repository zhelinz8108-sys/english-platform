import 'server-only';
import type {
  GrammarCatalog,
  GrammarLesson,
  GrammarLevelId,
  GrammarModuleSummary,
  GrammarSourceRef,
} from '@english/shared';
import { getPilotGrammarLesson, pilotGrammarTopicIds } from '@english/shared/grammar-content';
import grammarLibrary from '@/data/grammar-library.json';

interface RawSource {
  level: string;
  rangeLabel: string;
}

interface RawLevel {
  id: GrammarLevelId;
  label: string;
  focus: string;
  content: string[];
  source: RawSource | null;
}

interface RawTopic {
  id: string;
  sequence: number;
  globalSequence: number;
  title: string;
  english: string;
  overview: string;
  levels: RawLevel[];
  examples: Array<{ english: string; chinese: string }>;
  mistakes: Array<{ wrong: string; right: string; explanation: string }>;
  sources: RawSource[];
}

interface RawPart {
  id: string;
  sequence: number;
  title: string;
  english: string;
  summary: string;
  topics: RawTopic[];
}

const raw = grammarLibrary as unknown as {
  title: string;
  description: string;
  summary: GrammarCatalog['summary'];
  parts: RawPart[];
};
const pilotTopicSet = new Set(pilotGrammarTopicIds);

function sourceRef(level: GrammarLevelId, value: RawSource): GrammarSourceRef {
  return { bookId: level, levelLabel: value.level, rangeLabel: value.rangeLabel };
}

export function getGrammarCatalog(): GrammarCatalog {
  return {
    title: raw.title,
    description: raw.description,
    summary: {
      partCount: raw.summary.partCount,
      topicCount: raw.summary.topicCount,
      levelLessonCount: raw.summary.levelLessonCount,
      sourceUnitCount: raw.summary.sourceUnitCount,
      publishedTopicCount: pilotGrammarTopicIds.length,
    },
    modules: raw.parts.map((part) => ({
      id: part.id,
      sequence: part.sequence,
      title: part.title,
      english: part.english,
      summary: part.summary,
      topics: part.topics.map((topic) => ({
        id: topic.id,
        sequence: topic.sequence,
        globalSequence: topic.globalSequence,
        title: topic.title,
        english: topic.english,
        overview: topic.overview,
        pilot: pilotTopicSet.has(topic.id),
      })),
    })),
  };
}

export function getGrammarModule(moduleId: string): GrammarModuleSummary | null {
  return getGrammarCatalog().modules.find((module) => module.id === moduleId) ?? null;
}

export function getGrammarTopicContext(topicId: string): {
  lesson: GrammarLesson;
  module: GrammarModuleSummary;
  previousTopicId: string | null;
  nextTopicId: string | null;
} | null {
  const catalog = getGrammarCatalog();
  const flatTopics = catalog.modules.flatMap((module) =>
    module.topics.map((topic) => ({ module, topic })),
  );
  const index = flatTopics.findIndex(({ topic }) => topic.id === topicId);
  const context = flatTopics[index];
  if (!context) return null;
  const pilot = getPilotGrammarLesson(topicId);
  const sourceTopic = raw.parts
    .flatMap((part) => part.topics)
    .find((topic) => topic.id === topicId)!;
  const lesson: GrammarLesson = pilot ?? {
    topicId: sourceTopic.id,
    title: sourceTopic.title,
    english: sourceTopic.english,
    overview: sourceTopic.overview,
    pilot: false,
    stages: sourceTopic.levels.map((level, levelIndex) => ({
      id: `${sourceTopic.id}:${level.id}`,
      level: level.id,
      label: level.label,
      focus: level.focus,
      estimatedMinutes: 5,
      objectives: [level.focus],
      rules: level.content.map((body, ruleIndex) => ({
        title: `要点 ${String(ruleIndex + 1).padStart(2, '0')}`,
        body,
      })),
      examples: sourceTopic.examples.slice(levelIndex * 2, levelIndex * 2 + 2),
      mistakes: sourceTopic.mistakes,
      sources: level.source ? [sourceRef(level.id, level.source)] : [],
      questionCount: 0,
      practiceAvailable: false,
    })),
  };
  return {
    lesson,
    module: context.module,
    previousTopicId: flatTopics[index - 1]?.topic.id ?? null,
    nextTopicId: flatTopics[index + 1]?.topic.id ?? null,
  };
}
