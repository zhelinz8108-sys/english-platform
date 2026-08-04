import { NextResponse, type NextRequest } from 'next/server';
import { authorizeLocalApiRequest } from '@/lib/local-api-auth.server';

export async function proxy(request: NextRequest) {
  const allowLocalListeningDemo =
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true' &&
    process.env.ENABLE_LOCAL_LISTENING === 'true' &&
    request.nextUrl.pathname.startsWith('/api/local-listening');
  const rejection = await authorizeLocalApiRequest(
    request,
    undefined,
    undefined,
    undefined,
    allowLocalListeningDemo,
  );
  return rejection ?? NextResponse.next();
}

export const config = {
  matcher: [
    '/api/local-grammar-practice/:path*',
    '/api/local-listening/:path*',
    '/api/local-reading/:path*',
    '/api/local-vocabulary-assessment/:path*',
    '/api/local-vocabulary-books/:path*',
  ],
};
