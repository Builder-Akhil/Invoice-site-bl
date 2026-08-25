import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDraftServer, type DraftInput } from './server-invoice';
import { generateExpenseFromRecurring, generateFromProfile } from './recurring';
import { setInvoicePaidStatus } from './invoice-status';
import { computeTotals, stateCodeFromGstin, stateNameByCode } from './gst';
import { splitExpenseTax } from './finance';
import { fetchInrRate } from './fx';
import {
  applyPayrollEdits, asComponents, asPayrollLines, computeLines, defaultPayComponents,
  previousPeriod, salaryExpensePayload, snapshotPayroll,
} from './payroll';
import { EXPENSE_CATEGORIES, type ChatCreated, type CompanyProfile, type Invoice, type InvoiceLine, type RecurringExpense, type RecurringProfile, type Client, type PayComponent, type TeamMember } from './types';
import { money, todayISO } from './format';
import { resolveLineSac } from './sac';

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
      + 'GST treatment, place of supply, IGST vs CGST+SGST and the invoice number are computed automatically — do not guess them. '
      + 'Set terms_label to a Net preset (omit due_date) or Custom with a calendar due_date. '
      + 'SAC on each line must come from the company SAC tag list, or omit code to auto-match.',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'UUID from the client list' },
        doc_type: { type: 'string', enum: ['invoice', 'quote'] },
        invoice_date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
        terms_label: {
          type: 'string',
          enum: ['Due on Receipt', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Custom'],
          description:
            'Payment terms. "Net 15" → due date is invoice date + 15 days. '
            + 'Use Custom only when the user names a calendar due date. Omit both to use the client default.',
        },
        due_date: {
          type: 'string',
          description:
            'YYYY-MM-DD. Send ONLY with terms_label Custom (user named a date). '
            + 'Omit for Net / Due on Receipt — the server adds those days to the invoice date.',
        },
        payment_terms_days: {
          type: 'number',
          description: 'Alternative to terms_label: 0 = Due on Receipt, 15 = Net 15, etc.',
        },
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
              code: {
                type: 'string',
                description:
                  'SAC from the company SAC list (998313 Advisory, 998314 IT design, 999293 Training, or a Settings tag). '
                  + 'Omit to auto-match from the line name.',
              },
              code_type: { type: 'string', enum: ['SAC', 'HSN'] },
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
        currency: { type: 'string', description: 'USD, EUR, etc. INR amount is converted at the closest rate on expense_date — never copy the dollar figure 1:1 into rupees.' },
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
  {
    name: 'create_team_member',
    description: 'Add a teammate with flexible pay lines (JSONB). Omit components to use the default contract template (basic, skill-gap cap, performance % of basic, client bonus % of basic).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        role: { type: 'string' },
        email: { type: 'string' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        basic: { type: 'number', description: 'Monthly basic in INR if using the default template. Default 50000.' },
        notes: { type: 'string' },
        currency: { type: 'string' },
        components: {
          type: 'array',
          description: 'Full pay-line list. If omitted, default template is used. Extra fields are kept.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              kind: { type: 'string', enum: ['fixed_monthly', 'percent_of_base', 'capped_amount', 'note'] },
              label: { type: 'string' },
              amount: { type: 'number' },
              pct: { type: 'number' },
              cap: { type: 'number' },
              enabled: { type: 'boolean' },
              conditions: { type: 'string' },
            },
            required: ['label', 'kind'],
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_team_member',
    description: 'Update a teammate (name, role, active flag, or replace their pay-line list). Identify by id or name.',
    input_schema: {
      type: 'object',
      properties: {
        member_id: { type: 'string' },
        name: { type: 'string', description: 'Current name, used to find them if member_id is omitted' },
        new_name: { type: 'string' },
        role: { type: 'string' },
        email: { type: 'string' },
        is_active: { type: 'boolean' },
        notes: { type: 'string' },
        basic: { type: 'number', description: 'If set, updates the `base` fixed_monthly amount on the current contract' },
        components: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              kind: { type: 'string' },
              label: { type: 'string' },
              amount: { type: 'number' },
              pct: { type: 'number' },
              cap: { type: 'number' },
              enabled: { type: 'boolean' },
              conditions: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'upsert_paycheck',
    description: 'Set scores / rupee amounts for a teammate’s work-month paycheck (period YYYY-MM). Creates a planned row if missing. Does not mark paid.',
    input_schema: {
      type: 'object',
      properties: {
        member_id: { type: 'string' },
        name: { type: 'string' },
        period: { type: 'string', description: 'Work month YYYY-MM. Defaults to the previous calendar month.' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'e.g. performance, client_bonus, skill_gap, base' },
              score: { type: 'number', description: '0–100 for percent_of_base lines' },
              value: { type: 'number', description: 'Rupees for capped_amount lines' },
            },
            required: ['key'],
          },
        },
      },
    },
  },
  {
    name: 'mark_payroll_paid',
    description: 'Mark a work-month paycheck paid and write a Salaries & Wages expense (no GST, no ITC). Identify by member id or name plus period.',
    input_schema: {
      type: 'object',
      properties: {
        member_id: { type: 'string' },
        name: { type: 'string' },
        period: { type: 'string', description: 'Work month YYYY-MM' },
      },
    },
  },
  {
    name: 'create_recurring_expense',
    description: 'Create a recurring vendor subscription (money out). Example: Cursor Pro monthly, ITC eligible. Distinct from retainers (invoices in).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        vendor: { type: 'string' },
        category: { type: 'string', enum: EXPENSE_CATEGORIES },
        frequency: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'yearly'] },
        taxable_amount: { type: 'number', description: 'Amount before GST, per cycle' },
        gst_rate: { type: 'number' },
        tax_split: { type: 'string', enum: ['igst', 'cgst_sgst', 'none'] },
        itc_eligible: { type: 'boolean' },
        next_run_date: { type: 'string' },
        day_of_month: { type: 'number' },
        currency: { type: 'string', description: 'USD/EUR/etc. Store the foreign amount; the portal converts to INR as of next_run_date. Do not invent a 1:1 rupee copy.' },
        notes: { type: 'string' },
      },
      required: ['title', 'taxable_amount'],
    },
  },
  {
    name: 'run_due_subscriptions',
    description: 'Log due recurring vendor expenses (same job the nightly cron runs for subscriptions).',
    input_schema: {
      type: 'object',
      properties: {
        expense_id: { type: 'string', description: 'Optional UUID — omit to run every due subscription' },
      },
    },
  },
  {
    name: 'set_cash_on_hand',
    description: 'Set the INR cash-on-hand figure used for runway. Never invent this — only call when the user states an amount. Set clear=true to unset so runway is not quoted.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'INR available' },
        clear: { type: 'boolean', description: 'If true, clears cash on hand (runway will not be quoted)' },
      },
    },
  },
];

export type ToolCreatedDraft = Awaited<ReturnType<typeof createDraftServer>> | null;

function parsePayComponents(raw: unknown, basic = 50000): PayComponent[] {
  if (!Array.isArray(raw) || raw.length === 0) return defaultPayComponents(basic);
  return asComponents(raw.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      ...r,
      key: String(r.key ?? `custom_${i}`),
      kind: String(r.kind ?? 'fixed_monthly'),
      label: String(r.label ?? 'Pay line'),
      enabled: r.enabled !== false,
    };
  }));
}

async function findMember(supabase: SupabaseClient, input: Record<string, unknown>): Promise<TeamMember> {
  const id = String(input.member_id ?? '').trim();
  const name = String(input.name ?? '').trim();
  if (id) {
    const { data, error } = await supabase.from('team_members').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No teammate with that id');
    return { ...data, components: asComponents(data.components) } as TeamMember;
  }
  if (!name) throw new Error('Need member_id or name');
  const { data, error } = await supabase.from('team_members').select('*');
  if (error) throw error;
  const rows = (data ?? []) as TeamMember[];
  const lower = name.toLowerCase();
  const hit = rows.find((m) => m.name.toLowerCase() === lower)
    ?? rows.find((m) => m.name.toLowerCase().includes(lower));
  if (!hit) throw new Error(`No teammate named ${name}`);
  return { ...hit, components: asComponents(hit.components) };
}

export async function executeAssistantTool(
  supabase: SupabaseClient,
  name: string,
  raw: unknown,
  company: CompanyProfile | null,
  actor?: string | null,
): Promise<{ result: unknown; draft?: ToolCreatedDraft; created?: ChatCreated }> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const today = todayISO();

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
    const expenseDate = String(input.expense_date || today);
    const fx = await fetchInrRate(currency, expenseDate);
    const { data, error } = await supabase.from('expenses').insert({
      vendor_name: input.vendor_name,
      expense_date: expenseDate,
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
      exchange_rate: fx.rate,
      payment_mode: input.payment_mode || 'bank_transfer',
      paid_by: input.paid_by ?? (input.payment_mode === 'reimbursement' ? actor ?? null : null),
    }).select('id, vendor_name, total_amount, currency, exchange_rate').single();
    if (error) throw error;
    return {
      result: data,
      created: {
        kind: 'expense',
        id: data.id,
        href: '/expenses',
        title: data.vendor_name,
        subtitle: currency === 'INR' ? 'Expense logged' : `Expense logged · ${currency}→INR ${fx.rate} as of ${fx.asOf}`,
        amount: money(Number(data.total_amount) * Number(data.exchange_rate || 1)),
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
      code_type: String(l.code_type ?? 'SAC'),
      code: resolveLineSac({
        name: String(l.name),
        description: l.description ? String(l.description) : null,
        code: l.code ? String(l.code) : null,
        codeType: l.code_type ? String(l.code_type) : 'SAC',
        fallback: company?.default_sac,
        codes: company?.sac_codes,
      }),
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

  if (name === 'create_team_member') {
    const basic = Number(input.basic ?? 50000);
    const components = parsePayComponents(input.components, basic);
    const { data, error } = await supabase.from('team_members').insert({
      name: String(input.name).trim(),
      role: input.role ?? null,
      email: input.email ?? null,
      start_date: input.start_date ?? null,
      notes: input.notes ?? null,
      currency: input.currency || 'INR',
      is_active: true,
      components,
    }).select('id, name, role').single();
    if (error) throw error;
    return {
      result: { ...data, components },
      created: { kind: 'team', id: data.id, href: '/team', title: data.name, subtitle: data.role || 'Teammate added' },
    };
  }

  if (name === 'update_team_member') {
    const member = await findMember(supabase, input);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.new_name) patch.name = String(input.new_name).trim();
    if (input.role !== undefined) patch.role = input.role;
    if (input.email !== undefined) patch.email = input.email;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.is_active !== undefined) patch.is_active = !!input.is_active;
    let components = member.components;
    if (Array.isArray(input.components) && input.components.length) {
      components = parsePayComponents(input.components);
      patch.components = components;
    } else if (input.basic !== undefined) {
      components = asComponents(member.components).map((c) =>
        c.key === 'base' && c.kind === 'fixed_monthly' ? { ...c, amount: Number(input.basic) } : c);
      patch.components = components;
    }
    const { data, error } = await supabase.from('team_members').update(patch).eq('id', member.id)
      .select('id, name, role, is_active').single();
    if (error) throw error;
    return {
      result: { ...data, components },
      created: { kind: 'team', id: data.id, href: '/team', title: data.name, subtitle: 'Teammate updated' },
    };
  }

  if (name === 'upsert_paycheck') {
    const member = await findMember(supabase, input);
    const period = String(input.period || previousPeriod());
    const edits = Array.isArray(input.lines)
      ? (input.lines as { key: string; score?: number; value?: number }[])
      : [];
    const { data: existing, error: exErr } = await supabase.from('payroll_items')
      .select('*').eq('team_member_id', member.id).eq('period', period).maybeSingle();
    if (exErr) throw exErr;
    if (existing && existing.status === 'paid') throw new Error(`${member.name} ${period} is already paid`);
    const baseLines = existing
      ? asPayrollLines(existing.lines)
      : snapshotPayroll(member.components, 'zero').lines;
    const { lines, total } = applyPayrollEdits(baseLines, edits);
    const payload = { team_member_id: member.id, period, lines, total, status: 'planned', updated_at: new Date().toISOString() };
    const q = existing?.id
      ? supabase.from('payroll_items').update(payload).eq('id', existing.id)
      : supabase.from('payroll_items').insert(payload);
    const { data, error } = await q.select('id, period, total, status').single();
    if (error) throw error;
    return {
      result: { ...data, member: member.name, lines },
      created: {
        kind: 'payroll', id: data.id, href: '/team', title: `${member.name} · ${period}`,
        subtitle: 'Paycheck scores saved', amount: money(Number(data.total), member.currency),
      },
    };
  }

  if (name === 'mark_payroll_paid') {
    const member = await findMember(supabase, input);
    const period = String(input.period || previousPeriod());
    const { data: item, error: itemErr } = await supabase.from('payroll_items')
      .select('*').eq('team_member_id', member.id).eq('period', period).maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) throw new Error(`No paycheck for ${member.name} in ${period} — score it first`);
    if (item.status === 'paid') throw new Error(`${member.name} ${period} is already paid`);
    const lines = asPayrollLines(item.lines);
    const { total } = computeLines(lines, 'entered');
    if (total <= 0) throw new Error('Total is zero — nothing to pay');
    const paidOn = today;
    const { data: exp, error: expErr } = await supabase.from('expenses').insert(
      salaryExpensePayload(member, { period, total }, paidOn),
    ).select('id').single();
    if (expErr || !exp) throw expErr ?? new Error('Could not write salary expense');
    const { data, error } = await supabase.from('payroll_items').update({
      total, status: 'paid', paid_on: paidOn, expense_id: exp.id, updated_at: new Date().toISOString(),
    }).eq('id', item.id).select('id, period, total, status, paid_on').single();
    if (error) throw error;
    return {
      result: { ...data, member: member.name, expense_id: exp.id },
      created: {
        kind: 'payroll', id: data.id, href: '/expenses', title: `${member.name} · ${period} paid`,
        subtitle: 'Salaries & Wages (no GST)', amount: money(Number(data.total), member.currency),
      },
    };
  }

  if (name === 'create_recurring_expense') {
    const split = String(input.tax_split ?? 'igst');
    const taxable = Number(input.taxable_amount) || 0;
    const tax = splitExpenseTax(taxable, Number(input.gst_rate ?? 18), split);
    const vendor = String(input.vendor ?? input.title);
    const start = String(input.next_run_date || today);
    const currency = String(input.currency || 'INR');
    const fx = await fetchInrRate(currency, start);
    const { data, error } = await supabase.from('recurring_expenses').insert({
      title: input.title,
      vendor,
      category: input.category || 'Software & Subscriptions',
      frequency: input.frequency || 'monthly',
      next_run_date: start,
      day_of_month: Number(input.day_of_month ?? 1),
      taxable_amount: taxable,
      gst_rate: tax.gst_rate,
      tax_split: split,
      itc_eligible: input.itc_eligible ?? split !== 'none',
      currency,
      exchange_rate: fx.rate,
      notes: input.notes ?? null,
      is_active: true,
    }).select('id, title, vendor, next_run_date, taxable_amount, frequency, currency, exchange_rate').single();
    if (error) throw error;
    const inr = Number(data.taxable_amount) * Number(data.exchange_rate || 1);
    return {
      result: data,
      created: {
        kind: 'subscription', id: data.id, href: '/recurring-expenses', title: data.title,
        subtitle: `${data.frequency} · next ${data.next_run_date}${currency === 'INR' ? '' : ` · ${currency}→INR ${fx.rate}`}`,
        amount: money(inr),
      },
    };
  }

  if (name === 'run_due_subscriptions') {
    const expenseId = input.expense_id ? String(input.expense_id) : undefined;
    let q = supabase.from('recurring_expenses').select('*').eq('is_active', true);
    q = expenseId ? q.eq('id', expenseId) : q.lte('next_run_date', today);
    const { data: recs, error } = await q;
    if (error) throw error;
    const logged: string[] = [];
    const failed: string[] = [];
    for (const rec of (recs ?? []) as RecurringExpense[]) {
      try {
        const exp = await generateExpenseFromRecurring(supabase, rec, expenseId ? today : undefined);
        logged.push(`${exp.vendor_name}`);
      } catch (e) {
        failed.push(`${rec.title}: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    return {
      result: { created: logged, failed, checked: recs?.length ?? 0 },
      created: logged.length ? {
        kind: 'subscription' as const, href: '/expenses', title: logged.join(', '),
        subtitle: 'Subscription expenses logged',
      } : undefined,
    };
  }

  if (name === 'set_cash_on_hand') {
    const amount = input.clear ? null : Number(input.amount);
    if (!input.clear && !Number.isFinite(amount)) throw new Error('Cash on hand must be a number in INR, or clear=true to unset it');
    const { data, error } = await supabase.from('company_profile').update({
      cash_on_hand: amount, updated_at: new Date().toISOString(),
    }).eq('id', 1).select('cash_on_hand').single();
    if (error) throw error;
    return {
      result: { cash_on_hand: data.cash_on_hand },
      created: {
        kind: 'cash', href: '/settings', title: amount === null ? 'Cash on hand cleared' : money(amount),
        subtitle: amount === null ? 'Runway will not be quoted until you set it' : 'Cash on hand updated',
      },
    };
  }

  throw new Error(`Unknown tool ${name}`);
}
