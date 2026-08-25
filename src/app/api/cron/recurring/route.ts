import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { generateFromProfile } from '@/lib/recurring';
import type { Client, CompanyProfile, RecurringProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function run(profileId?: string) {
  const admin = createAdminSupabase();
  const today = new Date().toISOString().slice(0, 10);

  let q = admin.from('recurring_profiles').select('*, clients(*)').eq('is_active', true);
  if (profileId) q = q.eq('id', profileId);
  else q = q.lte('next_run_date', today);

  const [{ data: profiles, error }, { data: company }] = await Promise.all([
    q, admin.from('company_profile').select('*').eq('id', 1).single(),
  ]);
  if (error) throw error;

  const created: string[] = [];
  const failed: string[] = [];
  for (const p of (profiles ?? []) as (RecurringProfile & { clients: Client })[]) {
    if (p.end_date && p.end_date < today) continue;
    try {
      const inv = await generateFromProfile(admin, p, (company ?? null) as CompanyProfile | null, profileId ? today : undefined);
      created.push(inv.invoice_number);
    } catch (e) {
      failed.push(`${p.title}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }
  return { created, failed, checked: profiles?.length ?? 0 };
}

/** Vercel cron — protected by CRON_SECRET. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const qs = req.nextUrl.searchParams.get('secret');
  if (secret && auth !== `Bearer ${secret}` && qs !== secret)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await run()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}

/** "Generate now" from the Retainers screen. */
export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { profileId } = await req.json().catch(() => ({ profileId: undefined }));
  try { return NextResponse.json(await run(profileId)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}
