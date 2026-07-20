import {
  getLocalReadingSummary,
  listLocalReadingItems,
  localReadingEnabled,
} from '@/lib/local-reading-library.server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (!localReadingEnabled()) {
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  }
  const url = new URL(request.url);
  const grade = Number(url.searchParams.get('grade'));
  const summary = getLocalReadingSummary();
  if (!Number.isInteger(grade) || !summary.grades.some((item) => item.grade === grade)) {
    return Response.json({ title: 'Invalid grade', status: 400 }, { status: 400 });
  }
  const query = url.searchParams.get('query') ?? '';
  const requestedLimit = Number(url.searchParams.get('pageSize') ?? 500);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
    : 500;
  const items = listLocalReadingItems(grade, query);
  return Response.json(
    {
      data: items.slice(0, limit),
      summary,
      page: { nextCursor: null, hasMore: items.length > limit, limit },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
