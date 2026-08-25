import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabase } from '@/lib/supabase/server';
import { assistantTools, executeAssistantTool } from '@/lib/assistant-tools';
import { booksSnapshot } from '@/lib/finance';
import { asComponents, asPayrollLines, previousPeriod } from '@/lib/payroll';
import { financialYear } from '@/lib/format';
import type { CompanyProfile, Expense, Invoice, PayrollItem, RecurringExpense, TeamMember } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const tools = assistantTools;

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    if (!process.env.ANTHROPIC_API_KEY)
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set. Add it to .env.local / Vercel to enable the assistant.' }, { status: 400 });

    const body = await req.json() as {
      message?: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
      conversation_id?: string | null;
      images?: { media_type?: string; data?: string }[];
    };
    const message = String(body.message ?? '').trim();
    const history = body.history ?? [];
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    const images = (body.images ?? [])
      .filter((i): i is { media_type: typeof allowedTypes[number]; data: string } =>
        !!i?.data && allowedTypes.includes((i.media_type as typeof allowedTypes[number]) ?? 'image/jpeg'))
      .slice(0, 4)
      .map((i) => ({
        media_type: allowedTypes.includes(i.media_type) ? i.media_type : 'image/jpeg' as const,
        data: i.data,
      }));
    if (!message && images.length === 0) {
      return NextResponse.json({ error: 'Say something, or attach an image.' }, { status: 400 });
    }

    let conversationId = body.conversation_id ?? null;
    if (conversationId) {
      const { data: owned } = await supabase.from('conversations').select('id')
        .eq('id', conversationId).eq('user_id', user.id).maybeSingle();
      if (!owned) conversationId = null;
    }
    if (!conversationId) {
      const title = (message || 'Image chat').replace(/\s+/g, ' ').trim().slice(0, 72) || 'New chat';
      const { data: conv, error: convErr } = await supabase.from('conversations')
        .insert({ user_id: user.id, title }).select('id').single();
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

    const system = `You are the billing assistant inside ${company?.legal_name ?? 'BuildableLabs LLP'}'s invoicing portal.
Today is ${new Date().toISOString().slice(0, 10)}. Supplier state: ${company?.state ?? 'Telangana'} (${company?.state_code ?? '36'}). Default currency INR.

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
- Default gst_rate 18 unless told otherwise. Pull SAC codes and rates from the SERVICES catalog when the item matches.
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

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    const mapped: Anthropic.MessageParam[] = rows.map((r, i) => {
      const atts = (Array.isArray(r.attachments) ? r.attachments as typeof images : [])
        .filter((img) => rawImage(img).length > 20);
      const text = (r.content as string) || (atts.length ? 'Please look at the attached image and help me with billing.' : '.');
      if (r.role === 'user' && keepImages.has(i) && atts.length) {
        return {
          role: 'user' as const,
          content: [
            ...atts.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: (allowedTypes.includes(img.media_type as typeof allowedTypes[number])
                  ? img.media_type : 'image/jpeg') as typeof allowedTypes[number],
                data: rawImage(img),
              },
            })),
            { type: 'text' as const, text },
          ],
        };
      }
      return { role: r.role as 'user' | 'assistant', content: text };
    });

    const messages: Anthropic.MessageParam[] = [];
    for (const m of mapped) {
      const last = messages[messages.length - 1];
      if (last && last.role === m.role && typeof last.content === 'string' && typeof m.content === 'string') {
        last.content = `${last.content}\n${m.content}`.trim();
      } else if (last && last.role === m.role) {
        messages[messages.length - 1] = m;
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

    for (let turn = 0; turn < 6; turn++) {
      const res = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
        max_tokens: 1600,
        system,
        tools,
        messages,
        ...(nudged && !usedTool ? { tool_choice: { type: 'any' as const } } : {}),
      });

      reply = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();

      if (res.stop_reason !== 'tool_use') {
        if (!usedTool && wantsRecord && !nudged) {
          nudged = true;
          const blocks = res.content.length ? res.content : [{ type: 'text' as const, text: reply || '…' }];
          messages.push({ role: 'assistant', content: blocks });
          messages.push({
            role: 'user',
            content: 'You did not call a tool, so nothing was saved. If a receipt or screenshot is in this thread, you can see it — extract the figures and call the matching tool now (create_expense, create_draft_invoice, create_client, create_gst_payment, create_retainer, create_team_member, upsert_paycheck, mark_payroll_paid, create_recurring_expense, or set_cash_on_hand). Do not claim the image is missing. Do not reply Done without a tool result.',
          });
          continue;
        }
        break;
      }

      usedTool = true;
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        try {
          const out = await executeAssistantTool(supabase, tu.name, tu.input, company, user.email);
          if (out.draft) draft = out.draft;
          if (out.created) created.push(out.created);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out.result) });
        } catch (e) {
          results.push({
            type: 'tool_result', tool_use_id: tu.id, is_error: true,
            content: e instanceof Error ? e.message : 'Tool failed',
          });
        }
      }
      messages.push({ role: 'user', content: results });
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

    return NextResponse.json({
      reply: finalReply,
      draft: created.find((c) => c.kind === 'invoice') ?? draft,
      created,
      conversation_id: conversationId,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Assistant failed' }, { status: 500 });
  }
}
