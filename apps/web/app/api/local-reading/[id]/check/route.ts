import { checkLocalReadingAnswers, localReadingEnabled } from '@/lib/local-reading-library.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localReadingEnabled()) {
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  }
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ title: 'Invalid JSON', status: 400 }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ title: 'Invalid request', status: 400 }, { status: 400 });
  }
  const rawAnswers = (body as { answers?: unknown }).answers;
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return Response.json({ title: 'Invalid answers', status: 400 }, { status: 400 });
  }
  const answers = Object.fromEntries(
    Object.entries(rawAnswers)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'string' &&
          entry[0].length <= 80 &&
          entry[1].length <= 10,
      )
      .slice(0, 100),
  );
  const result = await checkLocalReadingAnswers(id, answers);
  if (!result) {
    return Response.json(
      { title: 'Answer bank is not ready', status: 409 },
      { status: 409 },
    );
  }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
