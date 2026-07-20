import {
  getLocalListeningCollections,
  listLocalListeningItems,
  localListeningEnabled,
  type LocalListeningCollectionId,
} from '@/lib/local-listening-library.server';

export const dynamic = 'force-dynamic';

const collectionIds = new Set<LocalListeningCollectionId>(['minute-earth', 'bbc-6-minute-english']);

export function GET(request: Request) {
  if (!localListeningEnabled()) {
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  }
  const url = new URL(request.url);
  const collection = (url.searchParams.get('collection') ??
    'minute-earth') as LocalListeningCollectionId;
  if (!collectionIds.has(collection)) {
    return Response.json({ title: 'Invalid collection', status: 400 }, { status: 400 });
  }
  const query = url.searchParams.get('query') ?? '';
  const requestedLimit = Number(url.searchParams.get('pageSize') ?? 2000);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(2000, Math.max(1, Math.trunc(requestedLimit)))
    : 2000;
  const items = listLocalListeningItems(collection, query);
  return Response.json(
    {
      data: items.slice(0, limit).map((item) => ({
        id: item.id,
        collection: item.collection,
        sequence: item.sequence,
        title: item.title,
        year: item.year,
        publishedAt: item.publishedAt,
        durationSeconds: item.durationSeconds,
        sizeBytes: item.sizeBytes,
        hasStudyContent: item.transcriptWordCount > 0 || item.vocabulary.length > 0,
        hasAudio: Boolean(item.audioPath),
        hasDocument: Boolean(item.documentPath),
        transcriptWordCount: item.transcriptWordCount,
        vocabularyCount: item.vocabulary.length,
      })),
      collections: getLocalListeningCollections(),
      page: { nextCursor: null, hasMore: items.length > limit, limit },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
