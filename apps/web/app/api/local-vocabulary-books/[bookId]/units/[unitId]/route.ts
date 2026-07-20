import {
  getLocalVocabularyBook,
  getLocalVocabularyBookUnit,
} from '@/lib/local-vocabulary-books.server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookId: string; unitId: string }> },
) {
  const { bookId, unitId } = await context.params;
  const book = getLocalVocabularyBook(bookId);
  if (!book) return Response.json({ title: 'Book not found', status: 404 }, { status: 404 });
  const unit = await getLocalVocabularyBookUnit(book, unitId);
  if (!unit) return Response.json({ title: 'Unit not found', status: 404 }, { status: 404 });
  return Response.json(unit, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
