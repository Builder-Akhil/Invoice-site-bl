'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, Search, Download, Loader2 } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients } from '@/lib/hooks';
import { useListFilters } from '@/lib/list-filters';
import type { DocType, Invoice } from '@/lib/types';
import { fmtDate, money, moneyShort, downloadCSV, todayISO } from '@/lib/format';
import { netExpected } from '@/lib/payments';
import { setInvoicePaidStatus, statusAfterUncancel, uncancelInvoice } from '@/lib/invoice-status';
import { Card, EmptyState, Input, Loading, PageHeader, Select, StatusPill, STATUS_LABEL, Tabs, toast, useConfirm } from './ui';
import RecordPaymentModal from './RecordPaymentModal';

const LIST_FILTERS = { tab: 'all', q: '', client: '', from: '', to: '' };

export default function DocumentList({ docType }: { docType: DocType }) {
  const { clients } = useClients();
  const { confirm, confirmNode } = useConfirm();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const { values: f, set } = useListFilters(docType === 'quote' ? 'quotes' : 'invoices', LIST_FILTERS);
  const tab = f.tab;
  const q = f.q;
  const clientId = f.client;
  const from = f.from;
  const to = f.to;
  const [settling, setSettling] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null);

  useEffect(() => {
    setLoading(true);
    sb().from('invoices').select('*').eq('doc_type', docType)
      .order('invoice_date', { ascending: false }).order('invoice_number', { ascending: false })
      .then(({ data }) => { setRows((data ?? []) as Invoice[]); setLoading(false); });
  }, [docType]);

  const today = todayISO();
  const decorated = useMemo(() => rows.map((r) => ({
    ...r,
    status: (r.status === 'sent' && r.due_date && r.due_date < today && Number(r.balance_due) > 0.5
      ? 'overdue' : r.status) as Invoice['status'],
  })), [rows, today]);

  const scoped = useMemo(() => {
    const s = q.trim().toLowerCase();
    return decorated.filter((r) => {
      if (clientId && r.client_id !== clientId) return false;
      if (from && r.invoice_date < from) return false;
      if (to && r.invoice_date > to) return false;
      if (!s) return true;
      const name = clients.find((c) => c.id === r.client_id)?.company_name ?? '';
      return [r.invoice_number, r.subject, name].some((v) => (v ?? '').toLowerCase().includes(s));
    });
  }, [decorated, q, clientId, from, to, clients]);

  const filtered = useMemo(() => scoped.filter((r) => {
    if (tab === 'unpaid' && !['sent', 'viewed', 'overdue', 'partially_paid'].includes(r.status)) return false;
    if (tab !== 'all' && tab !== 'unpaid' && r.status !== tab) return false;
    return true;
  }), [scoped, tab]);

  const tabCount = (pred: (r: typeof scoped[number]) => boolean) => scoped.filter(pred).length;

  const inr = (r: Invoice, f: keyof Invoice) => Number(r[f]) * (Number(r.exchange_rate) || 1);
  const outstanding = filtered.filter((r) => r.status !== 'cancelled' && r.status !== 'draft')
    .reduce((a, r) => a + inr(r, 'balance_due'), 0);
  const overdue = filtered.filter((r) => r.status === 'overdue').reduce((a, r) => a + inr(r, 'balance_due'), 0);
  const billed = filtered.filter((r) => r.status !== 'cancelled' && r.status !== 'draft')
    .reduce((a, r) => a + inr(r, 'total'), 0);
  const expectedBank = filtered.filter((r) => r.status !== 'cancelled' && r.status !== 'draft' && r.status !== 'paid')
    .reduce((a, r) => a + netExpected(r) * (Number(r.exchange_rate) || 1) - inr(r, 'amount_paid'), 0);

  const label = docType === 'quote' ? 'Quote' : 'Invoice';
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.company_name ?? '—';

  async function restoreCancelled(r: Invoice) {
    const next = statusAfterUncancel(r);
    const nextLabel = STATUS_LABEL[next] ?? next;
    if (!(await confirm(`Restore ${r.invoice_number}? It goes back to ${nextLabel}.`))) return;
    setSettling(r.id);
    try {
      const raw = rows.find((x) => x.id === r.id) ?? r;
      const updated = await uncancelInvoice(sb(), raw);
      setRows((list) => list.map((x) => (x.id === r.id ? updated : x)));
      toast(`${r.invoice_number} restored to ${nextLabel}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not restore', 'error');
    } finally { setSettling(null); }
  }

  async function markUnpaid(r: Invoice) {
    if (!(await confirm(`Mark ${r.invoice_number} unpaid? This removes recorded payments from the invoice.`))) return;
    setSettling(r.id);
    try {
      const raw = rows.find((x) => x.id === r.id) ?? r;
      const updated = await setInvoicePaidStatus(sb(), raw, false);
      setRows((list) => list.map((x) => (x.id === r.id ? updated : x)));
      toast(`${r.invoice_number} marked unpaid`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update status', 'error');
    } finally { setSettling(null); }
  }

  const exportCsv = () => downloadCSV(`${docType}s.csv`, [
    ['Number', 'Date', 'Due', 'Client', 'Status', 'Currency', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'TDS', 'Net expected (bank)', 'Received', 'Balance', 'Place of supply', 'GSTIN'],
    ...filtered.map((r) => {
      const c = clients.find((x) => x.id === r.client_id);
      return [r.invoice_number, r.invoice_date, r.due_date, clientName(r.client_id), r.status, r.currency,
        r.subtotal, r.cgst_total, r.sgst_total, r.igst_total, r.total, r.tds_amount, netExpected(r),
        r.amount_paid, r.balance_due, r.place_of_supply, c?.gstin ?? ''];
    }),
  ]);

  return (
    <>
      <PageHeader title={docType === 'quote' ? 'Quotes' : 'Invoices'}
        subtitle={docType === 'quote' ? 'Send an estimate, convert it to an invoice in one click.' : 'Net expected is what should hit the LLP bank after TDS — tick it off the statement, then record the payment.'}>
        <button className="btn-ghost" onClick={exportCsv}><Download size={15} /> CSV</button>
        <Link href={`/app/invoices/new${docType === 'quote' ? '?type=quote' : ''}`} className="btn-primary">
          <Plus size={15} /> New {label.toLowerCase()}
        </Link>
      </PageHeader>

      <div className={`mb-5 grid gap-3 ${docType === 'invoice' ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {([['Billed', billed, 'text-white'],
          ...(docType === 'invoice' ? [['Expected in bank', Math.max(0, expectedBank), 'text-amber-300'] as const] : []),
          ['Outstanding', outstanding, 'text-amber-300'],
          ['Overdue', overdue, 'text-red-300']] as [string, number, string][]).map(([l, v, c]) => (
          <div key={l} className="card px-4 py-3">
            <p className="label-mono">{l}</p>
            <p className={`mt-1.5 font-display text-[26px] leading-none ${c}`}>{moneyShort(v)}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chrome-dark" />
          <Input className="pl-8" placeholder="Number, subject or client…" value={q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Select className="max-w-[190px]" value={clientId} onChange={(e) => set('client', e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </Select>
        <Input type="date" className="max-w-[150px]" value={from} onChange={(e) => set('from', e.target.value)} title="From" />
        <Input type="date" className="max-w-[150px]" value={to} onChange={(e) => set('to', e.target.value)} title="To" />
      </div>

      <div className="mb-4">
        <Tabs active={tab} onChange={(k) => set('tab', k)} tabs={
          docType === 'quote'
            ? [{ key: 'all', label: 'All', count: scoped.length },
               { key: 'draft', label: 'Draft', count: tabCount((r) => r.status === 'draft') },
               { key: 'sent', label: 'Sent', count: tabCount((r) => r.status === 'sent') },
               { key: 'accepted', label: 'Accepted', count: tabCount((r) => r.status === 'accepted') },
               { key: 'cancelled', label: 'Cancelled', count: tabCount((r) => r.status === 'cancelled') }]
            : [{ key: 'all', label: 'All', count: scoped.length },
               { key: 'draft', label: 'Drafts', count: tabCount((r) => r.status === 'draft') },
               { key: 'unpaid', label: 'Unpaid', count: tabCount((r) => ['sent', 'viewed', 'overdue', 'partially_paid'].includes(r.status)) },
               { key: 'overdue', label: 'Overdue', count: tabCount((r) => r.status === 'overdue') },
               { key: 'paid', label: 'Paid', count: tabCount((r) => r.status === 'paid') },
               { key: 'cancelled', label: 'Cancelled', count: tabCount((r) => r.status === 'cancelled') }]
        } />
      </div>

      <Card bodyClass="">
        {loading ? <Loading />
          : filtered.length === 0 ? (
            <EmptyState icon={<FileText size={18} />} title={`No ${label.toLowerCase()}s here`}
              body="Raise one from scratch, or describe it to the assistant at the bottom of the screen."
              action={<Link href={`/app/invoices/new${docType === 'quote' ? '?type=quote' : ''}`} className="btn-primary"><Plus size={15} /> New {label.toLowerCase()}</Link>} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[960px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">{label} #</th><th className="th">Client</th>
                  <th className="th">Date</th><th className="th">{docType === 'quote' ? 'Valid till' : 'Due'}</th>
                  <th className="th">Status</th>
                  {docType === 'invoice' && <th className="th text-right">Net expected</th>}
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Balance</th>
                </tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td className="td">
                        <Link href={`/app/invoices/${r.id}`} className="block">
                          <span className="font-mono text-[13px] font-semibold text-white">{r.invoice_number}</span>
                          {r.subject && <span className="mt-0.5 block max-w-[240px] truncate text-[11.5px] text-chrome">{r.subject}</span>}
                        </Link>
                      </td>
                      <td className="td"><Link href={`/app/invoices/${r.id}`} className="text-[13px] text-[#C9CEDA]">{clientName(r.client_id)}</Link></td>
                      <td className="td text-[12.5px] text-chrome">{fmtDate(r.invoice_date)}</td>
                      <td className={`td text-[12.5px] ${r.status === 'overdue' ? 'text-red-300' : 'text-chrome'}`}>{fmtDate(r.due_date)}</td>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusPill status={r.status} />
                          {r.status === 'cancelled' && (
                            <button type="button" className="btn-primary btn-xs" disabled={settling === r.id}
                              onClick={() => restoreCancelled(r)}>
                              {settling === r.id ? <Loader2 size={13} className="animate-spin" /> : 'Restore'}
                            </button>
                          )}
                          {docType === 'invoice' && r.status !== 'cancelled' && (
                            r.status === 'paid' ? (
                              <button type="button" className="btn-subtle btn-xs" disabled={settling === r.id}
                                onClick={() => markUnpaid(r)}>
                                {settling === r.id ? <Loader2 size={13} className="animate-spin" /> : 'Unpaid'}
                              </button>
                            ) : (
                              <button type="button" className="btn-primary btn-xs" disabled={settling === r.id}
                                onClick={() => setPayFor(rows.find((x) => x.id === r.id) ?? r)}>
                                Paid
                              </button>
                            )
                          )}
                        </div>
                      </td>
                      {docType === 'invoice' && (
                        <td className="td text-right">
                          <span className="font-mono tabular-nums text-[13px] text-amber-200">{money(netExpected(r), r.currency)}</span>
                          {Number(r.tds_amount) > 0 && (
                            <span className="mt-0.5 block text-[10.5px] text-chrome-dark">after TDS {money(r.tds_amount, r.currency)}</span>
                          )}
                        </td>
                      )}
                      <td className="td text-right font-mono tabular-nums text-[13px] text-white">{money(r.total, r.currency)}</td>
                      <td className={`td text-right font-mono tabular-nums text-[13px] ${Number(r.balance_due) > 0.5 ? 'text-amber-300' : 'text-chrome-dark'}`}>
                        {Number(r.balance_due) > 0.5 ? money(r.balance_due, r.currency) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
      <RecordPaymentModal
        invoice={payFor}
        open={!!payFor}
        onClose={() => setPayFor(null)}
        onSaved={(updated) => setRows((list) => list.map((x) => (x.id === updated.id ? updated : x)))}
      />
      {confirmNode}
    </>
  );
}
