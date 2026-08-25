import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDraftServer, type DraftInput } from './server-invoice';
import { generateFromProfile } from './recurring';
import { setInvoicePaidStatus } from './invoice-status';
import { computeTotals, stateCodeFromGstin, stateNameByCode } from './gst';
import { EXPENSE_CATEGORIES, type ChatCreated, type CompanyProfile, type Invoice, type InvoiceLine, type RecurringProfile, type Client } from './types';
import { money } from './format';

export const assistantTools: Anthropic.Tool[] = [
  {
    name: 'create_client',
    description: 'Create a new client. Use ONLY when the requested company is not already in the client list.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
        contact_person: { type: 'string' },
        email: { type: 'string' },
        work_phone: { type: 'string' },
        gstin: { type: 'string', description: '15-character GSTIN. First two digits set the place of supply.' },
        gst_treatment: {
          type: 'string',
          enum: ['registered_business', 'unregistered_business', 'consumer', 'overseas', 'sez_with_payment', 'sez_without_payment', 'deemed_export'],
        },
        bill_line1: { type: 'string' }, bill_city: { type: 'string' },
        bill_state: { type: 'string' }, bill_pincode: { type: 'string' }, bill_country: { type: 'string' },
        currency: { type: 'string' }, payment_terms_days: { type: 'number' },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'create_draft_invoice',
    description:
      'Create a DRAFT invoice or quote for an existing client. Always use a client_id from the provided client list. '
      + 'GST treatment, place of supply, IGST vs CGST+SGST and the invoice number are computed automatically — do not guess them.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID from the client list' },
        doc_type: { type: 'string', enum: ['invoice', 'quote'] },
        invoice_date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
        due_date: { type: 'string', description: 'YYYY-MM-DD, defaults to client payment terms' },
        subject: { type: 'string' },
        notes: { type: 'string' },
        po_number: { type: 'string' },
        currency: { type: 'string' },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string', enum: ['qty', 'hour', 'day', 'month', 'project', 'user', 'sprint', 'license'] },
              rate: { type: 'number', description: 'Rate per unit, excluding GST' },
              gst_rate: { type: 'number', description: '0, 5, 12, 18 or 28' },
              code: { type: 'string', description: 'SAC or HSN code' },
              discount_pct: { type: 'number' },
            },
            required: ['name', 'rate'],
          },
        },
      },
      required: ['client_id', 'line_items'],
    },
  },
  {
    name: 'create_expense',
    description: 'Log an organisation expense (and optional input tax credit). Amounts are exclusive of GST unless tax_split is none.',
    input_schema: {
      type: 'object',
      properties: {
        vendor_name: { type: 'string' },
        expense_date: { type: 'string', description: 'YYYY-MM-DD' },
        category: { type: 'string', enum: EXPENSE_CATEGORIES },
        description: { type: 'string' },
        taxable_amount: { type: 'number', description: 'Amount before GST' },
        gst_rate: { type: 'number' },
        tax_split: { type: 'string', enum: ['igst', 'cgst_sgst', 'none'], description: 'igst for inter-state / most SaaS; cgst_sgst for same-state; none if no GST' },
        vendor_gstin: { type: 'string' },
        bill_number: { type: 'string' },
        itc_eligible: { type: 'boolean' },
        currency: { type: 'string' },
        payment_mode: {
          type: 'string',
          enum: ['bank_transfer', 'upi', 'wire', 'cheque', 'card', 'cash', 'reimbursement', 'other'],
          description: 'reimbursement = founder/staff paid personally and LLP repaid the same amount',
        },
        paid_by: { type: 'string', description: 'Name of the person reimbursed, if payment_mode is reimbursement' },
      },
      required: ['vendor_name', 'taxable_amount'],
    },
  },
  {
    name: 'create_gst_payment',
    description:
      'Record a GST payment (cash paid to the department) or credit utilisation (ITC offset) for a return period. '
      + 'Use itc_utilised for credit ledger offset. Period like 2026-08 (monthly) or 2026-Q1 (quarterly).',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: '2026-08 or 2026-Q1' },
        period_type: { type: 'string', enum: ['monthly', 'quarterly'] },
        return_type: { type: 'string', enum: ['GSTR-3B', 'GSTR-1', 'GSTR-9', 'DRC-03', 'CMP-08'] },
        paid_on: { type: 'string' },
        filed_on: { type: 'string' },
        igst_paid: { type: 'number' },
        cgst_paid: { type: 'number' },
        sgst_paid: { type: 'number' },
        itc_utilised: { type: 'number', description: 'ITC credit offset from the credit ledger' },
        interest: { type: 'number' },
        late_fee: { type: 'number' },
        challan_no: { type: 'string' },
        arn: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'paid', 'filed'] },
      },
      required: ['period'],
    },
  },
  {
    name: 'create_retainer',
    description: 'Create a recurring retainer that generates draft invoices on a schedule (and feeds MRR).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        client_id: { type: 'string' },
        frequency: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'yearly'] },
        start_date: { type: 'string' },
        next_run_date: { type: 'string', description: 'First invoice date, YYYY-MM-DD' },
        day_of_month: { type: 'number' },
        due_days: { type: 'number' },
        subject: { type: 'string' },
        notes: { type: 'string' },
        currency: { type: 'string' },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              quantity: { type: 'number' },
              rate: { type: 'number' },
              unit: { type: 'string' },
              gst_rate: { type: 'number' },
              code: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['name', 'rate'],
          },
        },
      },
      required: ['title', 'client_id', 'line_items'],
    },
  },
  {
    name: 'run_due_retainers',
    description: 'Generate draft invoices for retainers that are due today (or a specific retainer by id). Same job the nightly cron runs.',
    input_schema: {
      type: 'object',
      properties: {
        retainer_id: { type: 'string', description: 'Optional UUID — omit to run every due retainer' },
      },
    },
  },
  {
    name: 'set_invoice_paid',
    description: 'Mark an existing invoice Paid or Unpaid. Use when a payment was missed, stuck, or recorded by mistake.',
    input_schema: {
      type: 'object',
      properties: {
        invoice_number: { type: 'string' },
        paid: { type: 'boolean' },
      },
      required: ['invoice_number', 'paid'],
    },
  },
];

export type ToolCreatedDraft = Awaited<ReturnType<typeof createDraftServer>> | null;

export async function executeAssistantTool(
  supabase: SupabaseClient,
  name: string,
  raw: unknown,
  company: CompanyProfile | null,
  actor?: string | null,
): Promise<{ result: unknown; draft?: ToolCreatedDraft; created?: ChatCreated }> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);

  if (name === 'create_client') {
    const gstin = String(input.gstin ?? '');
    const code = gstin.length >= 2 ? gstin.slice(0, 2) : stateCodeFromGstin(gstin);
    const { data, error } = await supabase.from('clients').insert({
      company_name: input.company_name,
      contact_person: input.contact_person ?? null,
      email: input.email ?? null,
      work_phone: input.work_phone ?? null,
      gstin: gstin || null,
      gst_treatment: input.gst_treatment || 'unregistered_business',
      bill_line1: input.bill_line1 ?? null,
      bill_city: input.bill_city ?? null,
      bill_state: input.bill_state ?? null,
      bill_pincode: input.bill_pincode ?? null,
      bill_country: input.bill_country ?? 'India',
      currency: input.currency || 'INR',
      payment_terms_days: Number(input.payment_terms_days ?? 7),
      place_of_supply_code: code || undefined,
      place_of_supply_state: stateNameByCode(code) || undefined,
      is_overseas: input.gst_treatment === 'overseas',
    }).select('id, company_name').single();
    if (error) throw error;
    return {
      result: data,
      created: { kind: 'client', id: data.id, href: '/clients', title: data.company_name, subtitle: 'Client created' },
    };
  }

  if (name === 'create_draft_invoice') {
    const draft = await createDraftServer(supabase, input as unknown as DraftInput, company);
    return {
      result: draft,
      draft,
      created: {
        kind: 'invoice',
        id: draft.id,
        href: `/invoices/${draft.id}`,
        title: draft.invoice_number,
        subtitle: draft.client_name,
        amount: money(draft.total, draft.currency),
        invoice_number: draft.invoice_number,
        total: draft.total,
        currency: draft.currency,
        client_name: draft.client_name,
      },
    };
  }

  if (name === 'create_expense') {
    const taxable = Number(input.taxable_amount) || 0;
    const split = String(input.tax_split ?? 'igst');
    const rate = split === 'none' ? 0 : Number(input.gst_rate ?? 18);
    const igst = split === 'igst' ? +(taxable * rate / 100).toFixed(2) : 0;
    const half = split === 'cgst_sgst' ? +(taxable * rate / 200).toFixed(2) : 0;
    const total = +(taxable + igst + half * 2).toFixed(2);
    const currency = String(input.currency || 'INR');
    const { data, error } = await supabase.from('expenses').insert({
      vendor_name: input.vendor_name,
      expense_date: input.expense_date || today,
      category: input.category || 'Software & Subscriptions',
      description: input.description ?? null,
      vendor_gstin: input.vendor_gstin ?? null,
      bill_number: input.bill_number ?? null,
      taxable_amount: taxable,
      gst_rate: rate,
      cgst_amount: half,
      sgst_amount: half,
      igst_amount: igst,
      total_amount: total,
      itc_eligible: input.itc_eligible ?? split !== 'none',
      currency,
      payment_mode: input.payment_mode || 'bank_transfer',
      paid_by: input.paid_by ?? (input.payment_mode === 'reimbursement' ? actor ?? null : null),
    }).select('id, vendor_name, total_amount, currency').single();
    if (error) throw error;
    return {
      result: data,
      created: {
        kind: 'expense',
        id: data.id,
        href: '/expenses',
        title: data.vendor_name,
        subtitle: 'Expense logged',
        amount: money(Number(data.total_amount), data.currency),
      },
    };
  }

  if (name === 'create_gst_payment') {
    const igst = Number(input.igst_paid ?? 0);
    const cgst = Number(input.cgst_paid ?? 0);
    const sgst = Number(input.sgst_paid ?? 0);
    const interest = Number(input.interest ?? 0);
    const late_fee = Number(input.late_fee ?? 0);
    const payload = {
      period: String(input.period),
      period_type: input.period_type === 'quarterly' ? 'quarterly' : 'monthly',
      return_type: String(input.return_type ?? 'GSTR-3B'),
      paid_on: input.paid_on || today,
      filed_on: input.filed_on || null,
      igst_paid: igst, cgst_paid: cgst, sgst_paid: sgst,
      itc_utilised: Number(input.itc_utilised ?? 0),
      interest, late_fee,
      total_paid: +(igst + cgst + sgst + interest + late_fee).toFixed(2),
      challan_no: input.challan_no ?? null,
      arn: input.arn ?? null,
      notes: input.notes ?? null,
      status: String(input.status ?? 'paid'),
    };
    const { data: existing } = await supabase.from('gst_payments')
      .select('id').eq('period', payload.period).eq('return_type', payload.return_type).maybeSingle();
    const q = existing?.id
      ? supabase.from('gst_payments').update(payload).eq('id', existing.id)
      : supabase.from('gst_payments').insert(payload);
    const { data, error } = await q.select('id, period, return_type, total_paid, itc_utilised').single();
    if (error) throw error;
    return {
      result: data,
      created: {
        kind: 'gst',
        id: data.id,
        href: '/gst',
        title: `${data.return_type} ${data.period}`,
        subtitle: Number(data.itc_utilised) > 0 ? `ITC credit ${money(Number(data.itc_utilised))}` : 'GST payment recorded',
        amount: money(Number(data.total_paid)),
      },
    };
  }

  if (name === 'create_retainer') {
    const lines = (input.line_items as Record<string, unknown>[]).map((l, i) => ({
      position: i,
      name: String(l.name),
      description: l.description ? String(l.description) : null,
      code_type: 'SAC',
      code: l.code ? String(l.code) : (company?.default_sac ?? '999293'),
      unit: String(l.unit ?? 'month'),
      quantity: Number(l.quantity ?? 1),
      rate: Number(l.rate ?? 0),
      discount_pct: 0,
      gst_rate: Number(l.gst_rate ?? 18),
      taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
      cess_rate: 0, cess_amount: 0, line_total: 0,
    })) as InvoiceLine[];
    const amount = computeTotals(lines, 'inter', { roundOff: true }).total;
    const start = String(input.start_date || today);
    const { data, error } = await supabase.from('recurring_profiles').insert({
      title: input.title,
      client_id: input.client_id,
      frequency: input.frequency || 'monthly',
      start_date: start,
      next_run_date: input.next_run_date || start,
      day_of_month: Number(input.day_of_month ?? 1),
      due_days: Number(input.due_days ?? 7),
      subject: input.subject ?? null,
      notes: input.notes ?? null,
      currency: input.currency || 'INR',
      line_items: lines,
      amount,
      is_active: true,
    }).select('id, title, next_run_date, amount, frequency').single();
    if (error) throw error;
    return {
      result: data,
      created: {
        kind: 'retainer',
        id: data.id,
        href: '/recurring',
        title: data.title,
        subtitle: `${data.frequency} · next ${data.next_run_date}`,
        amount: money(Number(data.amount)),
      },
    };
  }

  if (name === 'run_due_retainers') {
    const retainerId = input.retainer_id ? String(input.retainer_id) : undefined;
    let q = supabase.from('recurring_profiles').select('*, clients(*)').eq('is_active', true);
    q = retainerId ? q.eq('id', retainerId) : q.lte('next_run_date', today);
    const { data: profiles, error } = await q;
    if (error) throw error;
    const invoiceNumbers: string[] = [];
    const failed: string[] = [];
    for (const p of (profiles ?? []) as (RecurringProfile & { clients: Client })[]) {
      if (p.end_date && p.end_date < today) continue;
      try {
        const inv = await generateFromProfile(supabase, p, company, retainerId ? today : undefined);
        invoiceNumbers.push(inv.invoice_number);
      } catch (e) {
        failed.push(`${p.title}: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    return {
      result: { created: invoiceNumbers, failed, checked: profiles?.length ?? 0 },
      created: invoiceNumbers.length ? {
        kind: 'invoice' as const,
        href: '/invoices',
        title: invoiceNumbers.join(', '),
        subtitle: 'Retainer drafts generated',
      } : undefined,
    };
  }

  if (name === 'set_invoice_paid') {
    const number = String(input.invoice_number ?? '').trim();
    const { data: inv, error } = await supabase.from('invoices').select('*').eq('invoice_number', number).maybeSingle();
    if (error) throw error;
    if (!inv) throw new Error(`No invoice numbered ${number}`);
    const updated = await setInvoicePaidStatus(supabase, inv as Invoice, !!input.paid, actor);
    return {
      result: { invoice_number: updated.invoice_number, status: updated.status, balance_due: updated.balance_due },
      created: {
        kind: 'status',
        id: updated.id,
        href: `/invoices/${updated.id}`,
        title: updated.invoice_number,
        subtitle: updated.status === 'paid' ? 'Marked paid' : 'Marked unpaid',
      },
    };
  }

  throw new Error(`Unknown tool ${name}`);
}
