import { readFile } from 'node:fs/promises';
import { estimateRaschAbility, mapThetaToVocabulary, raschItemInformation } from '@english/shared';

const requestedPath = process.argv[2];
const synthetic = {
  calibrationVersion: 'synthetic-acceptance-fixture',
  mapping: [
    { theta: -4, vocabulary: 0 },
    { theta: 0, vocabulary: 7000 },
    { theta: 4, vocabulary: 14000 },
  ],
  items: Array.from({ length: 700 }, (_, index) => ({
    id: `synthetic-${index + 1}`,
    band: (index % 14) + 1,
    difficulty: -3.5 + ((index % 50) / 49) * 7 + ((index % 7) - 3) * 0.015,
    discrimination: 1,
  })),
};
const fixture = requestedPath ? JSON.parse(await readFile(requestedPath, 'utf8')) : synthetic;

let randomState = 0x71ab19cd;
function random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4294967296;
}

function probability(theta, item) {
  return 1 / (1 + Math.exp(-(item.discrimination ?? 1) * (theta - item.difficulty)));
}

function runStandardCat(trueTheta) {
  const used = new Set();
  const responses = [];
  for (let position = 1; position <= 60; position += 1) {
    const estimate = estimateRaschAbility(responses);
    const covered = new Set(responses.map((row) => row.band));
    const uncovered = Array.from({ length: 14 }, (_, index) => index + 1).filter(
      (band) => !covered.has(band),
    );
    let candidates = fixture.items.filter((item) => !used.has(item.id));
    if (uncovered.length && responses.length < 28)
      candidates = candidates.filter((item) => uncovered.includes(item.band));
    candidates.sort(
      (left, right) =>
        raschItemInformation(estimate.theta, right.difficulty, right.discrimination ?? 1) -
        raschItemInformation(estimate.theta, left.difficulty, left.discrimination ?? 1),
    );
    const top = candidates.slice(0, 5);
    const item = top[Math.floor(random() * top.length)];
    used.add(item.id);
    responses.push({
      band: item.band,
      difficulty: item.difficulty,
      discrimination: item.discrimination ?? 1,
      correct: random() < probability(trueTheta, item),
    });
    const updated = estimateRaschAbility(responses);
    if (responses.length >= 40 && covered.size >= 12 && updated.standardError <= 0.3) break;
  }
  const ability = estimateRaschAbility(responses);
  return {
    estimatedVocabulary: mapThetaToVocabulary(ability.theta, fixture.mapping),
    lowerVocabulary: mapThetaToVocabulary(ability.lowerTheta, fixture.mapping),
    upperVocabulary: mapThetaToVocabulary(ability.upperTheta, fixture.mapping),
    itemCount: responses.length,
  };
}

const thetaLevels = [-3, -2, -1, 0, 1, 2, 3];
const summaries = thetaLevels.map((theta) => {
  const trials = Array.from({ length: 120 }, () => runStandardCat(theta));
  const truth = mapThetaToVocabulary(theta, fixture.mapping);
  return {
    theta,
    truth: Math.round(truth),
    meanEstimate: Math.round(
      trials.reduce((sum, row) => sum + row.estimatedVocabulary, 0) / trials.length,
    ),
    meanAbsoluteError: Math.round(
      trials.reduce((sum, row) => sum + Math.abs(row.estimatedVocabulary - truth), 0) /
        trials.length,
    ),
    intervalCoverage: Number(
      (
        trials.filter((row) => row.lowerVocabulary <= truth && truth <= row.upperVocabulary)
          .length / trials.length
      ).toFixed(3),
    ),
    meanItems: Number(
      (trials.reduce((sum, row) => sum + row.itemCount, 0) / trials.length).toFixed(1),
    ),
    stoppedBy60: Number(
      (trials.filter((row) => row.itemCount <= 60).length / trials.length).toFixed(3),
    ),
  };
});
const monotonic = summaries.every(
  (row, index) => index === 0 || row.meanEstimate > summaries[index - 1].meanEstimate,
);
const targetRows = summaries.filter((row) => row.theta >= -2 && row.theta <= 2);
const gates = {
  monotonic,
  coverage: targetRows.every((row) => row.intervalCoverage >= 0.9 && row.intervalCoverage <= 0.98),
  meanAbsoluteError: targetRows.every((row) => row.meanAbsoluteError <= 800),
  stoppedWithin60: targetRows.every((row) => row.stoppedBy60 >= 0.9),
};
process.stdout.write(
  `${JSON.stringify(
    {
      fixture: fixture.calibrationVersion,
      synthetic: !requestedPath,
      releaseEligible: Boolean(requestedPath) && Object.values(gates).every(Boolean),
      gates,
      summaries,
      note: requestedPath
        ? 'Statistical simulation only; real-person sample, external validity, DIF and retest gates remain mandatory.'
        : 'Synthetic fixture: never eligible for release and never a substitute for human calibration.',
    },
    null,
    2,
  )}\n`,
);
