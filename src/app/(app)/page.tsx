'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, Clock, Repeat, Landmark, Plus, ArrowUpRight, AlertTriangle, Wallet, Receipt,
} from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients, useProfile } from '@/lib/hooks';
import type { Expense, Invoice, Payment, RecurringProfile } from '@/lib/types';
import { financialYear, fmtDate, money, moneyShort, monthLabel, todayISO } from '@/lib/format';
import { Card, Loading, PageHeader, StatusPill } from '@/components/ui';

const MRR_FACTOR: Record<string, number> = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, weekly: 52 / 12 };

export default function Dashboard() {
  const { profile } = useProfile();
  const { clients } = useClients();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [retainers, setRetainers] = useState<RecurringProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fy = financialYear();
  const today = todayISO();

  useEffect(() => {
    (async () => {
      const [inv, pay, exp, rec] = await Promise.all([
        sb().from('invoices').select('*').eq('doc_type', 'invoice').order('invoice_date', { ascending: false }),
        sb().from('payments').select('*'),
        sb().from('expenses').select('*'),
        sb().from('recurring_profiles').select('*').eq('is_active', true),
      ]);
      setInvoices((inv.data ?? []) as Invoice[]);
      setPayments((pay.data ?? []) as Payment[]);
      setExpenses((exp.data ?? []) as Expense[]);
      setRetainers((rec.data ?? []) as RecurringProfile[]);
      setLoading(false);
    })();
  }, []);

  const live = useMemo(() => invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled'), [invoices]);
  const inFy = (d: string) => d >= fy.start && d <= fy.end;
  const fx = (v: number | string, rate: number | string) => Number(v) * (Number(rate) || 1);

  const revenue = live.filter((i) => inFy(i.invoice_date)).reduce((a, i) => a + fx(i.subtotal, i.exchange_rate), 0);
  const collected = payments.filter((p) => inFy(p.payment_date)).reduce((a, p) => a + fx(p.amount, p.exchange_rate), 0);
  const outstanding = live.reduce((a, i) => a + fx(i.balance_due, i.exchange_rate), 0);
  const overdueList = live.filter((i) => Number(i.balance_due) > 0.5 && i.due_date && i.due_date < today);
  const overdue = overdueList.reduce((a, i) => a + fx(i.balance_due, i.exchange_rate), 0);
  const spend = expenses.filter((e) => inFy(e.expense_date)).reduce((a, e) => a + fx(e.total_amount, e.exchange_rate), 0);
  const mrr = retainers.reduce((a, r) => a + Number(r.amount) * (MRR_FACTOR[r.frequency] ?? 1), 0);
  const tdsReceivable = live.filter((i) => i.tds_applicable && inFy(i.invoice_date))
    .reduce((a, i) => a + fx(i.tds_amount, i.exchange_rate), 0);

  // current GST period position
  const thisMonth = today.slice(0, 7);
  const gstOut = live.filter((i) => i.invoice_date.slice(0, 7) === thisMonth)
    .reduce((a, i) => a + fx(Number(i.cgst_total) + Number(i.sgst_total) + Number(i.igst_total), i.exchange_rate), 0);
  const gstItc = expenses.filter((e) => e.itc_eligible && e.expense_date.slice(0, 7) === thisMonth)
    .reduce((a, e) => a + fx(Number(e.cgst_amount) + Number(e.sgst_amount) + Number(e.igst_amount), e.exchange_rate), 0);
  const gstNet = Math.max(0, gstOut - gstItc);

  // 12-month series
  const series = useMemo(() => {
    const months: { key: string; billed: number; received: number }[] = [];
    const d = new Date(); d.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push({ key: dd.toISOString().slice(0, 7), billed: 0, received: 0 });
    }
    const idx = new Map(months.map((m, i) => [m.key, i]));
    live.forEach((i) => {
      const k = idx.get(i.invoice_date.slice(0, 7));
      if (k !== undefined) months[k].billed += fx(i.subtotal, i.exchange_rate);
    });
    payments.forEach((p) => {
      const k = idx.get(p.payment_date.slice(0, 7));
      if (k !== undefined) months[k].received += fx(p.amount, p.exchange_rate);
    });
    return months;
  }, [live, payments]);
  const peak = Math.max(1, ...series.map((m) => Math.max(m.billed, m.received)));

  const topClients = useMemo(() => {
    const m = new Map<string, number>();
    live.filter((i) => inFy(i.invoice_date)).forEach((i) => {
      if (!i.client_id) return;
      m.set(i.client_id, (m.get(i.client_id) ?? 0) + fx(i.subtotal, i.exchange_rate));
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, v]) => ({ name: clients.find((c) => c.id === id)?.company_name ?? '—', value: v }));
  }, [live, clients]);

  if (loading) return <Loading label="Crunching your numbers" />;

  const tiles = [
    { label: `Net revenue · ${fy.label}`, value: revenue, icon: TrendingUp, tone: 'text-white', sub: 'Taxable value, excluding GST' },
    { label: 'Outstanding', value: outstanding, icon: Clock, tone: outstanding > 0 ? 'text-amber-300' : 'text-emerald-300', sub: `${live.filter((i) => Number(i.balance_due) > 0.5).length} open invoices` },
    { label: 'MRR', value: mrr, icon: Repeat, tone: 'text-emerald-300', sub: `${retainers.length} active retainers · ARR ${moneyShort(mrr * 12)}` },
    { label: 'GST this month', value: gstNet, icon: Landmark, tone: 'text-blue-300', sub: `Output ${moneyShort(gstOut)} − ITC ${moneyShort(gstItc)}` },
  ];

  return (
    <>
      <PageHeader title={`${greeting()}, ${(profile?.contact_person ?? 'Akhil').split(' ')[0]}`}
        subtitle={`${profile?.legal_name ?? 'BuildableLabs LLP'} · ${fy.label} · ${profile?.gstin ?? ''}`}>
        <Link href="/invoices/new" className="btn-primary"><Plus size={15} /> New invoice</Link>
      </PageHeader>

      {/* ---------------- tiles ---------------- */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card px-5 py-4">
            <div className="flex items-start justify-between">
              <p className="label-mono">{t.label}</p>
              <t.icon size={15} className="text-chrome-dark" strokeWidth={1.6} />
            </div>
            <p className={`mt-2.5 kpi-value ${t.tone}`}>{moneyShort(t.value)}</p>
            <p className="mt-2 text-[11.5px] text-chrome-dark">{t.sub}</p>
          </div>
        ))}
      </div>

      {overdue > 0 && (
        <Link href="/invoices" className="mb-5 flex items-center gap-3 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-[13px] text-red-200 transition hover:border-red-800">
          <AlertTriangle size={16} className="shrink-0" />
          <span><strong>{money(overdue)}</strong> is overdue across {overdueList.length} invoice{overdueList.length > 1 ? 's' : ''}.</span>
          <ArrowUpRight size={15} className="ml-auto shrink-0" />
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 min-w-0">
          {/* ---------------- chart ---------------- */}
          <Card title="Billed vs received" subtitle="Last 12 months, converted to INR">
            <div className="flex h-[190px] items-end gap-1.5">
              {series.map((m) => (
                <div key={m.key} className="group flex flex-1 flex-col items-center gap-1">
                  <div className="relative flex h-[150px] w-full items-end justify-center gap-[3px]">
                    <div className="w-1/2 rounded-t bg-blue/70 transition-all group-hover:bg-blue"
                      style={{ height: `${Math.max(2, (m.billed / peak) * 100)}%` }} title={`Billed ${money(m.billed)}`} />
                    <div className="w-1/2 rounded-t bg-emerald-500/50 transition-all group-hover:bg-emerald-400"
                      style={{ height: `${Math.max(2, (m.received / peak) * 100)}%` }} title={`Received ${money(m.received)}`} />
                    <span className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-ink-600 px-2 py-1 text-[10.5px] text-white shadow-pop group-hover:block">
                      {moneyShort(m.billed)} · {moneyShort(m.received)}
                    </span>
                  </div>
                  <span className="text-[9.5px] text-chrome-dark">{monthLabel(m.key)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-5 border-t border-line pt-3 text-[11.5px] text-chrome">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-blue" /> Billed (ex-GST)</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-emerald-500/70" /> Received</span>
              <span className="ml-auto">Collected {fy.label}: <span className="font-mono text-white">{money(collected)}</span></span>
            </div>
          </Card>

          {/* ---------------- recent ---------------- */}
          <Card title="Recent invoices" bodyClass=""
            action={<Link href="/invoices" className="btn-subtle btn-xs">View all <ArrowUpRight size={13} /></Link>}>
            {invoices.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-chrome">No invoices yet — raise your first one, or ask the assistant below.</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {invoices.slice(0, 6).map((i) => (
                    <tr key={i.id} className="row-link">
                      <td className="td">
                        <Link href={`/invoices/${i.id}`} className="font-mono text-[13px] text-white">{i.invoice_number}</Link>
                      </td>
                      <td className="td max-w-[180px] truncate text-[12.5px] text-[#C9CEDA]">
                        {clients.find((c) => c.id === i.client_id)?.company_name ?? '—'}
                      </td>
                      <td className="td text-[12px] text-chrome">{fmtDate(i.invoice_date)}</td>
                      <td className="td"><StatusPill status={
                        i.status === 'sent' && i.due_date && i.due_date < today && Number(i.balance_due) > 0.5 ? 'overdue' : i.status} /></td>
                      <td className="td text-right font-mono tabular-nums text-[13px] text-white">{money(i.total, i.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* ---------------- rail ---------------- */}
        <div className="space-y-4">
          <Card title="Position this year">
            <dl className="space-y-2.5 text-[13px]">
              {[
                ['Billed (ex-GST)', money(revenue), 'text-white'],
                ['Collected', money(collected), 'text-emerald-300'],
                ['Expenses', money(spend), 'text-amber-300'],
                ['Net of expenses', money(revenue - spend), revenue - spend >= 0 ? 'text-white' : 'text-red-300'],
                ['TDS receivable', money(tdsReceivable), 'text-chrome-light'],
              ].map(([l, v, c]) => (
                <div key={l} className="flex justify-between">
                  <dt className="text-chrome">{l}</dt>
                  <dd className={`font-mono tabular-nums ${c}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3">
              <Link href="/expenses" className="btn-ghost btn-sm"><Receipt size={14} /> Expenses</Link>
              <Link href="/gst" className="btn-ghost btn-sm"><Landmark size={14} /> GST</Link>
            </div>
          </Card>

          {topClients.length > 0 && (
            <Card title="Top clients" subtitle={fy.label}>
              <div className="space-y-2.5">
                {topClients.map((c) => (
                  <div key={c.name}>
                    <div className="mb-1 flex justify-between text-[12.5px]">
                      <span className="truncate text-[#C9CEDA]">{c.name}</span>
                      <span className="ml-2 shrink-0 font-mono tabular-nums text-chrome">{moneyShort(c.value)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-500">
                      <div className="h-full rounded-full bg-chrome" style={{ width: `${Math.max(4, (c.value / (topClients[0].value || 1)) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {overdueList.length > 0 && (
            <Card title="Chase these" subtitle="Past due" bodyClass="">
              <ul className="divide-y divide-line">
                {overdueList.slice(0, 5).map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex items-center justify-between px-5 py-3 transition hover:bg-ink-600/60">
                      <div className="min-w-0">
                        <p className="font-mono text-[12.5px] text-white">{i.invoice_number}</p>
                        <p className="truncate text-[11.5px] text-chrome">
                          {clients.find((c) => c.id === i.client_id)?.company_name} · due {fmtDate(i.due_date)}
                        </p>
                      </div>
                      <span className="ml-2 shrink-0 font-mono text-[12.5px] text-red-300">{money(i.balance_due, i.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Quick actions">
            <div className="grid gap-2">
              <Link href="/invoices/new" className="btn-ghost w-full justify-start"><Plus size={14} /> Raise an invoice</Link>
              <Link href="/invoices/new?type=quote" className="btn-ghost w-full justify-start"><Plus size={14} /> Send a quote</Link>
              <Link href="/expenses" className="btn-ghost w-full justify-start"><Wallet size={14} /> Log an expense</Link>
              <Link href="/recurring" className="btn-ghost w-full justify-start"><Repeat size={14} /> Manage retainers</Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
