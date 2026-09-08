import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveProviders } from './resolve';
import { ProviderError, type AiMessage, type AiTurn } from './provider';
import { overLimitMessage, type InvoiceAllowance } from '../plan';
import { assistantTools, executeAssistantTool } from '../assistant-tools';
import { booksSnapshot } from '../finance';
import { asComponents, asPayrollLines, previousPeriod } from '../payroll';
import { financialYear, todayISO } from '../format';
import { resolveSacCodes, sacOptionLabel } from '../sac';
import type { CompanyProfile, Expense, Invoice, PayrollItem, RecurringExpense, TeamMember } from '../types';

/**
 * The assistant turn, independent of how the message arrived.
 *
 * Extracted from /api/chat so the WhatsApp and Telegram webhooks run exactly
 * the same brain, tools and guardrails. The caller owns authentication and the
 * plan check; this function owns the conversation, the provider chain and the
 * tool loop.
 */

const tools = assistantTools;

export type AssistantImage = { media_type: string; data: string };

export type AssistantInput = {
  /** Service-role or session client. Must already be authorised by the caller. */
  supabase: SupabaseClient;
  /** Owner of the conversation row. Channel messages use the workspace owner. */
  userId: string;
  userEmail?: string | null;
  message: string;
  images?: AssistantImage[];
  conversationId?: string | null;
  /** Prior turns, used only when the conversation has no stored history yet. */
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** Already-computed allowance, so the caller can decide whether to even ask. */
  allowance: InvoiceAllowance;
  /** Prefix for a conversation created by this turn, e.g. "WhatsApp". */
  channelLabel?: string;
};

export type AssistantResult = {
  reply: string;
  created: NonNullable<Awaited<ReturnType<typeof executeAssistantTool>>['created']>[];
  draft: Awaited<ReturnType<typeof executeAssistantTool>>['draft'];
  conversationId: string;
  engine: { provider: string; label: string; model: string; key: 'byo' | 'platform' };
  notice: string | null;
};

/** Thrown when no provider can serve the request — the caller renders it. */
export class AssistantUnavailable extends Error {}

export async function runAssistant(input: AssistantInput): Promise<AssistantResult> {
  const { supabase, userId, userEmail, allowance } = input;
  const message = input.message.trim();
  const images = input.images ?? [];
  const history = input.history ?? [];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const { data: owned } = await supabase.from('conversations').select('id')
      .eq('id', conversationId).eq('user_id', userId).maybeSingle();
    if (!owned) conversationId = null;
  }
  if (!conversationId) {
    const stem = (message || 'Image chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
    const title = input.channelLabel ? `${input.channelLabel} · ${stem}` : stem;
    const { data: conv, error: convErr } = await supabase.from('conversations')
      .insert({ user_id: userId, title }).select('id').single();
    if (convErr) throw convErr;
    conversationId = conv.id as string;
  }

  const { error: userMsgErr } = await supabase.from('conversation_messages').insert({
    conversation_id: conversationId,
    role: 'user',
    content: message,
    attachments: images,
  });
  if (userMsgErr) throw userMsgErr;
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

  const fy = financialYear();
  const workMonth = previousPeriod();
  const [{ data: clients }, { data: items }, { data: companyRow }, { data: invoices }, { data: retainers },
    { data: memberRows }, { data: payrollRows }, { data: recExpRows }, { data: expenseRows }, { data: bookInvoices }] = await Promise.all([
    supabase.from('clients').select('id, company_name, contact_person, email, gstin, gst_treatment, place_of_supply_state, currency, payment_terms_days, default_sac, default_gst_rate').eq('status', 'active'),
    supabase.from('items').select('name, description, code, code_type, unit, rate, gst_rate').eq('is_active', true),
    supabase.from('company_profile').select('*').eq('id', 1).single(),
    supabase.from('invoices').select('id, invoice_number, status, total, currency, balance_due, client_id').eq('doc_type', 'invoice').order('invoice_date', { ascending: false }).limit(40),
    supabase.from('recurring_profiles').select('id, title, client_id, frequency, next_run_date, amount, is_active').order('next_run_date'),
    supabase.from('team_members').select('*').order('name'),
    supabase.from('payroll_items').select('*').eq('period', workMonth),
    supabase.from('recurring_expenses').select('*').order('next_run_date'),
    supabase.from('expenses').select('expense_date, taxable_amount, cgst_amount, sgst_amount, igst_amount, itc_eligible, exchange_rate, category'),
    supabase.from('invoices').select('invoice_date, status, subtotal, cgst_total, sgst_total, igst_total, exchange_rate, tds_applicable, tds_amount').eq('doc_type', 'invoice'),
  ]);
  const company = (companyRow ?? null) as CompanyProfile | null;
  const sacCodes = resolveSacCodes(company?.sac_codes);
  const members = ((memberRows ?? []) as TeamMember[]).map((m) => ({ ...m, components: asComponents(m.components) }));
  const payroll = ((payrollRows ?? []) as PayrollItem[]).map((p) => ({ ...p, lines: asPayrollLines(p.lines) }));
  const subscriptions = (recExpRows ?? []) as RecurringExpense[];
  const books = booksSnapshot({
    invoices: (bookInvoices ?? []) as Invoice[],
    expenses: (expenseRows ?? []) as Expense[],
    members,
    subscriptions,
    cashOnHand: company?.cash_on_hand,
    fyStart: fy.start,
    fyEnd: fy.end,
  });
  const { runway } = books;
  const runwayLine = runway.missingCash
    ? 'CASH_ON_HAND is not set. Do NOT invent a cash figure or a runway. Ask them to set it in Settings or via set_cash_on_hand.'
    : runway.months == null
      ? `Cash on hand: ${company?.cash_on_hand}. Monthly burn is ${books.runway.monthlyBurn} (recipe below). Burn is zero or missing — no runway date.`
      : `Cash on hand: ${company?.cash_on_hand} INR. Runway: ${runway.months.toFixed(1)} months, until ${runway.date}.`;

  const system = `You are the billing assistant inside ${company?.legal_name ?? 'this'} invoicing portal.
Today is ${todayISO()}. Supplier state: ${company?.state ?? 'Telangana'} (${company?.state_code ?? '36'}). Default currency INR.

You can: create clients, draft invoices/quotes, log expenses, record GST payments or ITC credits, create retainers, run due retainers, mark invoices paid/unpaid, add/update teammates and pay lines, score a work-month paycheck, mark payroll paid (writes a salary expense), create recurring vendor subscriptions, run due subscriptions, and set cash on hand.

CRITICAL — tools:
- If the user asks to create, log, add, record, mark, or generate anything, you MUST call the matching tool. Never reply "Done." or claim you created a record unless a tool returned success.
- You CAN see attached images (receipts, screenshots, challans). Never say an image did not come through when an image block is in the message. Read the figures and act.
- Be decisive: if amount + vendor (or client + service) are visible in text or image, call the tool. Only ask a question when a required figure is truly missing.

Rules:
- Match the client by name against the CLIENTS list (case-insensitive, partial matches are fine). Use its exact id.
- Only call create_client when the company genuinely is not in the list.
- Indian shorthand: "2.5L"/"2.5 lakh" = 250000, "1cr" = 10000000, "50k" = 50000.
- Invoice rates are ALWAYS exclusive of GST. If the user gives an inclusive figure, back it out and say so.
- Default gst_rate 18 unless told otherwise. Pull rates from the SERVICES catalog when the item matches.
- SAC: pick a code from SAC_CODES by the work described, not from a stale catalog default. Advisory / consulting / CTO / strategy → 998313 (Advisory). Apps, websites, software, engineering, design & development → 998314 (IT design). Training / coaching / workshops → 999293 (Training). Extra Settings tags work the same way. If unsure, omit code — the server matches from the line name. Never invent a SAC that is not on the list.
- TERMS on create_draft_invoice:
- User says Net 7 / 15 / 30 / 45 / 60 or Due on Receipt → set terms_label to that exact preset and OMIT due_date. Due is invoice date (today unless they named another invoice date) plus those days.
- User names a calendar due date → terms_label Custom and due_date YYYY-MM-DD. Do not also send a Net preset.
- Mention neither → omit terms_label and due_date (client payment terms).
- Never invent GSTINs, invoice numbers or tax splits — the system computes those.
- Expenses: default tax_split igst (most SaaS). Same-state India vendors → cgst_sgst. itc_eligible true unless told otherwise.
- Travel / Airbnb / hotels / flights / foreign platforms with no Indian GSTIN: category Travel, tax_split none, itc_eligible false.
- If the founder paid personally and the LLP transferred the same amount to their savings (or reimbursed them): payment_mode reimbursement. That is an LLP business expense, not a loan or drawing.
- GST remitted to the Government is only on invoices whose payment has been received. Cash leaves the LLP account. Unpaid invoices are not this month's GST payment.
- GST credits = itc_utilised on create_gst_payment. Cash to the department = igst_paid / cgst_paid / sgst_paid.
- Team: the month picker is the WORK month. Pay is released the first week of the following month. Planned pay is not an expense until mark_payroll_paid.
- Subscriptions (create_recurring_expense) are money OUT. Retainers are invoices IN. Do not mix them.
- Foreign-currency spend: never copy $125 as ₹125. The portal stores the dollar amount and converts to INR at the closest published rate on the bill / next-run date. Paused subscriptions (is_active false) are skipped by cron and excluded from run-rate.
- Cash / runway: NEVER invent cash on hand. ${runwayLine}
- When quoting runway, give months AND a calendar date, and name the burn recipe: typical full-kit payroll (${books.typicalPayroll}) + monthly subscription run-rate (${books.subscriptionRunRate}) + trailing 3-month average GST due (${books.gstAvg3m}) = ${books.runway.monthlyBurn}/month.
- After a successful tool, reply in one or two short sentences: what was created, the amount, and where to review it. No preamble, no markdown headings.

CLIENTS:
${JSON.stringify(clients ?? [])}

SAC_CODES (tagged list from Settings; use these on every service line):
${JSON.stringify(sacCodes.map((s) => ({ code: s.code, tag: s.tag, label: s.label, pick: sacOptionLabel(s) })))}

SERVICES CATALOG:
${JSON.stringify(items ?? [])}

RECENT INVOICES:
${JSON.stringify(invoices ?? [])}

RETAINERS:
${JSON.stringify(retainers ?? [])}

TEAM (contracts):
${JSON.stringify(members.map((m) => ({ id: m.id, name: m.name, role: m.role, is_active: m.is_active, currency: m.currency, components: m.components })))}

PAYROLL WORK MONTH ${workMonth} (planned vs paid):
${JSON.stringify(payroll.map((p) => ({ id: p.id, team_member_id: p.team_member_id, period: p.period, total: p.total, status: p.status, paid_on: p.paid_on, lines: p.lines })))}

RECURRING SPEND (subscriptions):
${JSON.stringify(subscriptions.map((s) => ({ id: s.id, title: s.title, vendor: s.vendor, frequency: s.frequency, taxable_amount: s.taxable_amount, gst_rate: s.gst_rate, tax_split: s.tax_split, itc_eligible: s.itc_eligible, next_run_date: s.next_run_date, is_active: s.is_active, currency: s.currency, exchange_rate: s.exchange_rate })))}

BOOKS ${fy.label}:
${JSON.stringify({
fy_billed_ex_gst: books.billed,
fy_expense_taxable_ex_gst: books.expenseTaxable,
fy_net_after_expenses_ex_gst: books.netAfterExpenses,
gst_due_this_month: books.gstThisMonth,
typical_team_burn: books.typicalPayroll,
subscription_run_rate: books.subscriptionRunRate,
gst_avg_3m: books.gstAvg3m,
cash_on_hand: company?.cash_on_hand ?? null,
runway_months: runway.months,
runway_date: runway.date,
monthly_burn: runway.monthlyBurn,
burn_recipe: runway.recipe,
})}
`;

  // integration_settings is service-role-only (it holds encrypted keys), so
  // this one read escalates after the session check at the top of the handler.
  const { chain, problem } = await resolveProviders(supabase, { needsVision: images.length > 0 });
  if (problem) throw new AssistantUnavailable(problem);

  const { data: stored } = await supabase.from('conversation_messages')
    .select('role, content, attachments, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(24);

  const rows = (stored && stored.length
    ? [...stored].reverse()
    : [...history.slice(-8).map((h) => ({ role: h.role, content: h.content, attachments: [] as typeof images })),
      { role: 'user' as const, content: message, attachments: images }]);

  const lastUserIdx = rows.reduce((acc, r, i) => (r.role === 'user' ? i : acc), -1);
  if (images.length && lastUserIdx >= 0) {
    (rows[lastUserIdx] as { attachments: typeof images }).attachments = images;
  }
  const imageTurnIdx = rows
    .map((r, i) => ({ i, n: Array.isArray(r.attachments) ? (r.attachments as unknown[]).length : 0 }))
    .filter((x) => x.n > 0)
    .slice(-3)
    .map((x) => x.i);
  const keepImages = new Set(imageTurnIdx);

  const rawImage = (img: { media_type?: string; data?: string }) =>
    String(img.data ?? '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');

  const mapped: AiMessage[] = rows.map((r, i) => {
    const atts = (Array.isArray(r.attachments) ? r.attachments as typeof images : [])
      .filter((img) => rawImage(img).length > 20);
    const text = (r.content as string) || (atts.length ? 'Please look at the attached image and help me with billing.' : '.');
    if (r.role === 'user') {
      return {
        role: 'user',
        text,
        ...(keepImages.has(i) && atts.length
          ? { images: atts.map((img) => ({ media_type: img.media_type, data: rawImage(img) })) }
          : {}),
      };
    }
    return { role: 'assistant', text };
  });

  // Both APIs reject two turns of the same role in a row, so fold them.
  const messages: AiMessage[] = [];
  for (const m of mapped) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role && m.role !== 'tool' && last.role !== 'tool') {
      last.text = `${last.text}\n${m.text}`.trim();
      if (m.role === 'user' && m.images?.length) {
        (last as Extract<AiMessage, { role: 'user' }>).images = m.images;
      }
    } else {
      messages.push(m);
    }
  }
  if (messages[0]?.role === 'assistant') messages.shift();

  const wantsRecord = images.length > 0
    || /\b(invoice|quote|expense|client|gst|itc|retainer|subscription|payroll|salary|teammate|paycheck|cash on hand|log|create|add|record|mark|paid|unpaid|credit|challan)\b/i.test(message);

  let draft: Awaited<ReturnType<typeof executeAssistantTool>>['draft'] = null;
  const created: NonNullable<Awaited<ReturnType<typeof executeAssistantTool>>['created']>[] = [];
  let reply = '';
  let usedTool = false;
  let nudged = false;

  /**
   * One provider handles the whole conversation. Swapping mid-loop would
   * hand a half-finished tool exchange to a model that never made those
   * calls, so a provider failure restarts the turn on the next one instead.
   */
  let active = chain[0];
  let switched: string | null = null;

  const ask = async (forceTool: boolean): Promise<AiTurn> => {
    for (let i = chain.indexOf(active); i < chain.length; i++) {
      try {
        return await chain[i].complete({ system, messages, tools, forceTool });
      } catch (e) {
        const last = i === chain.length - 1;
        if (last || !(e instanceof ProviderError)) throw e;
        switched = `${chain[i].label} failed (${e.message}) — retried on ${chain[i + 1].label}.`;
        active = chain[i + 1];
        // Tool exchanges from the failed provider carry its call ids; drop
        // them so the next provider starts from a clean user turn.
        for (let k = messages.length - 1; k >= 0; k--) {
          if (messages[k].role !== 'user') messages.splice(k, 1); else break;
        }
      }
    }
    throw new ProviderError(active.id, 'Every configured provider failed.');
  };

  for (let turn = 0; turn < 6; turn++) {
    const res = await ask(nudged && !usedTool);
    reply = res.text;

    if (res.toolCalls.length === 0) {
      if (!usedTool && wantsRecord && !nudged) {
        nudged = true;
        messages.push({ role: 'assistant', text: reply || '…' });
        messages.push({
          role: 'user',
          text: 'You did not call a tool, so nothing was saved. If a receipt or screenshot is in this thread, you can see it — extract the figures and call the matching tool now (create_expense, create_draft_invoice, create_client, create_gst_payment, create_retainer, create_team_member, upsert_paycheck, mark_payroll_paid, create_recurring_expense, or set_cash_on_hand). Do not claim the image is missing. Do not reply Done without a tool result.',
        });
        continue;
      }
      break;
    }

    usedTool = true;
    messages.push({ role: 'assistant', text: reply, toolCalls: res.toolCalls });

    const results: AiMessage & { role: 'tool' } = { role: 'tool', results: [] };
    for (const tu of res.toolCalls) {
      // Issuing an invoice is the one metered action — check before, not after.
      if (tu.name === 'create_draft_invoice' && allowance.blocked) {
        results.results.push({
          id: tu.id, name: tu.name, isError: true,
          content: overLimitMessage(allowance),
        });
        continue;
      }
      try {
        const out = await executeAssistantTool(supabase, tu.name, tu.input, company, userEmail ?? undefined);
        if (out.draft) draft = out.draft;
        if (out.created) created.push(out.created);
        results.results.push({ id: tu.id, name: tu.name, content: JSON.stringify(out.result) });
      } catch (e) {
        results.results.push({
          id: tu.id, name: tu.name, isError: true,
          content: e instanceof Error ? e.message : 'Tool failed',
        });
      }
    }
    messages.push(results);
  }

  const finalReply = reply
    || (created.length ? `Created — open ${created.map((c) => c.title).join(', ')} to review.` : '')
    || (wantsRecord
      ? 'I could not save that from what I had. Attach the receipt again, or send the amount and date.'
      : 'Done.');
  await supabase.from('conversation_messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: finalReply,
    draft: created.length ? created : draft,
  });
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);


  return {
    reply: finalReply,
    created,
    draft,
    conversationId,
    engine: { provider: active.id, label: active.label, model: active.model, key: active.keySource },
    notice: switched,
  };
}
