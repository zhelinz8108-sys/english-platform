import {
  getLocalVocabularyBook,
  getLocalVocabularyBookUnit,
} from '@/lib/local-vocabulary-books.server';
import {
  createSentenceVocabularyQuestions,
  extractSentenceVocabularyEntries,
  isSentenceVocabularyAssessmentMode,
  type SentenceVocabularyAssessmentMode,
  type SentenceVocabularyAssessmentPayload,
} from '@/lib/sentence-vocabulary-assessment';

export const dynamic = 'force-dynamic';

function problem(title: string, status: number, detail?: string) {
  return Response.json({ title, status, ...(detail ? { detail } : {}) }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await context.params;
  const book = getLocalVocabularyBook(bookId);
  if (!book) return problem('词汇书不存在', 404);

  let body: { mode?: unknown; unitIds?: unknown };
  try {
    body = (await request.json()) as { mode?: unknown; unitIds?: unknown };
  } catch {
    return problem('请求格式无效', 400);
  }
  if (!isSentenceVocabularyAssessmentMode(body.mode)) return problem('检测模式无效', 400);
  const mode: SentenceVocabularyAssessmentMode = body.mode;
  if (!Array.isArray(body.unitIds) || body.unitIds.length === 0) {
    return problem('请至少选择一个学习单元', 400);
  }

  const allowedUnitIds = new Set(
    book.sections.flatMap((section) => section.items.map((item) => item.id)),
  );
  const unitIds = [
    ...new Set(body.unitIds.filter((value): value is string => typeof value === 'string')),
  ];
  if (unitIds.length === 0 || unitIds.length > allowedUnitIds.size) {
    return problem('学习单元选择无效', 400);
  }
  if (unitIds.some((unitId) => !allowedUnitIds.has(unitId))) {
    return problem('包含不存在的学习单元', 400);
  }

  const units = await Promise.all(
    unitIds.map((unitId) => getLocalVocabularyBookUnit(book, unitId)),
  );
  const entries = units.flatMap((unit) => (unit ? extractSentenceVocabularyEntries(unit) : []));
  try {
    const questions = createSentenceVocabularyQuestions(entries, mode);
    const payload: SentenceVocabularyAssessmentPayload = {
      bookId,
      mode,
      selectedUnitIds: unitIds,
      sourceWordCount: entries.length,
      questionCount: questions.length,
      questions,
    };
    return Response.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return problem(
      '无法生成检测题',
      422,
      error instanceof Error ? error.message : '所选单元的有效词条不足。',
    );
  }
}
