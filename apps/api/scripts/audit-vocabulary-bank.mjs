import { readFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path)
  throw new Error('Usage: pnpm --filter @english/api audit:vocabulary-bank -- <bank-export.json>');
const items = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(items)) throw new Error('The export must be a JSON array.');

const lexicalUnits = new Set();
const failures = [];
const counts = Array.from({ length: 14 }, () => 0);
for (const item of items) {
  const key = item.lexicalUnitKey ?? item.wordFamily ?? item.lemma;
  if (!key) failures.push({ itemId: item.id, code: 'missing_lexical_unit' });
  else if (lexicalUnits.has(`${key}:${item.languageVersion}`))
    failures.push({ itemId: item.id, code: 'duplicate_lexical_unit' });
  else lexicalUnits.add(`${key}:${item.languageVersion}`);
  if (!Number.isInteger(item.band) || item.band < 1 || item.band > 14)
    failures.push({ itemId: item.id, code: 'invalid_band' });
  else counts[item.band - 1] += 1;
  for (const field of [
    'lemma',
    'wordFamily',
    'senseKey',
    'partOfSpeech',
    'corpusSource',
    'corpusRank',
    'languageVersion',
    'contentVersion',
  ]) {
    if (item[field] === undefined || item[field] === null || item[field] === '')
      failures.push({ itemId: item.id, code: `missing_${field}` });
  }
  if (!Array.isArray(item.options) || item.options.length !== 4)
    failures.push({ itemId: item.id, code: 'invalid_options' });
  const approved = Array.isArray(item.reviews)
    ? item.reviews.filter(
        (review) =>
          review.decision === 'approve' &&
          review.targetSenseValid &&
          review.singleBestAnswer &&
          review.distractorsBalanced &&
          review.contextNondefining &&
          !review.maskedContextLeak &&
          review.languageNatural,
      )
    : [];
  if (approved.length < 2)
    failures.push({ itemId: item.id, code: 'insufficient_independent_reviews' });
  if (!item.maskedContextReviewed)
    failures.push({ itemId: item.id, code: 'masked_context_not_reviewed' });
}

const report = {
  itemCount: items.length,
  perBand: counts.map((count, index) => ({ band: index + 1, count })),
  pilotReady: items.length >= 280 && counts.every((count) => count >= 20) && failures.length === 0,
  formalReady: items.length >= 700 && counts.every((count) => count >= 20) && failures.length === 0,
  failureCount: failures.length,
  failures: failures.slice(0, 200),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
