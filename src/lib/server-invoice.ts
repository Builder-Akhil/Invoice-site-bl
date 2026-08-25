import type { SupabaseClient } from '@supabase/supabase-js';
import { computeTotals, defaultPlaceOfSupply, resolveTaxMode, supplierState } from './gst';
import { todayISO } from './format';
import { resolveLineSac } from './sac';
import { resolveInvoiceTerms } from './terms';
import type { Client, CompanyProfile, InvoiceLine, TaxMode } from './types';

export interface DraftLineInput {
  name: string; description?: string; quantity?: number; unit?: string;
  rate: number; gst_rate?: number; code?: string; code_type?: string; discount_pct?: number;
}

export interface DraftInput {
  client_id: string;
  doc_type?: 'invoice' | 'quote';
  invoice_date?: string;
  due_date?: string;
  terms_label?: string;
  payment_terms_days?: number;
  subject?: string;
  notes?: string;
  terms?: string;
  po_number?: string;
  currency?: string;
  exchange_rate?: number;
  line_items: DraftLineInput[];
}

/** Creates a draft invoice/quote server-side with correct GST treatment. */
export async function createDraftServer(
  supabase: SupabaseClient, input: DraftInput, company: CompanyProfile | null,
) {
  const { data: client } = await supabase.from('clients').select('*').eq('id', input.client_id).single();
  if (!client) throw new Error('Client not found');
  const c = client as Client;

  const docType = input.doc_type ?? 'invoice';
  const invoice_date = input.invoice_date ?? todayISO();
  const pos = defaultPlaceOfSupply(c);
  const mode: TaxMode = resolveTaxMode(supplierState(company).code, c.gst_treatment, pos.code);

  const fallbackSac = c.default_sac ?? company?.default_sac ?? null;
  const lines: InvoiceLine[] = input.line_items.map((l, i) => ({
    position: i, name: l.name, description: l.description ?? null,
    code_type: l.code_type ?? 'SAC',
    code: resolveLineSac({
      name: l.name, description: l.description, code: l.code, codeType: l.code_type,
      fallback: fallbackSac, codes: company?.sac_codes,
    }),
    unit: l.unit ?? 'qty', quantity: Number(l.quantity ?? 1), rate: Number(l.rate ?? 0),
    discount_pct: Number(l.discount_pct ?? 0), taxable_value: 0,
    gst_rate: Number(l.gst_rate ?? c.default_gst_rate ?? company?.default_gst_rate ?? 18),
    cgst_amount: 0, sgst_amount: 0, igst_amount: 0, cess_rate: 0, cess_amount: 0, line_total: 0,
  }));

  const t = computeTotals(lines, mode, {
    roundOff: true, tdsApplicable: c.tds_applicable, tdsRate: Number(c.tds_rate ?? 10),
  });

  const { data: number, error: numErr } = await supabase.rpc('next_document_number', { p_doc_type: docType });
  if (numErr) throw numErr;

  const { data: inv, error } = await supabase.from('invoices').insert({
    doc_type: docType, invoice_number: number as string,
    client_id: c.id, client_snapshot: c,
    invoice_date,
    ...resolveInvoiceTerms({
      invoiceDate: invoice_date,
      dueDate: input.due_date,
      termsLabel: input.terms_label
        ?? (input.payment_terms_days != null ? `Net ${input.payment_terms_days}` : undefined),
      paymentTermsDays: input.payment_terms_days ?? c.payment_terms_days,
      defaultDueDays: company?.default_due_days ?? 7,
    }),
    subject: input.subject ?? null,
    place_of_supply: pos.name, place_of_supply_code: pos.code,
    tax_mode: mode,
    currency: input.currency ?? c.currency ?? 'INR',
    exchange_rate: Number(input.exchange_rate ?? 1),
    status: 'draft',
    subtotal: t.subtotal, discount_total: t.discount_total,
    cgst_total: t.cgst_total, sgst_total: t.sgst_total, igst_total: t.igst_total,
    cess_total: t.cess_total, tax_total: t.tax_total, round_off: t.round_off,
    total: t.total, balance_due: t.total,
    tds_applicable: c.tds_applicable, tds_section: c.tds_section, tds_rate: c.tds_rate ?? 0, tds_amount: t.tds_amount,
    notes: input.notes ?? company?.default_notes ?? null,
    terms: input.terms ?? company?.default_terms ?? null,
    po_number: input.po_number ?? null,
    lut_number: mode === 'export_lut' ? company?.lut_number ?? null : null,
  }).select('id, invoice_number, total, currency').single();
  if (error) throw error;

  const rows = lines.map((l, i) => {
    const cc = computeTotals([l], mode, { roundOff: false });
    return {
      invoice_id: inv.id, position: i, name: l.name, description: l.description,
      code_type: l.code_type, code: l.code, unit: l.unit, quantity: l.quantity, rate: l.rate,
      discount_pct: l.discount_pct, taxable_value: cc.subtotal, gst_rate: l.gst_rate,
      cgst_amount: cc.cgst_total, sgst_amount: cc.sgst_total, igst_amount: cc.igst_total,
      cess_rate: 0, cess_amount: 0, line_total: Number((cc.subtotal + cc.tax_total).toFixed(2)),
    };
  });
  const { error: liErr } = await supabase.from('invoice_items').insert(rows);
  if (liErr) throw liErr;

  return {
    id: inv.id as string, invoice_number: inv.invoice_number as string,
    total: Number(inv.total), currency: inv.currency as string,
    tax_mode: mode, place_of_supply: pos.name, client_name: c.company_name,
  };
}
