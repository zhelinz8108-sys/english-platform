import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath, mode = 'calibration', formCountRaw = '4'] = process.argv.slice(2);
if (!inputPath || !outputPath || !['quick', 'standard', 'calibration'].includes(mode)) {
  throw new Error(
    'Usage: pnpm --filter @english/api generate:vocabulary-forms -- <bank.json> <forms.json> [quick|standard|calibration] [form-count]',
  );
}
const formCount = Number(formCountRaw);
if (!Number.isInteger(formCount) || formCount < 2 || formCount > 20) {
  throw new Error('form-count must be an integer from 2 to 20.');
}
const perBand = { quick: 3, standard: 10, calibration: 20 }[mode];
const purpose = { quick: 'screening', standard: 'parallel', calibration: 'pilot' }[mode];
const bank = JSON.parse(await readFile(inputPath, 'utf8'));
if (!Array.isArray(bank)) throw new Error('The bank export must be a JSON array.');
const contentVersions = new Set(bank.map((item) => item.contentVersion));
const languageVersions = new Set(bank.map((item) => item.languageVersion));
if (contentVersions.size !== 1 || languageVersions.size !== 1) {
  throw new Error('All form items must share one contentVersion and languageVersion.');
}

const byBand = Array.from({ length: 14 }, (_, index) =>
  bank
    .filter((item) => item.band === index + 1)
    .sort(
      (left, right) =>
        Number(left.corpusRank ?? Number.MAX_SAFE_INTEGER) -
          Number(right.corpusRank ?? Number.MAX_SAFE_INTEGER) ||
        String(left.id).localeCompare(String(right.id)),
    ),
);
for (const [index, items] of byBand.entries()) {
  if (items.length < perBand + 1) {
    throw new Error(`Band ${index + 1} needs at least ${perBand + 1} reviewed items.`);
  }
}

const forms = Array.from({ length: formCount }, (_, formIndex) => {
  const selected = byBand.flatMap((items, bandIndex) => {
    const anchor = items[0];
    const pool = items.filter((item) => item.id !== anchor.id);
    const remainder = Array.from({ length: perBand - 1 }, (_, offset) => {
      const start = (formIndex * (perBand - 1) + bandIndex) % pool.length;
      return pool[(start + offset) % pool.length];
    });
    return [
      { itemId: anchor.id, band: bandIndex + 1, isAnchor: true, slot: 0 },
      ...remainder.map((item, slot) => ({
        itemId: item.id,
        band: bandIndex + 1,
        isAnchor: false,
        slot: slot + 1,
      })),
    ];
  });
  selected.sort(
    (left, right) =>
      left.slot - right.slot ||
      ((left.band * 11 + formIndex * 7) % 14) - ((right.band * 11 + formIndex * 7) % 14) ||
      left.itemId.localeCompare(right.itemId),
  );
  return {
    formKey: `${mode}-${String.fromCharCode(65 + formIndex)}`,
    version: 1,
    mode,
    purpose,
    status: 'draft',
    languageVersion: [...languageVersions][0],
    contentVersion: [...contentVersions][0],
    itemCount: selected.length,
    items: selected.map((item, position) => ({
      itemId: item.itemId,
      position: position + 1,
      isAnchor: item.isAnchor,
    })),
  };
});

const exposure = new Map();
const nonAnchorExposure = new Map();
for (const form of forms) {
  for (const item of form.items) {
    exposure.set(item.itemId, (exposure.get(item.itemId) ?? 0) + 1);
    if (!item.isAnchor) {
      nonAnchorExposure.set(item.itemId, (nonAnchorExposure.get(item.itemId) ?? 0) + 1);
    }
  }
}
const exposureValues = [...exposure.values()];
const nonAnchorExposureValues = [...nonAnchorExposure.values()];
const output = {
  generatedAt: new Date().toISOString(),
  design: 'cyclic-balanced-incomplete-block',
  mode,
  formCount,
  perBand,
  exposureRange: {
    minimum: Math.min(...exposureValues),
    maximum: Math.max(...exposureValues),
  },
  nonAnchorExposureRange: {
    minimum: Math.min(...nonAnchorExposureValues),
    maximum: Math.max(...nonAnchorExposureValues),
  },
  forms,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(
  `${JSON.stringify({ outputPath, mode, formCount, itemCountPerForm: perBand * 14, exposureRange: output.exposureRange, nonAnchorExposureRange: output.nonAnchorExposureRange })}\n`,
);
