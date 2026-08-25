/**
 * Live check that chat tools actually write to Supabase, then delete the rows.
 * Usage: npx tsx --env-file=.env scripts/verify-assistant-tools.ts
 */
import { createClient } from '@supabase/supabase-js';
import { executeAssistantTool } from '../src/lib/assistant-tools';
import type { CompanyProfile } from '../src/lib/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key);
const TAG = 'VERIFY-CHAT-TOOL';

async function main() {
  const { data: company } = await sb.from('company_profile').select('*').eq('id', 1).single();
  const { data: client, error: clientErr } = await sb.from('clients').select('id, company_name').eq('status', 'active').limit(1).maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) throw new Error('Need at least one active client to verify invoices');

  const report: { tool: string; ok: boolean; detail: string }[] = [];
  const cleanup: Array<() => Promise<void>> = [];

  try {
    const exp = await executeAssistantTool(sb, 'create_expense', {
      vendor_name: `${TAG} Airbnb Delhi`,
      taxable_amount: 1234.5,
      tax_split: 'none',
      itc_eligible: false,
      category: 'Travel',
      payment_mode: 'reimbursement',
      paid_by: 'Founder',
      description: 'Automated tool check — delete me',
    }, company as CompanyProfile, 'verify-script');
    const expId = (exp.result as { id: string }).id;
    cleanup.push(async () => { await sb.from('expenses').delete().eq('id', expId); });
    report.push({ tool: 'create_expense', ok: !!exp.created?.href, detail: `${exp.created?.title} ${exp.created?.amount}` });

    const cl = await executeAssistantTool(sb, 'create_client', {
      company_name: `${TAG} Client LLC`,
      gst_treatment: 'overseas',
      currency: 'USD',
    }, company as CompanyProfile);
    const clId = (cl.result as { id: string }).id;
    cleanup.push(async () => { await sb.from('clients').delete().eq('id', clId); });
    report.push({ tool: 'create_client', ok: !!cl.created?.href, detail: String(cl.created?.title) });

    const gst = await executeAssistantTool(sb, 'create_gst_payment', {
      period: '2099-01',
      return_type: 'GSTR-3B',
      igst_paid: 50,
      itc_utilised: 100,
      notes: `${TAG} delete me`,
    }, company as CompanyProfile);
    const gstId = (gst.result as { id: string }).id;
    cleanup.push(async () => { await sb.from('gst_payments').delete().eq('id', gstId); });
    report.push({ tool: 'create_gst_payment', ok: !!gst.created?.href, detail: String(gst.created?.title) });

    const inv = await executeAssistantTool(sb, 'create_draft_invoice', {
      client_id: client.id,
      subject: `${TAG} delete me`,
      line_items: [{ name: 'Verify line', rate: 100, gst_rate: 0 }],
    }, company as CompanyProfile);
    const invId = (inv.result as { id: string }).id;
    const invNo = (inv.result as { invoice_number: string }).invoice_number;
    cleanup.push(async () => {
      await sb.from('invoices').delete().eq('id', invId);
      const n = parseInt(invNo.replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) {
        await sb.from('company_profile').update({ next_invoice_no: n }).eq('id', 1);
      }
    });
    report.push({ tool: 'create_draft_invoice', ok: !!inv.created?.href, detail: String(inv.created?.title) });

    const priorCash = (company as CompanyProfile | null)?.cash_on_hand ?? null;
    const cash = await executeAssistantTool(sb, 'set_cash_on_hand', { amount: 123456 }, company as CompanyProfile);
    cleanup.push(async () => {
      await sb.from('company_profile').update({ cash_on_hand: priorCash }).eq('id', 1);
    });
    report.push({ tool: 'set_cash_on_hand', ok: !!cash.created?.href, detail: String(cash.created?.title) });

    const member = await executeAssistantTool(sb, 'create_team_member', {
      name: `${TAG} Engineer`,
      role: 'Verify',
      basic: 50000,
    }, company as CompanyProfile);
    const memberId = (member.result as { id: string }).id;
    cleanup.push(async () => { await sb.from('team_members').delete().eq('id', memberId); });
    report.push({ tool: 'create_team_member', ok: !!member.created?.href, detail: String(member.created?.title) });

    const pay = await executeAssistantTool(sb, 'upsert_paycheck', {
      member_id: memberId,
      period: '2099-01',
      lines: [{ key: 'performance', score: 80 }, { key: 'skill_gap', value: 2000 }],
    }, company as CompanyProfile);
    report.push({ tool: 'upsert_paycheck', ok: !!pay.created?.href, detail: String(pay.created?.amount) });

    const paid = await executeAssistantTool(sb, 'mark_payroll_paid', {
      member_id: memberId,
      period: '2099-01',
    }, company as CompanyProfile);
    const expFromPay = (paid.result as { expense_id?: string }).expense_id;
    if (expFromPay) cleanup.push(async () => { await sb.from('expenses').delete().eq('id', expFromPay); });
    report.push({ tool: 'mark_payroll_paid', ok: !!paid.created?.href, detail: String(paid.created?.title) });

    const sub = await executeAssistantTool(sb, 'create_recurring_expense', {
      title: `${TAG} Cursor Pro`,
      vendor: 'Anysphere',
      taxable_amount: 20,
      tax_split: 'igst',
      itc_eligible: true,
      category: 'Software & Subscriptions',
    }, company as CompanyProfile);
    const subId = (sub.result as { id: string }).id;
    cleanup.push(async () => { await sb.from('recurring_expenses').delete().eq('id', subId); });
    report.push({ tool: 'create_recurring_expense', ok: !!sub.created?.href, detail: String(sub.created?.title) });
  } finally {
    for (const fn of cleanup.reverse()) await fn();
  }

  const failed = report.filter((r) => !r.ok);
  for (const r of report) console.log(`${r.ok ? 'ok' : 'FAIL'}  ${r.tool}  ${r.detail}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
