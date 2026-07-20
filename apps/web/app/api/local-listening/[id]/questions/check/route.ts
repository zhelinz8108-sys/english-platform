import {
  checkLocalListeningAnswers,
  localListeningEnabled,
} from '@/lib/local-listening-library.server';

export const dynamic = 'force-dynamic';

const optionIds = new Set(['a', 'b', 'c', 'd']);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localListeningEnabled()) {
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
  const entries = Object.entries(rawAnswers);
  if (
    entries.length !== 4 ||
    entries.some(
      ([questionId, answer]) =>
        questionId.length > 100 ||
        typeof answer !== 'string' ||
        !optionIds.has(answer.trim().toLocaleLowerCase('en')),
    )
  ) {
    return Response.json(
      { title: 'Complete all four questions before submitting', status: 400 },
      { status: 400 },
    );
  }
  const answers = Object.fromEntries(entries) as Record<string, string>;
  const result = await checkLocalListeningAnswers(id, answers);
  if (!result) {
    return Response.json({ title: 'Question bank is not ready', status: 409 }, { status: 409 });
  }
  if (result.answeredCount !== result.totalCount) {
    return Response.json(
      { title: 'Complete all four questions before submitting', status: 400 },
      { status: 400 },
    );
  }
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
