import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Only the signed-in product is gated. Everything else — the marketing site,
 * the public invoice link, crawler files — must answer 200 to an anonymous
 * request, or AI crawlers and Google index a login redirect instead of the page.
 */
const GATED_PREFIXES = ['/app', '/api/chat', '/api/integrations'];
type CookieList = { name: string; value: string; options?: CookieOptions }[];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const gated = GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!gated) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: CookieList) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/app/:path*', '/api/chat/:path*', '/api/integrations/:path*'],
};
