import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { fetchInrRate } from '@/lib/fx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const from = (req.nextUrl.searchParams.get('from') || 'INR').toUpperCase();
  const date = req.nextUrl.searchParams.get('date');
  try {
    const quote = await fetchInrRate(from, date);
    return NextResponse.json(quote, {
      headers: { 'Cache-Control': 'private, max-age=1800' },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fx failed' }, { status: 500 });
  }
}
