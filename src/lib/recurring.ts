import type { SupabaseClient } from '@supabase/supabase-js';
import { computeTotals, resolveTaxMode, supplierState } from './gst';
import { defaultPlaceOfSupply } from './gst';
import { splitExpenseTax } from './finance';
import { fetchInrRate } from './fx';
import { resolveInvoiceTerms } from './terms';
import type { Client, CompanyProfile, InvoiceLine, RecurringExpense, RecurringProfile } from './types';

export function advance(dateISO: string, frequency: string, dayOfMonth?: number | null) {
  const d = new Date(dateISO + 'T00:00:00');
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  if (dayOfMonth && frequency !== 'weekly') {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, last));
  }
  return d.toISOString().slice(0, 10);
}

/** Creates one draft invoice from a recurring profile and rolls its next run date. */
export async function generateFromProfile(
  admin: SupabaseClient,
  profile: RecurringProfile & { clients?: Client | null },
  company: CompanyProfile | null,
  onDate?: string,
) {
  const client = profile.clients ?? null;
  if (!client) throw new Error(`Recurring profile "${profile.title}" has no client`);

  const invoice_date = onDate ?? profile.next_run_date;
  const supplier = supplierState(company);
  const pos = defaultPlaceOfSupply(client);
  const mode = resolveTaxMode(supplier.code, client.gst_treatment, pos.code);

  const lines = (profile.line_items ?? []) as InvoiceLine[];
  if (!lines.length) throw new Error(`Recurring profile "${profile.title}" has no line items`);

  const t = computeTotals(lines, mode, {
    roundOff: true, tdsApplicable: client.tds_applicable, tdsRate: Number(client.tds_rate ?? 10),
  });

  const { data: numData, error: numErr } = await admin.rpc('next_document_number', { p_doc_type: 'invoice' });
  if (numErr) throw numErr;

  const { data: inserted, error } = await admin.from('invoices').insert({
    doc_type: 'invoice',
    invoice_number: numData as string,
    client_id: client.id,
    client_snapshot: client,
    invoice_date,
    ...resolveInvoiceTerms({
      invoiceDate: invoice_date,
      paymentTermsDays: profile.due_days ?? client.payment_terms_days ?? 7,
    }),
    subject: profile.subject ?? profile.title,
    place_of_supply: pos.name, place_of_supply_code: pos.code,
    tax_mode: mode, currency: profile.currency ?? client.currency ?? 'INR', exchange_rate: 1,
    status: 'draft',
    subtotal: t.subtotal, discount_total: t.discount_total,
    cgst_total: t.cgst_total, sgst_total: t.sgst_total, igst_total: t.igst_total,
    cess_total: t.cess_total, tax_total: t.tax_total, round_off: t.round_off,
    total: t.total, balance_due: t.total,
    tds_applicable: client.tds_applicable, tds_section: client.tds_section,
    tds_rate: client.tds_rate ?? 0, tds_amount: t.tds_amount,
    notes: profile.notes ?? company?.default_notes ?? null,
    terms: profile.terms ?? company?.default_terms ?? null,
    lut_number: company?.lut_number ?? null,
    recurring_id: profile.id,
  }).select('id, invoice_number').single();
  if (error) throw error;

  const rows = lines.map((l, i) => {
    const c = computeTotals([l], mode, { roundOff: false });
    return {
      invoice_id: inserted.id, position: i, name: l.name || 'Retainer',
      description: l.description ?? null, code_type: l.code_type ?? 'SAC', code: l.code ?? null,
      unit: l.unit ?? 'month', quantity: Number(l.quantity) || 1, rate: Number(l.rate) || 0,
      discount_pct: Number(l.discount_pct) || 0, taxable_value: c.subtotal,
      gst_rate: Number(l.gst_rate) || 0, cgst_amount: c.cgst_total, sgst_amount: c.sgst_total,
      igst_amount: c.igst_total, cess_rate: 0, cess_amount: 0,
      line_total: Number((c.subtotal + c.tax_total).toFixed(2)),
    };
  });
  await admin.from('invoice_items').insert(rows);

  const next = advance(invoice_date, profile.frequency, profile.day_of_month);
  await admin.from('recurring_profiles').update({
    next_run_date: next, last_run_at: new Date().toISOString(), amount: t.total,
  }).eq('id', profile.id);

  await admin.from('activity_log').insert({
    entity: 'invoice', entity_id: inserted.id, action: 'recurring_generated',
    detail: `${inserted.invoice_number} from retainer "${profile.title}"`, actor: 'system',
  });

  return inserted as { id: string; invoice_number: string };
}

/** Logs one vendor expense from a subscription profile and rolls its next run date. */
export async function generateExpenseFromRecurring(
  admin: SupabaseClient,
  rec: RecurringExpense,
  onDate?: string,
) {
  const expense_date = onDate ?? rec.next_run_date;
  const tax = splitExpenseTax(Number(rec.taxable_amount), Number(rec.gst_rate), rec.tax_split ?? 'igst');
  const currency = rec.currency ?? 'INR';
  const quote = await fetchInrRate(currency, expense_date);
  const fxNote = currency === 'INR'
    ? `Recurring spend: ${rec.title}`
    : `Recurring spend: ${rec.title} · ${currency}→INR ${quote.rate} as of ${quote.asOf}`;
  const { data, error } = await admin.from('expenses').insert({
    expense_date,
    vendor_name: rec.vendor,
    category: rec.category,
    description: rec.title,
    taxable_amount: rec.taxable_amount,
    ...tax,
    itc_eligible: rec.itc_eligible,
    currency,
    exchange_rate: quote.rate,
    payment_mode: 'card',
    reference: rec.id,
    notes: rec.notes ? `${rec.notes}\n${fxNote}` : fxNote,
  }).select('id, vendor_name, total_amount, currency').single();
  if (error) throw error;

  const next = advance(expense_date, rec.frequency, rec.day_of_month);
  await admin.from('recurring_expenses').update({
    next_run_date: next, last_run_at: new Date().toISOString(), exchange_rate: quote.rate,
  }).eq('id', rec.id);

  await admin.from('activity_log').insert({
    entity: 'expense', entity_id: data.id, action: 'recurring_expense_generated',
    detail: `${rec.title} → ${expense_date} @ ${currency} ${quote.rate} INR`, actor: 'system',
  });

  return data as { id: string; vendor_name: string; total_amount: number; currency: string };
}
