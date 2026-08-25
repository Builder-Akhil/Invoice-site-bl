import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabase } from '@/lib/supabase/server';
import { assistantTools, executeAssistantTool } from '@/lib/assistant-tools';
import type { CompanyProfile } from '@/lib/types';

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

    const [{ data: clients }, { data: items }, { data: companyRow }, { data: invoices }, { data: retainers }] = await Promise.all([
      supabase.from('clients').select('id, company_name, contact_person, email, gstin, gst_treatment, place_of_supply_state, currency, payment_terms_days, default_sac, default_gst_rate').eq('status', 'active'),
      supabase.from('items').select('name, description, code, code_type, unit, rate, gst_rate').eq('is_active', true),
      supabase.from('company_profile').select('*').eq('id', 1).single(),
      supabase.from('invoices').select('id, invoice_number, status, total, currency, balance_due, client_id').eq('doc_type', 'invoice').order('invoice_date', { ascending: false }).limit(40),
      supabase.from('recurring_profiles').select('id, title, client_id, frequency, next_run_date, amount, is_active').order('next_run_date'),
    ]);
    const company = (companyRow ?? null) as CompanyProfile | null;

    const system = `You are the billing assistant inside ${company?.legal_name ?? 'BuildableLabs LLP'}'s invoicing portal.
Today is ${new Date().toISOString().slice(0, 10)}. Supplier state: ${company?.state ?? 'Telangana'} (${company?.state_code ?? '36'}). Default currency INR.

You can: create clients, draft invoices/quotes, log expenses, record GST payments or ITC credits, create retainers, run due retainers, and mark invoices paid/unpaid. Be decisive — if the request is complete, use a tool rather than only asking questions.

Rules:
- Match the client by name against the CLIENTS list (case-insensitive, partial matches are fine). Use its exact id.
- Only call create_client when the company genuinely is not in the list.
- Indian shorthand: "2.5L"/"2.5 lakh" = 250000, "1cr" = 10000000, "50k" = 50000.
- Rates are ALWAYS exclusive of GST. If the user gives an inclusive figure, back it out and say so.
- Default gst_rate 18 unless told otherwise. Pull SAC codes and rates from the SERVICES catalog when the item matches.
- Never invent GSTINs, invoice numbers or tax splits — the system computes those.
- Expenses: default tax_split igst (most SaaS). Same-state India vendors → cgst_sgst. itc_eligible true unless told otherwise.
- GST credits = itc_utilised on create_gst_payment. Cash to the department = igst_paid / cgst_paid / sgst_paid.
- After creating something, reply in one or two short sentences: what was created, the amount, and where to review it. No preamble, no markdown headings.
- The user may attach screenshots of invoices, quotes, WhatsApp chats, rate cards or GST challans. Read them and act.

CLIENTS:
${JSON.stringify(clients ?? [])}

SERVICES CATALOG:
${JSON.stringify(items ?? [])}

RECENT INVOICES:
${JSON.stringify(invoices ?? [])}

RETAINERS:
${JSON.stringify(retainers ?? [])}`;

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
    const mapped: Anthropic.MessageParam[] = rows.map((r, i) => {
      const atts = Array.isArray(r.attachments) ? r.attachments as typeof images : [];
      if (r.role === 'user' && i === lastUserIdx && atts.length) {
        return {
          role: 'user' as const,
          content: [
            ...atts.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
            })),
            { type: 'text' as const, text: (r.content as string) || 'Please look at the attached image and help me with billing.' },
          ],
        };
      }
      return { role: r.role as 'user' | 'assistant', content: (r.content as string) || (atts.length ? '(image attached)' : '.') };
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

    let created: Awaited<ReturnType<typeof executeAssistantTool>>['draft'] = null;
    let reply = '';

    for (let turn = 0; turn < 5; turn++) {
      const res = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
        max_tokens: 1600,
        system,
        tools,
        messages,
      });

      reply = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();

      if (res.stop_reason !== 'tool_use') break;

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        try {
          const out = await executeAssistantTool(supabase, tu.name, tu.input, company, user.email);
          if (out.draft) created = out.draft;
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

    const finalReply = reply || 'Done.';
    await supabase.from('conversation_messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: finalReply,
      draft: created,
    });
    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

    return NextResponse.json({ reply: finalReply, draft: created, conversation_id: conversationId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Assistant failed' }, { status: 500 });
  }
}
