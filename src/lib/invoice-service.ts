'use client';
import { sb } from './supabase/client';
import { computeTotals } from './gst';
import type { DocType, Invoice, InvoiceLine, TaxMode } from './types';

export const emptyLine = (position = 0, defaults?: Partial<InvoiceLine>): InvoiceLine => ({
  position, name: '', description: '', code_type: 'SAC', code: defaults?.code ?? '',
  unit: 'qty', quantity: 1, rate: 0, discount_pct: 0, taxable_value: 0,
  gst_rate: defaults?.gst_rate ?? 18, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
  cess_rate: 0, cess_amount: 0, line_total: 0, ...defaults,
});

export async function peekNumber(docType: DocType) {
  const { data } = await sb().rpc('peek_document_number', { p_doc_type: docType });
  return (data as string) ?? '';
}

export async function consumeNumber(docType: DocType) {
  const { data, error } = await sb().rpc('next_document_number', { p_doc_type: docType });
  if (error) throw error;
  return data as string;
}

export interface SaveArgs {
  id?: string | null;
  header: Partial<Invoice>;
  lines: InvoiceLine[];
  autoNumber: boolean;
  roundOff: boolean;
}

/** Persists header + line items, recomputing every tax figure server-side of the UI. */
export async function saveInvoice({ id, header, lines, autoNumber, roundOff }: SaveArgs) {
  const mode = (header.tax_mode ?? 'inter') as TaxMode;
  const clean = lines.filter((l) => (l.name ?? '').trim() || Number(l.rate) || Number(l.quantity) > 1);
  if (clean.length === 0) throw new Error('Add at least one line item');

  const t = computeTotals(clean, mode, {
    roundOff,
    tdsApplicable: !!header.tds_applicable,
    tdsRate: Number(header.tds_rate ?? 10),
  });

  let invoice_number = header.invoice_number ?? '';
  if (!id && autoNumber) invoice_number = await consumeNumber((header.doc_type ?? 'invoice') as DocType);
  if (!invoice_number.trim()) throw new Error('Invoice number is required');

  const payload: Record<string, unknown> = {
    doc_type: header.doc_type ?? 'invoice',
    invoice_number: invoice_number.trim(),
    client_id: header.client_id,
    client_snapshot: header.client_snapshot ?? null,
    invoice_date: header.invoice_date,
    due_date: header.due_date || null,
    terms_label: header.terms_label,
    subject: header.subject,
    place_of_supply: header.place_of_supply,
    place_of_supply_code: header.place_of_supply_code,
    tax_mode: mode,
    reverse_charge: !!header.reverse_charge,
    lut_number: header.lut_number || null,
    currency: header.currency ?? 'INR',
    exchange_rate: Number(header.exchange_rate) || 1,
    status: header.status ?? 'draft',
    subtotal: t.subtotal, discount_total: t.discount_total,
    cgst_total: t.cgst_total, sgst_total: t.sgst_total, igst_total: t.igst_total,
    cess_total: t.cess_total, tax_total: t.tax_total, round_off: t.round_off, total: t.total,
    tds_applicable: !!header.tds_applicable, tds_section: header.tds_section ?? null,
    tds_rate: Number(header.tds_rate ?? 0), tds_amount: t.tds_amount,
    notes: header.notes, terms: header.terms, internal_notes: header.internal_notes,
    po_number: header.po_number ?? null,
    updated_at: new Date().toISOString(),
  };

  let invoiceId = id;
  if (id) {
    const { error } = await sb().from('invoices').update(payload).eq('id', id);
    if (error) throw error;
    await sb().from('invoice_items').delete().eq('invoice_id', id);
  } else {
    payload.balance_due = t.total;
    const { data, error } = await sb().from('invoices').insert(payload).select('id').single();
    if (error) throw error;
    invoiceId = data.id as string;
  }

  const rows = clean.map((l, i) => {
    const c = computeTotals([l], mode, { roundOff: false });
    return {
      invoice_id: invoiceId, position: i, item_id: l.item_id ?? null,
      name: l.name || 'Item', description: l.description ?? null,
      code_type: l.code_type ?? 'SAC', code: l.code ?? null, unit: l.unit ?? 'qty',
      quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0,
      discount_pct: Number(l.discount_pct) || 0,
      taxable_value: c.subtotal, gst_rate: Number(l.gst_rate) || 0,
      cgst_amount: c.cgst_total, sgst_amount: c.sgst_total, igst_amount: c.igst_total,
      cess_rate: Number(l.cess_rate) || 0, cess_amount: c.cess_total,
      line_total: Number((c.subtotal + c.tax_total).toFixed(2)),
    };
  });
  const { error: liErr } = await sb().from('invoice_items').insert(rows);
  if (liErr) throw liErr;

  if (id) await sb().rpc('recalc_invoice_payment', { p_invoice: id });
  return invoiceId as string;
}

export async function loadInvoice(id: string) {
  const { data, error } = await sb()
    .from('invoices')
    .select('*, invoice_items(*), clients(*)')
    .eq('id', id).single();
  if (error) throw error;
  const inv = data as unknown as Invoice;
  inv.invoice_items = (inv.invoice_items ?? []).sort((a, b) => a.position - b.position);
  return inv;
}

export async function logActivity(entity: string, entity_id: string, action: string, detail?: string) {
  const { data } = await sb().auth.getUser();
  await sb().from('activity_log').insert({ entity, entity_id, action, detail, actor: data.user?.email ?? null });
}
