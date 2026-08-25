import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { generateExpenseFromRecurring, generateFromProfile } from '@/lib/recurring';
import type { Client, CompanyProfile, RecurringExpense, RecurringProfile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RunOpts = { profileId?: string; expenseId?: string; job?: 'retainers' | 'expenses' | 'all' };

async function run(opts: RunOpts = {}) {
  const admin = createAdminSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const job: RunOpts['job'] = opts.expenseId
    ? 'expenses'
    : opts.profileId
      ? 'retainers'
      : (opts.job ?? 'all');

  const created: string[] = [];
  const expenses: string[] = [];
  const failed: string[] = [];
  let checked = 0;

  if (job === 'retainers' || job === 'all') {
    let q = admin.from('recurring_profiles').select('*, clients(*)').eq('is_active', true);
    q = opts.profileId ? q.eq('id', opts.profileId) : q.lte('next_run_date', today);
    const [{ data: profiles, error }, { data: company }] = await Promise.all([
      q, admin.from('company_profile').select('*').eq('id', 1).single(),
    ]);
    if (error) throw error;
    checked += profiles?.length ?? 0;
    for (const p of (profiles ?? []) as (RecurringProfile & { clients: Client })[]) {
      if (p.end_date && p.end_date < today) continue;
      try {
        const inv = await generateFromProfile(admin, p, (company ?? null) as CompanyProfile | null, opts.profileId ? today : undefined);
        created.push(inv.invoice_number);
      } catch (e) {
        failed.push(`${p.title}: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
  }

  if (job === 'expenses' || job === 'all') {
    let q = admin.from('recurring_expenses').select('*').eq('is_active', true);
    q = opts.expenseId ? q.eq('id', opts.expenseId) : q.lte('next_run_date', today);
    const { data: recs, error } = await q;
    if (error) throw error;
    checked += recs?.length ?? 0;
    for (const rec of (recs ?? []) as RecurringExpense[]) {
      try {
        const exp = await generateExpenseFromRecurring(admin, rec, opts.expenseId ? today : undefined);
        expenses.push(`${exp.vendor_name} ${exp.total_amount}`);
      } catch (e) {
        failed.push(`${rec.title}: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
  }

  return { created, expenses, failed, checked };
}

/** Vercel cron — protected by CRON_SECRET. Runs retainers AND due subscriptions. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const qs = req.nextUrl.searchParams.get('secret');
  if (secret && auth !== `Bearer ${secret}` && qs !== secret)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await run({ job: 'all' })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}

/** "Generate now" from Retainers (profileId) or Subscriptions (expenseId). */
export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as RunOpts;
  const job = body.job
    ?? (body.expenseId ? 'expenses' : 'retainers');
  try { return NextResponse.json(await run({ ...body, job })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}
