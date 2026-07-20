import {
  answerLocalGrammarQuestion,
  createLocalGrammarSession,
  getLocalGrammarProgress,
  getLocalGrammarSession,
  localGrammarPracticeEnabled,
  submitLocalGrammarSession,
} from '@/lib/local-grammar-practice.server';
import type { GrammarLevelId } from '@english/shared';

export const dynamic = 'force-dynamic';

function problem(title: string, status: number, detail?: string): Response {
  return Response.json(
    { type: 'about:blank', title, status, ...(detail ? { detail } : {}) },
    { status },
  );
}

export function GET(request: Request): Response {
  if (!localGrammarPracticeEnabled()) return problem('Not found', 404);
  const url = new URL(request.url);
  if (url.searchParams.get('action') === 'progress') {
    return Response.json(getLocalGrammarProgress(), { headers: { 'Cache-Control': 'no-store' } });
  }
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return problem('缺少 sessionId', 400);
  const session = getLocalGrammarSession(sessionId);
  return session ? Response.json(session) : problem('练习会话不存在', 404);
}

export async function POST(request: Request): Promise<Response> {
  if (!localGrammarPracticeEnabled()) return problem('Not found', 404);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return problem('请求格式无效', 400);
  }
  if (body.action === 'create') {
    const topicId = typeof body.topicId === 'string' ? body.topicId : '';
    const level = body.level as GrammarLevelId;
    if (!['beginner', 'intermediate', 'advanced'].includes(level)) {
      return problem('学习阶段无效', 400);
    }
    const session = createLocalGrammarSession(topicId, level);
    return session
      ? Response.json(session, { status: 201 })
      : problem('该知识点阶段尚未开放练习', 404);
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
  if (!sessionId || !idempotencyKey) return problem('缺少会话或幂等键', 400);
  if (body.action === 'answer') {
    if (typeof body.questionId !== 'string' || typeof body.value !== 'string') {
      return problem('答案格式无效', 400);
    }
    const session = answerLocalGrammarQuestion({
      sessionId,
      questionId: body.questionId,
      value: body.value,
      idempotencyKey,
    });
    return session ? Response.json(session) : problem('无法保存答案', 409);
  }
  if (body.action === 'submit') {
    const result = submitLocalGrammarSession(sessionId, idempotencyKey);
    return result ? Response.json(result) : problem('请完成全部10道题后再提交', 409);
  }
  return problem('未知操作', 400);
}
