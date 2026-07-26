#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'apps/web/data/grammar-library.json');
const outputPath = resolve(root, 'packages/shared/src/grammar-library.generated.ts');
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));

const practiceData = {
  parts: source.parts.map((part) => ({
    topics: part.topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      english: topic.english,
      overview: topic.overview,
      patterns: topic.patterns,
      levels: topic.levels.map((level) => ({
        id: level.id,
        label: level.label,
        focus: level.focus,
        content: level.content,
        source: level.source
          ? {
              level: level.source.level,
              rangeLabel: level.source.rangeLabel,
            }
          : null,
      })),
      examples: topic.examples,
      mistakes: topic.mistakes,
      related: topic.related,
    })),
  })),
};

const rendered = await format(
  `// Generated from apps/web/data/grammar-library.json.
// Run "pnpm grammar:generate" after rebuilding the grammar library.
const grammarLibraryData = ${JSON.stringify(practiceData, null, 2)} as const;

export default grammarLibraryData;
`,
  { ...(await resolveConfig(outputPath)), parser: 'typescript', filepath: outputPath },
);

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== rendered) {
    throw new Error('Grammar practice data is stale. Run "pnpm grammar:generate".');
  }
} else {
  writeFileSync(outputPath, rendered, 'utf8');
  console.log(`Generated ${outputPath}`);
}
