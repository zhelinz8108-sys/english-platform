import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getLocalListeningItem,
  localListeningEnabled,
  resolveLocalListeningMedia,
} from '@/lib/local-listening-library.server';

export const dynamic = 'force-dynamic';

function parseRange(range: string | null, size: number): { start: number; end: number } | null {
  const match = range?.match(/^bytes=(\d*)-(\d*)$/u);
  if (!match) return null;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) return null;
  const start = startText ? Number(startText) : Math.max(0, size - Number(endText));
  const end = endText ? Number(endText) : size - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localListeningEnabled()) return new Response('Not found', { status: 404 });
  const { id } = await context.params;
  const item = getLocalListeningItem(id);
  if (!item) return new Response('Not found', { status: 404 });
  const type = new URL(request.url).searchParams.get('type') === 'document' ? 'document' : 'audio';
  const media = await resolveLocalListeningMedia(item, type);
  if (!media) return new Response('Media not found', { status: 404 });
  const originalFilename = path.basename(media.path);
  const fallbackFilename = originalFilename.replaceAll(/[^\x20-\x7e]/gu, '_').replaceAll('"', '');
  const encodedFilename = encodeURIComponent(originalFilename);

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': media.contentType,
    'Content-Disposition': `inline; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
  });
  const range = type === 'audio' ? parseRange(request.headers.get('range'), media.size) : null;
  if (range) {
    const length = range.end - range.start + 1;
    const handle = await open(media.path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, range.start);
      headers.set('Content-Length', String(length));
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${media.size}`);
      return new Response(new Uint8Array(buffer), { status: 206, headers });
    } finally {
      await handle.close();
    }
  }

  const buffer = await readFile(media.path);
  headers.set('Content-Length', String(buffer.byteLength));
  return new Response(new Uint8Array(buffer), { headers });
}
