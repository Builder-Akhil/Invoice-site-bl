import type { SupabaseClient } from '@supabase/supabase-js';
import { planById, type PlanId } from './product';

/**
 * Plan gates.
 *
 * The cap counts *issued* invoices in the current calendar month — drafts and
 * cancelled documents are free, which is what the pricing page promises. Quotes
 * are never counted.
 */

export function asPlanId(value: unknown): PlanId {
  return value === 'pro' || value === 'byo' ? value : 'free';
}

export function assistantAllowed(plan: PlanId): boolean {
  return planById(plan).ai;
}

export type InvoiceAllowance = {
  plan: PlanId;
  used: number;
  /** null = unlimited */
  limit: number | null;
  /** null = unlimited */
  left: number | null;
  blocked: boolean;
};

export async function invoicesLeftThisMonth(supabase: SupabaseClient): Promise<InvoiceAllowance> {
  const { data: profile } = await supabase
    .from('company_profile').select('plan').eq('id', 1).maybeSingle();
  const plan = asPlanId((profile as { plan?: unknown } | null)?.plan);
  const limit = planById(plan).invoicesPerMonth;
  if (limit == null) return { plan, used: 0, limit: null, left: null, blocked: false };

  const start = new Date();
  start.setDate(1);
  const from = start.toISOString().slice(0, 10);

  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('doc_type', 'invoice')
    .not('status', 'in', '("draft","cancelled")')
    .gte('invoice_date', from);

  const used = count ?? 0;
  const left = Math.max(0, limit - used);
  return { plan, used, limit, left, blocked: left === 0 };
}

export function overLimitMessage(a: InvoiceAllowance): string {
  return `The Free plan covers ${a.limit} issued invoices a month and you have used ${a.used}. `
    + 'Upgrade to Pro for unlimited invoices, or wait for the month to roll over. '
    + 'Drafts stay free — you can prepare them now and issue them next month.';
}
