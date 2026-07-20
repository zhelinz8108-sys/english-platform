import {
  answerLocalVocabularyQuestion,
  createLocalVocabularySession,
  getLocalVocabularyResult,
  getLocalVocabularySession,
  localVocabularyAssessmentEnabled,
  pauseLocalVocabularySession,
  resumeLocalVocabularySession,
} from '@/lib/local-vocabulary-assessment.server';
import type { VocabularyAssessmentMode } from '@/lib/vocabulary-assessment';

export const dynamic = 'force-dynamic';

function problem(title: string, status: number, detail?: string): Response {
  return Response.json(
    { type: 'about:blank', title, status, ...(detail ? { detail } : {}) },
    { status },
  );
}

export function GET(request: Request): Response {
  if (!localVocabularyAssessmentEnabled()) return problem('Not found', 404);
  const url = new URL(request.url);
  const resultId = url.searchParams.get('resultId');
  if (resultId) {
    const result = getLocalVocabularyResult(resultId);
    return result
      ? Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
      : problem('测评结果不存在', 404, '本地服务重启后，未完成持久化的演示结果会被清除。');
  }
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return problem('缺少 sessionId', 400);
  const session = getLocalVocabularySession(sessionId);
  return session
    ? Response.json(session, { headers: { 'Cache-Control': 'no-store' } })
    : problem('测评会话不存在', 404, '本地服务重启后，未完成的演示会话会被清除。');
}

export async function POST(request: Request): Promise<Response> {
  if (!localVocabularyAssessmentEnabled()) return problem('Not found', 404);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return problem('请求格式无效', 400);
  }

  if (body.action === 'create') {
    const mode = body.mode as VocabularyAssessmentMode;
    if (mode !== 'quick' && mode !== 'standard') return problem('测评模式无效', 400);
    return Response.json(createLocalVocabularySession(mode), { status: 201 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return problem('缺少 sessionId', 400);
  if (body.action === 'pause') {
    const session = pauseLocalVocabularySession(sessionId);
    return session ? Response.json(session) : problem('测评会话不存在', 404);
  }
  if (body.action === 'resume') {
    const session = resumeLocalVocabularySession(sessionId);
    return session ? Response.json(session) : problem('测评会话不存在', 404);
  }
  if (body.action === 'answer') {
    const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
    if (!idempotencyKey) return problem('缺少幂等键', 400);
    if (
      typeof body.deliveryId !== 'string' ||
      typeof body.selectedOptionId !== 'string' ||
      typeof body.responseTimeMs !== 'number' ||
      (body.focusLossCount !== undefined && typeof body.focusLossCount !== 'number')
    ) {
      return problem('作答数据无效', 400);
    }
    const session = answerLocalVocabularyQuestion({
      sessionId,
      deliveryId: body.deliveryId,
      selectedOptionId: body.selectedOptionId,
      responseTimeMs: body.responseTimeMs,
      focusLossCount: typeof body.focusLossCount === 'number' ? body.focusLossCount : 0,
      idempotencyKey,
    });
    return session
      ? Response.json(session)
      : problem('无法提交本题', 409, '本题可能已经提交，或测评当前不在作答状态。');
  }
  return problem('未知操作', 400);
}
