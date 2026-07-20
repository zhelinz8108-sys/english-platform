import { readFile } from 'node:fs/promises';
import {
  getLocalReadingArticle,
  localReadingEnabled,
  resolveLocalReadingPdf,
} from '@/lib/local-reading-library.server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localReadingEnabled()) {
    return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  }
  const { id } = await context.params;
  const article = await getLocalReadingArticle(id);
  if (!article) return Response.json({ title: 'Not found', status: 404 }, { status: 404 });
  const file = await resolveLocalReadingPdf(article);
  if (!file) return Response.json({ title: 'PDF not found', status: 404 }, { status: 404 });

  const filename = `${article.title.replace(/[\\/:*?"<>|]/gu, '-').slice(0, 100) || article.id}.pdf`;
  const buffer = await readFile(file.path);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(file.size),
      'Content-Type': 'application/pdf',
    },
  });
}
