'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { FileText, Plus, Search, Download, Pencil, Loader2 } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients } from '@/lib/hooks';
import type { DocType, Invoice } from '@/lib/types';
import { fmtDate, money, moneyShort, downloadCSV, todayISO } from '@/lib/format';
import { setInvoicePaidStatus } from '@/lib/invoice-status';
import { Card, EmptyState, Input, Loading, PageHeader, Select, StatusPill, Tabs, toast } from './ui';

export default function DocumentList({ docType }: { docType: DocType }) {
  const { clients } = useClients();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [settling, setSettling] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    sb().from('invoices').select('*').eq('doc_type', docType)
      .order('invoice_date', { ascending: false }).order('invoice_number', { ascending: false })
      .then(({ data }) => { setRows((data ?? []) as Invoice[]); setLoading(false); });
  }, [docType]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const today = todayISO();
  const decorated = useMemo(() => rows.map((r) => ({
    ...r,
    status: (r.status === 'sent' && r.due_date && r.due_date < today && Number(r.balance_due) > 0.5
      ? 'overdue' : r.status) as Invoice['status'],
  })), [rows, today]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return decorated.filter((r) => {
      if (tab === 'unpaid' && !['sent', 'viewed', 'overdue', 'partially_paid'].includes(r.status)) return false;
      if (tab !== 'all' && tab !== 'unpaid' && r.status !== tab) return false;
      if (clientId && r.client_id !== clientId) return false;
      if (from && r.invoice_date < from) return false;
      if (to && r.invoice_date > to) return false;
      if (!s) return true;
      const name = clients.find((c) => c.id === r.client_id)?.company_name ?? '';
      return [r.invoice_number, r.subject, name].some((v) => (v ?? '').toLowerCase().includes(s));
    });
  }, [decorated, tab, q, clientId, from, to, clients]);

  const inr = (r: Invoice, f: keyof Invoice) => Number(r[f]) * (Number(r.exchange_rate) || 1);
  const outstanding = filtered.filter((r) => r.status !== 'cancelled' && r.status !== 'draft')
    .reduce((a, r) => a + inr(r, 'balance_due'), 0);
  const overdue = filtered.filter((r) => r.status === 'overdue').reduce((a, r) => a + inr(r, 'balance_due'), 0);
  const billed = filtered.filter((r) => r.status !== 'cancelled' && r.status !== 'draft')
    .reduce((a, r) => a + inr(r, 'total'), 0);

  const label = docType === 'quote' ? 'Quote' : 'Invoice';
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.company_name ?? '—';

  async function settle(r: Invoice, paid: boolean) {
    setMenu(null);
    setSettling(r.id);
    try {
      const raw = rows.find((x) => x.id === r.id) ?? r;
      const updated = await setInvoicePaidStatus(sb(), raw, paid);
      setRows((list) => list.map((x) => (x.id === r.id ? updated : x)));
      toast(paid ? `${r.invoice_number} marked paid` : `${r.invoice_number} marked unpaid`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update status', 'error');
    } finally { setSettling(null); }
  }

  const exportCsv = () => downloadCSV(`buildablelabs-${docType}s.csv`, [
    ['Number', 'Date', 'Due', 'Client', 'Status', 'Currency', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Paid', 'Balance', 'Place of supply', 'GSTIN'],
    ...filtered.map((r) => {
      const c = clients.find((x) => x.id === r.client_id);
      return [r.invoice_number, r.invoice_date, r.due_date, clientName(r.client_id), r.status, r.currency,
        r.subtotal, r.cgst_total, r.sgst_total, r.igst_total, r.total, r.amount_paid, r.balance_due,
        r.place_of_supply, c?.gstin ?? ''];
    }),
  ]);

  return (
    <>
      <PageHeader title={docType === 'quote' ? 'Quotes' : 'Invoices'}
        subtitle={docType === 'quote' ? 'Send an estimate, convert it to an invoice in one click.' : 'Everything you have raised, with live payment status.'}>
        <button className="btn-ghost" onClick={exportCsv}><Download size={15} /> CSV</button>
        <Link href={`/invoices/new${docType === 'quote' ? '?type=quote' : ''}`} className="btn-primary">
          <Plus size={15} /> New {label.toLowerCase()}
        </Link>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[['Billed', billed, 'text-white'], ['Outstanding', outstanding, 'text-amber-300'], ['Overdue', overdue, 'text-red-300']].map(([l, v, c]) => (
          <div key={l as string} className="card px-4 py-3">
            <p className="label-mono">{l as string}</p>
            <p className={`mt-1.5 font-display text-[26px] leading-none ${c as string}`}>{moneyShort(v as number)}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chrome-dark" />
          <Input className="pl-8" placeholder="Number, subject or client…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="max-w-[190px]" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </Select>
        <Input type="date" className="max-w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
        <Input type="date" className="max-w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} title="To" />
      </div>

      <div className="mb-4">
        <Tabs active={tab} onChange={setTab} tabs={
          docType === 'quote'
            ? [{ key: 'all', label: 'All', count: decorated.length },
               { key: 'draft', label: 'Draft', count: decorated.filter((r) => r.status === 'draft').length },
               { key: 'sent', label: 'Sent', count: decorated.filter((r) => r.status === 'sent').length },
               { key: 'accepted', label: 'Accepted', count: decorated.filter((r) => r.status === 'accepted').length }]
            : [{ key: 'all', label: 'All', count: decorated.length },
               { key: 'draft', label: 'Drafts', count: decorated.filter((r) => r.status === 'draft').length },
               { key: 'unpaid', label: 'Unpaid', count: decorated.filter((r) => ['sent', 'viewed', 'overdue', 'partially_paid'].includes(r.status)).length },
               { key: 'overdue', label: 'Overdue', count: decorated.filter((r) => r.status === 'overdue').length },
               { key: 'paid', label: 'Paid', count: decorated.filter((r) => r.status === 'paid').length }]
        } />
      </div>

      <Card bodyClass="">
        {loading ? <Loading />
          : filtered.length === 0 ? (
            <EmptyState icon={<FileText size={18} />} title={`No ${label.toLowerCase()}s here`}
              body="Raise one from scratch, or describe it to the assistant at the bottom of the screen."
              action={<Link href={`/invoices/new${docType === 'quote' ? '?type=quote' : ''}`} className="btn-primary"><Plus size={15} /> New {label.toLowerCase()}</Link>} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[820px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">{label} #</th><th className="th">Client</th>
                  <th className="th">Date</th><th className="th">{docType === 'quote' ? 'Valid till' : 'Due'}</th>
                  <th className="th">Status</th><th className="th text-right">Total</th><th className="th text-right">Balance</th>
                </tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td className="td">
                        <Link href={`/invoices/${r.id}`} className="block">
                          <span className="font-mono text-[13px] font-semibold text-white">{r.invoice_number}</span>
                          {r.subject && <span className="mt-0.5 block max-w-[240px] truncate text-[11.5px] text-chrome">{r.subject}</span>}
                        </Link>
                      </td>
                      <td className="td"><Link href={`/invoices/${r.id}`} className="text-[13px] text-[#C9CEDA]">{clientName(r.client_id)}</Link></td>
                      <td className="td text-[12.5px] text-chrome">{fmtDate(r.invoice_date)}</td>
                      <td className={`td text-[12.5px] ${r.status === 'overdue' ? 'text-red-300' : 'text-chrome'}`}>{fmtDate(r.due_date)}</td>
                      <td className="td">
                        <div className="flex items-center gap-1">
                          <StatusPill status={r.status} />
                          {docType === 'invoice' && r.status !== 'cancelled' && (
                            <button type="button" className="btn-subtle btn-xs" title="Change paid / unpaid"
                              disabled={settling === r.id}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setMenu({ id: r.id, top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 168) });
                              }}>
                              {settling === r.id ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
                            </button>
                          )}
                        </div>
                      </td>
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
      {menu && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[80] min-w-[148px] overflow-hidden rounded-lg border border-line bg-ink-700 py-1 shadow-pop"
          style={{ top: menu.top, left: menu.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {['Paid', 'Unpaid'].map((label) => {
            const paid = label === 'Paid';
            const target = rows.find((x) => x.id === menu.id);
            const currentPaid = target?.status === 'paid';
            const active = paid === currentPaid;
            return (
              <button key={label} type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition hover:bg-ink-500 ${active ? 'text-white' : 'text-[#C9CEDA]'}`}
                onClick={() => target && settle(target, paid)}>
                {label}
                {active && <span className="text-[11px] text-chrome">current</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
