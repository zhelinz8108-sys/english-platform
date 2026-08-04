import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import WordExtractor from 'word-extractor';

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function collectFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) files.push(candidate);
    }
  }
  return files;
}

const rootArgument = argument('root');
if (!rootArgument) throw new Error('Pass --root=<directory containing legacy .doc files>.');
const root = path.resolve(rootArgument);
if (!(await stat(root).catch(() => null))?.isDirectory()) {
  throw new Error(`Legacy document root does not exist: ${root}`);
}

const concurrency = Number.parseInt(argument('concurrency', '6'), 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
  throw new Error('Concurrency must be an integer from 1 to 12.');
}

const files = await collectFiles(root);
const documents = files.filter((file) => path.extname(file).toLowerCase() === '.doc');
const existing = new Set(files.map((file) => file.toLocaleLowerCase('en')));
const alternateExtensions = ['.lrc', '.txt', '.pdf', '.docx'];
const pending = documents.filter((document) => {
  const base = document.slice(0, -path.extname(document).length);
  return !alternateExtensions.some((extension) =>
    existing.has(`${base}${extension}`.toLowerCase()),
  );
});

const extractor = new WordExtractor();
let nextIndex = 0;
let converted = 0;
let skipped = documents.length - pending.length;
let failed = 0;

async function convertNext() {
  while (nextIndex < pending.length) {
    const source = pending[nextIndex++];
    const destination = `${source.slice(0, -path.extname(source).length)}.txt`;
    try {
      const document = await extractor.extract(source);
      const body = document.getBody().replaceAll('\u0000', '').trim();
      if (body.length < 20) throw new Error('extracted body is empty');
      await writeFile(destination, `${body}\n`, 'utf8');
      converted += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `Failed to extract ${source}: ${error instanceof Error ? error.message : error}`,
      );
    }
    const completed = converted + failed;
    if (completed % 50 === 0 || completed === pending.length) {
      console.log(`Processed ${completed}/${pending.length} legacy documents...`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => convertNext()));
console.log(
  `Legacy document extraction complete: ${converted} converted, ${skipped} already had a transcript, ${failed} failed.`,
);
if (failed) process.exitCode = 1;
