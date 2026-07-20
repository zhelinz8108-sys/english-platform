import { getLocalReadingArticle, localReadingEnabled } from '@/lib/local-reading-library.server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localReadingEnabled()) {
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  }
  const { id } = await context.params;
  const article = await getLocalReadingArticle(id);
  if (!article) return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  return Response.json(
    {
      ...article,
      pdfUrl: article.pdfRelativePath
        ? `/api/local-reading/${encodeURIComponent(article.id)}/pdf`
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
