import 'server-only';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import libraryDocument from '@/data/listening-library.json';

export type LocalListeningCollectionId = 'minute-earth' | 'bbc-6-minute-english';

export interface LocalVocabularyEntry {
  word: string;
  ipa: string;
  definition: string;
}

export interface LocalListeningItem {
  id: string;
  collection: LocalListeningCollectionId;
  sequence: number;
  title: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  audioPath: string | null;
  documentPath: string | null;
  transcriptWordCount: number;
  transcript: string;
  vocabulary: LocalVocabularyEntry[];
}

interface LocalListeningCollection {
  id: LocalListeningCollectionId;
  label: string;
  description: string;
  count: number;
}

interface LocalListeningLibrary {
  schemaVersion: number;
  generatedAt: string;
  collections: LocalListeningCollection[];
  items: LocalListeningItem[];
}

const library = libraryDocument as LocalListeningLibrary;
const itemById = new Map(library.items.map((item) => [item.id, item]));

const sourceRoots: Record<LocalListeningCollectionId, string> = {
  'minute-earth': process.env.MINUTE_EARTH_SOURCE_DIR ?? 'D:\\留学\\托福\\听力\\Minute Earth',
  'bbc-6-minute-english':
    process.env.BBC_LISTENING_SOURCE_DIR ??
    'D:\\留学\\托福\\听力\\【BBC】08-23年+bbc+6分钟英语等多个文件',
};

export function localListeningEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || process.env.ENABLE_LOCAL_LISTENING === 'true'
  );
}

export function getLocalListeningCollections(): LocalListeningCollection[] {
  return library.collections;
}

export function getLocalListeningItem(id: string): LocalListeningItem | null {
  return itemById.get(id) ?? null;
}

export function listLocalListeningItems(
  collection: LocalListeningCollectionId,
  query: string,
): LocalListeningItem[] {
  const normalized = query.trim().toLocaleLowerCase('en');
  return library.items.filter(
    (item) =>
      item.collection === collection &&
      (!normalized ||
        item.title.toLocaleLowerCase('en').includes(normalized) ||
        String(item.sequence).includes(normalized) ||
        (item.publishedAt?.includes(normalized) ?? false)),
  );
}

export async function resolveLocalListeningMedia(
  item: LocalListeningItem,
  type: 'audio' | 'document',
): Promise<{ path: string; size: number; contentType: string } | null> {
  const relativePath = type === 'audio' ? item.audioPath : item.documentPath;
  if (!relativePath) return null;
  const root = path.resolve(/* turbopackIgnore: true */ sourceRoots[item.collection]);
  const candidate = path.resolve(root, ...relativePath.split('/'));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return null;
    const extension = path.extname(candidate).toLowerCase();
    const contentType =
      type === 'document'
        ? extension === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf'
        : extension === '.wav'
          ? 'audio/wav'
          : extension === '.m4a'
            ? 'audio/mp4'
            : 'audio/mpeg';
    return { path: candidate, size: info.size, contentType };
  } catch {
    return null;
  }
}
