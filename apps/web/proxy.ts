import { NextResponse, type NextRequest } from 'next/server';
import { authorizeLocalApiRequest } from '@/lib/local-api-auth.server';

export async function proxy(request: NextRequest) {
  const rejection = await authorizeLocalApiRequest(request);
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
