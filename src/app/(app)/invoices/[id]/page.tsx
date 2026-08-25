'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Send, Printer, Download, Link2, Copy, Trash2, CheckCircle2,
  Ban, ArrowRightLeft, IndianRupee, Clock, Mail, RotateCcw,
} from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useProfile } from '@/lib/hooks';
import { useFilterNav } from '@/lib/list-filters';
import { consumeNumber, loadInvoice, logActivity } from '@/lib/invoice-service';
import { setInvoicePaidStatus, uncancelInvoice, statusAfterUncancel } from '@/lib/invoice-status';
import type { Invoice, Payment } from '@/lib/types';
import { PAYMENT_MODES } from '@/lib/types';
import { fmtDate, fmtDateLong, money, todayISO } from '@/lib/format';
import { netExpected } from '@/lib/payments';
import InvoicePaper from '@/components/InvoicePaper';
import RecordPaymentModal from '@/components/RecordPaymentModal';
import {
  Card, Field, Input, Loading, Modal, StatusPill, STATUS_LABEL, Textarea, Toggle, toast, useConfirm, Spinner,
} from '@/components/ui';

export default function InvoiceDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { profile } = useProfile();
  const lists = useFilterNav();
  const { confirm, confirmNode } = useConfirm();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const [payOpen, setPayOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [mail, setMail] = useState({ to: '', cc: '', subject: '', message: '', attach: true });

  const refresh = useCallback(async () => {
    try {
      const i = await loadInvoice(params.id);
      setInv(i);
      const { data } = await sb().from('payments').select('*').eq('invoice_id', params.id).order('payment_date', { ascending: false });
      setPayments((data ?? []) as Payment[]);
    } catch (e) { toast(e instanceof Error ? e.message : 'Not found', 'error'); }
    setLoading(false);
  }, [params.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <Loading label="Loading document" />;
  if (!inv) return <Card><p className="text-[13px] text-chrome">This document no longer exists.</p></Card>;

  const isQuote = inv.doc_type === 'quote';
  const client = inv.clients ?? inv.client_snapshot ?? null;
  const publicUrl = typeof window !== 'undefined' && inv.public_token ? `${window.location.origin}/i/${inv.public_token}` : '';

  async function setStatus(status: string, note?: string) {
    setBusy(status);
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === 'sent' && !inv!.sent_at) patch.sent_at = new Date().toISOString();
    const { error } = await sb().from('invoices').update(patch).eq('id', inv!.id);
    setBusy('');
    if (error) return toast(error.message, 'error');
    await logActivity('invoice', inv!.id, status, note);
    toast(note ?? 'Updated'); refresh();
  }

  async function deletePayment(p: Payment) {
    if (!(await confirm(`Delete the payment of ${money(p.amount, p.currency)} dated ${fmtDate(p.payment_date)}?`))) return;
    await sb().from('payments').delete().eq('id', p.id);
    toast('Payment removed'); refresh();
  }

  async function sendEmail() {
    setBusy('send');
    try {
      const res = await fetch(`/api/invoices/${inv!.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mail),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Send failed');
      toast(`Sent to ${mail.to}`);
      setSendOpen(false); refresh();
    } catch (e) { toast(e instanceof Error ? e.message : 'Send failed', 'error'); }
    finally { setBusy(''); }
  }

  function openSend() {
    setMail({
      to: client?.email ?? '',
      cc: client?.cc_emails ?? '',
      subject: `${isQuote ? 'Quote' : 'Invoice'} ${inv!.invoice_number} from ${profile?.legal_name ?? 'BuildableLabs LLP'}`,
      message: `Hi ${client?.contact_person || client?.company_name || 'there'},\n\n`
        + `Please find ${isQuote ? 'the quote' : `invoice ${inv!.invoice_number}`} for ${money(inv!.total, inv!.currency)}`
        + `${inv!.due_date && !isQuote ? `, due ${fmtDateLong(inv!.due_date)}` : ''}.\n\n`
        + `You can view it online any time using the link below.\n\nThanks,\n${profile?.contact_person ?? 'Akhil'}\n${profile?.legal_name ?? 'BuildableLabs LLP'}`,
      attach: true,
    });
    setSendOpen(true);
  }

  async function duplicate() {
    setBusy('dup');
    try {
      const number = await consumeNumber(inv!.doc_type);
      const { invoice_items, clients, id, public_token, created_at, updated_at, sent_at, viewed_at, paid_at, ...rest } = inv!;
      const { data, error } = await sb().from('invoices').insert({
        ...rest, invoice_number: number, status: 'draft', amount_paid: 0, balance_due: rest.total,
        invoice_date: todayISO(), public_token: undefined,
      }).select('id').single();
      if (error) throw error;
      await sb().from('invoice_items').insert((invoice_items ?? []).map(({ id: _i, ...l }) => ({ ...l, invoice_id: data.id })));
      toast(`Created ${number}`); router.push(`/invoices/${data.id}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not duplicate', 'error'); }
    finally { setBusy(''); }
  }

  async function convertToInvoice() {
    if (!(await confirm('Create an invoice from this quote? The quote is kept and marked accepted.'))) return;
    setBusy('conv');
    try {
      const number = await consumeNumber('invoice');
      const { invoice_items, clients, id, public_token, created_at, updated_at, sent_at, viewed_at, paid_at, ...rest } = inv!;
      const { data, error } = await sb().from('invoices').insert({
        ...rest, doc_type: 'invoice', invoice_number: number, status: 'draft',
        amount_paid: 0, balance_due: rest.total, invoice_date: todayISO(),
        converted_from: id, public_token: undefined,
      }).select('id').single();
      if (error) throw error;
      await sb().from('invoice_items').insert((invoice_items ?? []).map(({ id: _i, ...l }) => ({ ...l, invoice_id: data.id })));
      await sb().from('invoices').update({ status: 'accepted' }).eq('id', id);
      toast(`Invoice ${number} created`); router.push(`/invoices/${data.id}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not convert', 'error'); }
    finally { setBusy(''); }
  }

  async function restore() {
    const next = statusAfterUncancel(inv!);
    const label = STATUS_LABEL[next] ?? next;
    if (!(await confirm(`Restore ${inv!.invoice_number}? It goes back to ${label} — the cancel was only a status, nothing was deleted.`))) return;
    setBusy('restore');
    try {
      await uncancelInvoice(sb(), inv!);
      toast(`${inv!.invoice_number} restored to ${label}`);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not restore', 'error');
    } finally { setBusy(''); }
  }

  async function remove() {
    if (!(await confirm(`Permanently delete ${inv!.invoice_number}? For GST records, cancelling is usually safer than deleting.`))) return;
    const { error } = await sb().from('invoices').delete().eq('id', inv!.id);
    if (error) return toast(error.message, 'error');
    toast('Deleted'); router.push(isQuote ? '/quotes' : '/invoices');
  }

  const balance = Number(inv.balance_due);

  return (
    <>
      {/* ------------------------------ action bar ------------------------------ */}
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={lists[isQuote ? '/quotes' : '/invoices'] ?? (isQuote ? '/quotes' : '/invoices')}
            className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] text-chrome hover:text-white">
            <ArrowLeft size={14} /> {isQuote ? 'Quotes' : 'Invoices'}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[32px] leading-none text-white">{inv.invoice_number}</h1>
            <StatusPill status={inv.status} />
          </div>
          <p className="mt-1.5 text-[13px] text-chrome">
            {client?.company_name ?? '—'} · {fmtDateLong(inv.invoice_date)}
            {inv.due_date && !isQuote && ` · due ${fmtDateLong(inv.due_date)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/invoices/${inv.id}/edit`} className="btn-ghost"><Pencil size={15} /> Edit</Link>
          <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Print</button>
          <button className="btn-ghost" onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, '_blank')}><Download size={15} /> PDF</button>
          <button className="btn-ghost" onClick={() => { navigator.clipboard.writeText(publicUrl); toast('Share link copied'); }}>
            <Link2 size={15} /> Link
          </button>
          {inv.status !== 'cancelled' && (
            <button className="btn-primary" onClick={openSend}><Send size={15} /> Send</button>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_310px]">
        {/* ------------------------------ paper ------------------------------ */}
        <div className="print-full min-w-0 rounded-xl border border-line bg-ink-800/40 p-3 sm:p-6">
          <InvoicePaper invoice={inv} lines={inv.invoice_items ?? []} client={client} profile={profile} />
        </div>

        {/* ------------------------------ rail ------------------------------ */}
        <div className="no-print space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card title={isQuote ? 'Quote status' : 'Payment status'}>
            <div className="flex items-end justify-between">
              <div>
                <p className="label-mono">{isQuote ? 'Quote value' : 'Balance due'}</p>
                <p className={`mt-1 font-display text-[30px] leading-none ${balance > 0.5 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {money(isQuote ? inv.total : balance, inv.currency)}
                </p>
              </div>
              <StatusPill status={inv.status} />
            </div>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-chrome">Total</dt><dd className="font-mono text-white">{money(inv.total, inv.currency)}</dd></div>
              {!isQuote && Number(inv.tds_amount) > 0 && (
                <div className="flex justify-between"><dt className="text-chrome">TDS {inv.tds_section}</dt><dd className="font-mono text-chrome-light">{money(inv.tds_amount, inv.currency)}</dd></div>)}
              {!isQuote && (
                <div className="flex justify-between"><dt className="text-chrome">Net expected in bank</dt><dd className="font-mono text-amber-300">{money(netExpected(inv), inv.currency)}</dd></div>)}
              {!isQuote && <div className="flex justify-between"><dt className="text-chrome">Received (bank)</dt><dd className="font-mono text-emerald-300">{money(inv.amount_paid, inv.currency)}</dd></div>}
              {inv.currency !== 'INR' && (
                <div className="flex justify-between"><dt className="text-chrome">In INR</dt><dd className="font-mono text-chrome-light">{money(Number(inv.total) * Number(inv.exchange_rate))}</dd></div>)}
            </dl>

            <div className="mt-4 grid gap-2">
              {inv.status === 'cancelled' ? (
                <button className="btn-primary w-full" onClick={restore} disabled={busy === 'restore'}>
                  {busy === 'restore' ? <Spinner /> : <><RotateCcw size={15} /> Restore document</>}
                </button>
              ) : (
                <>
                  {!isQuote && balance > 0.5 && (
                    <button className="btn-primary w-full" onClick={() => setPayOpen(true)}>
                      <IndianRupee size={15} /> Record payment
                    </button>
                  )}
                  {!isQuote && inv.status === 'paid' && (
                    <button className="btn-ghost w-full" onClick={async () => {
                      if (!(await confirm(`Mark ${inv.invoice_number} unpaid? This removes recorded payments.`))) return;
                      setBusy('unpay');
                      try {
                        await setInvoicePaidStatus(sb(), inv, false);
                        toast(`${inv.invoice_number} marked unpaid`);
                        refresh();
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Could not update', 'error');
                      } finally { setBusy(''); }
                    }} disabled={busy === 'unpay'}>
                      {busy === 'unpay' ? <Spinner /> : 'Mark unpaid'}
                    </button>
                  )}
                  {inv.status === 'draft' && (
                    <button className="btn-ghost w-full" onClick={() => setStatus('sent', 'Marked as sent')} disabled={busy === 'sent'}>
                      <CheckCircle2 size={15} /> Mark as sent
                    </button>
                  )}
                  {isQuote && (
                    <>
                      <button className="btn-primary w-full" onClick={convertToInvoice} disabled={busy === 'conv'}>
                        {busy === 'conv' ? <Spinner /> : <><ArrowRightLeft size={15} /> Convert to invoice</>}
                      </button>
                      {inv.status !== 'accepted' && <button className="btn-ghost w-full" onClick={() => setStatus('accepted', 'Marked accepted')}>Mark accepted</button>}
                      {inv.status !== 'declined' && <button className="btn-ghost w-full" onClick={() => setStatus('declined', 'Marked declined')}>Mark declined</button>}
                    </>
                  )}
                </>
              )}
              <button className="btn-ghost w-full" onClick={duplicate} disabled={busy === 'dup'}>
                {busy === 'dup' ? <Spinner /> : <><Copy size={15} /> Duplicate</>}
              </button>
              {inv.status !== 'cancelled' && (
                <button className="btn-ghost w-full" onClick={() => setStatus('cancelled', 'Cancelled')}><Ban size={15} /> Cancel document</button>
              )}
              <button className="btn-danger w-full" onClick={remove}><Trash2 size={15} /> Delete</button>
            </div>
          </Card>

          {!isQuote && (
            <Card title="Payments" subtitle={payments.length ? `${payments.length} recorded` : 'Nothing received yet'} bodyClass="p-0">
              {payments.length === 0 ? (
                <p className="px-5 py-5 text-[12.5px] text-chrome">Record a payment when the money lands — the status updates itself.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] text-emerald-300">{money(p.amount, p.currency)}</p>
                        <p className="mt-0.5 text-[11.5px] text-chrome">
                          {fmtDate(p.payment_date)} · {PAYMENT_MODES.find((m) => m.value === p.mode)?.label ?? p.mode}
                        </p>
                        {p.reference && <p className="truncate font-mono text-[11px] text-chrome-dark">{p.reference}</p>}
                        {Number(p.tds_deducted) > 0 && <p className="text-[11px] text-chrome-dark">TDS withheld {money(p.tds_deducted, p.currency)}</p>}
                      </div>
                      <button className="btn-subtle btn-xs text-red-400" onClick={() => deletePayment(p)}><Trash2 size={13} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Trail">
            <ul className="space-y-2.5 text-[12px] text-chrome">
              <li className="flex items-start gap-2"><Clock size={13} className="mt-0.5 shrink-0" /> Created {fmtDateLong(inv.created_at)}</li>
              {inv.sent_at && <li className="flex items-start gap-2"><Mail size={13} className="mt-0.5 shrink-0" /> Sent {fmtDateLong(inv.sent_at)}</li>}
              {inv.viewed_at && <li className="flex items-start gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0" /> Viewed by client {fmtDateLong(inv.viewed_at)}</li>}
              {inv.paid_at && <li className="flex items-start gap-2 text-emerald-300"><CheckCircle2 size={13} className="mt-0.5 shrink-0" /> Paid {fmtDateLong(inv.paid_at)}</li>}
            </ul>
            {publicUrl && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="label-mono mb-1.5">Client link</p>
                <p className="break-all font-mono text-[11px] text-chrome-light">{publicUrl}</p>
              </div>
            )}
            {inv.internal_notes && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="label-mono mb-1.5">Internal notes</p>
                <p className="whitespace-pre-line text-[12px] text-chrome-light">{inv.internal_notes}</p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <RecordPaymentModal
        invoice={inv}
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onSaved={() => refresh()}
      />

      {/* ------------------------------ send modal ------------------------------ */}
      <Modal open={sendOpen} onClose={() => setSendOpen(false)} title={`Send ${inv.invoice_number}`}
        subtitle="Delivered from your domain via Resend, with the PDF attached."
        footer={<><button className="btn-ghost" onClick={() => setSendOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={sendEmail} disabled={busy === 'send'}>{busy === 'send' ? <Spinner /> : <><Send size={15} /> Send now</>}</button></>}>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="To" required><Input type="email" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} /></Field>
            <Field label="CC" hint="Comma separated"><Input value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} /></Field>
          </div>
          <Field label="Subject"><Input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></Field>
          <Field label="Message"><Textarea rows={8} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} /></Field>
          <Toggle checked={mail.attach} onChange={(v) => setMail({ ...mail, attach: v })} label="Attach the PDF" />
          <p className="text-[11.5px] text-chrome-dark">
            A view-online link is always included. Sending marks this {isQuote ? 'quote' : 'invoice'} as sent.
          </p>
        </div>
      </Modal>
      {confirmNode}
    </>
  );
}
