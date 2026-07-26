import 'server-only';
import type {
  GrammarCatalog,
  GrammarLesson,
  GrammarLevelId,
  GrammarModuleSummary,
} from '@english/shared';
import { getGrammarLesson, grammarTopicIds } from '@english/shared/grammar-content';
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
  patterns: string[];
  levels: RawLevel[];
  examples: Array<{ english: string; chinese: string }>;
  mistakes: Array<{ wrong: string; right: string; explanation: string }>;
  related: string[];
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
const publishedTopicSet = new Set<string>(grammarTopicIds);

export function getGrammarCatalog(): GrammarCatalog {
  return {
    title: raw.title,
    description: raw.description,
    summary: {
      partCount: raw.summary.partCount,
      topicCount: raw.summary.topicCount,
      levelLessonCount: raw.summary.levelLessonCount,
      sourceUnitCount: raw.summary.sourceUnitCount,
      publishedTopicCount: grammarTopicIds.length,
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
        pilot: publishedTopicSet.has(topic.id),
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
  const lesson = getGrammarLesson(topicId);
  if (!lesson) return null;
  return {
    lesson,
    module: context.module,
    previousTopicId: flatTopics[index - 1]?.topic.id ?? null,
    nextTopicId: flatTopics[index + 1]?.topic.id ?? null,
  };
}
