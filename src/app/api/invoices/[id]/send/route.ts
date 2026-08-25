import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { renderInvoicePdf } from '@/lib/pdf/render';
import { fmtDateLong, money } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    if (!process.env.RESEND_API_KEY)
      return NextResponse.json({ error: 'RESEND_API_KEY is not set. Add it in .env.local / Vercel and redeploy.' }, { status: 400 });

    const body = await req.json() as { to: string; cc?: string; subject: string; message: string; attach?: boolean };
    if (!body.to) return NextResponse.json({ error: 'No recipient email' }, { status: 400 });

    const result = await renderInvoicePdf(params.id);
    if (!result) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const { invoice, profile, buffer } = result;

    const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const viewUrl = `${base}/i/${invoice.public_token}`;
    const isQuote = invoice.doc_type === 'quote';

    const html = `
<div style="background:#F5F6F8;padding:32px 0;font-family:Manrope,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E6E8EE;">
    <div style="background:#0A0B0E;padding:22px 28px;">
      <p style="margin:0;color:#fff;font-size:16px;font-weight:800;letter-spacing:-.02em;">${profile?.trade_name ?? 'Buildable Labs'}</p>
      <p style="margin:6px 0 0;color:#7A8296;font-size:10px;letter-spacing:.14em;">${isQuote ? 'QUOTATION' : 'TAX INVOICE'} · ${invoice.invoice_number}</p>
    </div>
    <div style="padding:28px;">
      <div style="white-space:pre-line;font-size:14px;line-height:1.65;color:#1A1D24;">${escapeHtml(body.message)}</div>
      <table style="width:100%;margin:24px 0;border-collapse:collapse;font-size:13px;">
        <tr><td style="padding:7px 0;color:#4A5162;">${isQuote ? 'Quote' : 'Invoice'} number</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;color:#1A1D24;">${invoice.invoice_number}</td></tr>
        <tr><td style="padding:7px 0;color:#4A5162;">Amount</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;color:#1A1D24;">${money(invoice.total, invoice.currency)}</td></tr>
        ${invoice.due_date && !isQuote ? `<tr><td style="padding:7px 0;color:#4A5162;">Due date</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;color:#1A1D24;">${fmtDateLong(invoice.due_date)}</td></tr>` : ''}
      </table>
      <a href="${viewUrl}" style="display:inline-block;background:#0B3FDE;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700;">
        View ${isQuote ? 'quote' : 'invoice'} online</a>
      ${profile?.bank_account_no ? `<div style="margin-top:26px;padding-top:18px;border-top:1px solid #E6E8EE;font-size:12px;color:#4A5162;line-height:1.75;">
        <strong style="color:#1A1D24;">Bank details</strong><br/>
        ${profile.bank_account_name ?? ''}<br/>A/C ${profile.bank_account_no}${profile.bank_ifsc ? ` · IFSC ${profile.bank_ifsc}` : ''}${profile.bank_swift ? ` · SWIFT ${profile.bank_swift}` : ''}
      </div>` : ''}
    </div>
    <div style="padding:16px 28px;background:#F5F6F8;font-size:10px;color:#7A8296;letter-spacing:.08em;text-align:center;">
      ${(profile?.legal_name ?? 'BUILDABLELABS LLP').toUpperCase()}${profile?.gstin ? ` · GSTIN ${profile.gstin}` : ''}
    </div>
  </div>
</div>`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.INVOICE_FROM_EMAIL ?? 'Buildable Labs <onboarding@resend.dev>',
      to: body.to.split(',').map((s) => s.trim()).filter(Boolean),
      cc: body.cc ? body.cc.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      bcc: process.env.INVOICE_BCC_EMAIL || undefined,
      replyTo: profile?.email ?? undefined,
      subject: body.subject,
      html,
      attachments: body.attach === false ? undefined
        : [{ filename: `${invoice.invoice_number}.pdf`.replace(/[^\w.-]/g, '_'), content: buffer.toString('base64') }],
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    const admin = createAdminSupabase();
    await admin.from('invoices').update({
      status: invoice.status === 'draft' ? 'sent' : invoice.status,
      sent_at: new Date().toISOString(),
    }).eq('id', invoice.id);
    await admin.from('activity_log').insert({
      entity: 'invoice', entity_id: invoice.id, action: 'emailed',
      detail: `Sent to ${body.to}`, actor: user.email,
    });

    return NextResponse.json({ ok: true, viewUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed' }, { status: 500 });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
