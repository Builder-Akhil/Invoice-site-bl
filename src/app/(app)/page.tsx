'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, Repeat, Landmark, Plus, ArrowUpRight, AlertTriangle, Wallet, Receipt,
  UsersRound, CreditCard, Fuel,
} from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients, useProfile } from '@/lib/hooks';
import type { Expense, Invoice, Payment, RecurringExpense, RecurringProfile, TeamMember } from '@/lib/types';
import { asComponents } from '@/lib/payroll';
import {
  booksSnapshot, fxInr, gstDueByMonth, lastNMonthKeys,
} from '@/lib/finance';
import { financialYear, fmtDate, fmtDateLong, money, moneyShort, monthLabel, todayISO } from '@/lib/format';
import { Card, Loading, PageHeader, StatusPill } from '@/components/ui';

const MRR_FACTOR: Record<string, number> = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, weekly: 52 / 12 };

export default function Dashboard() {
  const { profile } = useProfile();
  const { clients } = useClients();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [retainers, setRetainers] = useState<RecurringProfile[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [subs, setSubs] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);

  const fy = financialYear();
  const today = todayISO();

  useEffect(() => {
    (async () => {
      const [inv, pay, exp, rec, team, recExp] = await Promise.all([
        sb().from('invoices').select('*').eq('doc_type', 'invoice').order('invoice_date', { ascending: false }),
        sb().from('payments').select('*'),
        sb().from('expenses').select('*'),
        sb().from('recurring_profiles').select('*').eq('is_active', true),
        sb().from('team_members').select('*'),
        sb().from('recurring_expenses').select('*'),
      ]);
      setInvoices((inv.data ?? []) as Invoice[]);
      setPayments((pay.data ?? []) as Payment[]);
      setExpenses((exp.data ?? []) as Expense[]);
      setRetainers((rec.data ?? []) as RecurringProfile[]);
      setMembers(((team.data ?? []) as TeamMember[]).map((m) => ({ ...m, components: asComponents(m.components) })));
      setSubs((recExp.data ?? []) as RecurringExpense[]);
      setLoading(false);
    })();
  }, []);

  const live = useMemo(() => invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled'), [invoices]);
  const books = useMemo(() => booksSnapshot({
    invoices, expenses, members, subscriptions: subs,
    cashOnHand: profile?.cash_on_hand,
    fyStart: fy.start, fyEnd: fy.end,
  }), [invoices, expenses, members, subs, profile?.cash_on_hand, fy.start, fy.end]);

  const collected = payments.filter((p) => p.payment_date >= fy.start && p.payment_date <= fy.end)
    .reduce((a, p) => a + fxInr(p.amount, p.exchange_rate), 0);
  const outstanding = live.reduce((a, i) => a + fxInr(i.balance_due, i.exchange_rate), 0);
  const overdueList = live.filter((i) => Number(i.balance_due) > 0.5 && i.due_date && i.due_date < today);
  const overdue = overdueList.reduce((a, i) => a + fxInr(i.balance_due, i.exchange_rate), 0);
  const mrr = retainers.reduce((a, r) => a + Number(r.amount) * (MRR_FACTOR[r.frequency] ?? 1), 0);
  const tdsReceivable = live.filter((i) => i.tds_applicable && i.invoice_date >= fy.start && i.invoice_date <= fy.end)
    .reduce((a, i) => a + fxInr(i.tds_amount, i.exchange_rate), 0);

  const gstMap = useMemo(() => gstDueByMonth(invoices, expenses), [invoices, expenses]);

  const series = useMemo(() => {
    const keys = lastNMonthKeys(12);
    const months = keys.map((key) => ({ key, billed: 0, expense: 0, gst: gstMap.get(key) ?? 0, net: 0 }));
    const idx = new Map(months.map((m, i) => [m.key, i]));
    live.forEach((i) => {
      const k = idx.get(i.invoice_date.slice(0, 7));
      if (k !== undefined) months[k].billed += fxInr(i.subtotal, i.exchange_rate);
    });
    expenses.forEach((e) => {
      const k = idx.get(e.expense_date.slice(0, 7));
      if (k !== undefined) months[k].expense += fxInr(e.taxable_amount, e.exchange_rate);
    });
    months.forEach((m) => { m.net = m.billed - m.expense; });
    return months;
  }, [live, expenses, gstMap]);
  const peak = Math.max(1, ...series.map((m) => Math.max(m.billed, m.expense + m.gst, Math.abs(m.net))));

  const topClients = useMemo(() => {
    const m = new Map<string, number>();
    live.filter((i) => i.invoice_date >= fy.start && i.invoice_date <= fy.end).forEach((i) => {
      if (!i.client_id) return;
      m.set(i.client_id, (m.get(i.client_id) ?? 0) + fxInr(i.subtotal, i.exchange_rate));
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, v]) => ({ name: clients.find((c) => c.id === id)?.company_name ?? '—', value: v }));
  }, [live, clients, fy.start, fy.end]);

  if (loading) return <Loading label="Crunching your numbers" />;

  const { runway } = books;
  const runwayValue = runway.missingCash
    ? 'Set cash'
    : runway.months == null
      ? '—'
      : `${runway.months.toFixed(1)} mo`;
  const runwaySub = runway.missingCash
    ? 'Type cash on hand in Settings — like fuel remaining in the tanks'
    : runway.date
      ? `Until ${fmtDateLong(runway.date)} · burn ${moneyShort(runway.monthlyBurn)}/mo`
      : `Burn is ${moneyShort(runway.monthlyBurn)}/mo (payroll kit + subs + GST avg)`;

  const tiles = [
    { label: `Net revenue · ${fy.label}`, value: moneyShort(books.billed), icon: TrendingUp, tone: 'text-white', sub: 'Taxable billed, excluding GST' },
    { label: 'Net after expenses', value: moneyShort(books.netAfterExpenses), icon: Wallet, tone: books.netAfterExpenses >= 0 ? 'text-emerald-300' : 'text-red-300', sub: 'Billed − expense taxable (ex-GST)' },
    { label: 'Typical team burn', value: moneyShort(books.typicalPayroll), icon: UsersRound, tone: 'text-amber-300', sub: 'Active crew, every line at maximum' },
    { label: 'GST due this month', value: moneyShort(books.gstThisMonth), icon: Landmark, tone: 'text-blue-300', sub: 'On payments received, minus ITC' },
    { label: 'Runway', value: runwayValue, icon: Fuel, tone: runway.missingCash ? 'text-chrome' : 'text-white', sub: runwaySub, href: runway.missingCash ? '/settings' : undefined },
  ];

  return (
    <>
      <PageHeader title={`${greeting()}, ${(profile?.contact_person ?? 'Akhil').split(' ')[0]}`}
        subtitle={`${profile?.legal_name ?? 'BuildableLabs LLP'} · ${fy.label} · ${profile?.gstin ?? ''}`}>
        <Link href="/invoices/new" className="btn-primary"><Plus size={15} /> New invoice</Link>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map((t) => {
          const inner = (
            <>
              <div className="flex items-start justify-between">
                <p className="label-mono">{t.label}</p>
                <t.icon size={15} className="text-chrome-dark" strokeWidth={1.6} />
              </div>
              <p className={`mt-2.5 kpi-value text-[28px] xl:text-[30px] ${t.tone}`}>{t.value}</p>
              <p className="mt-2 text-[11.5px] leading-snug text-chrome-dark">{t.sub}</p>
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="card px-5 py-4 transition hover:border-chrome-dark">{inner}</Link>
          ) : (
            <div key={t.label} className="card px-5 py-4">{inner}</div>
          );
        })}
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
          <Card title="In, out, net (ex-GST)" subtitle="Last 12 months · Out stacks expense taxable + GST on payments received that month">
            <div className="flex h-[200px] items-end gap-1.5">
              {series.map((m) => {
                const out = m.expense + m.gst;
                return (
                  <div key={m.key} className="group flex flex-1 flex-col items-center gap-1">
                    <div className="relative flex h-[160px] w-full items-end justify-center gap-[2px]">
                      <div className="w-[28%] rounded-t bg-blue/70 transition-all group-hover:bg-blue"
                        style={{ height: `${Math.max(2, (m.billed / peak) * 100)}%` }} title={`In ${money(m.billed)}`} />
                      <div className="flex w-[28%] flex-col justify-end" style={{ height: `${Math.max(2, (out / peak) * 100)}%` }}
                        title={`Out ${money(out)} (expenses ${money(m.expense)} + GST ${money(m.gst)})`}>
                        <div className="rounded-t bg-violet-500/70" style={{ height: out ? `${(m.gst / out) * 100}%` : 0 }} />
                        <div className="bg-amber-500/70" style={{ height: out ? `${(m.expense / out) * 100}%` : '100%' }} />
                      </div>
                      <div className={`w-[28%] rounded-t transition-all ${m.net >= 0 ? 'bg-emerald-500/50 group-hover:bg-emerald-400' : 'bg-red-500/50 group-hover:bg-red-400'}`}
                        style={{ height: `${Math.max(2, (Math.abs(m.net) / peak) * 100)}%` }} title={`Net ${money(m.net)}`} />
                      <span className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-ink-600 px-2 py-1 text-[10.5px] text-white shadow-pop group-hover:block">
                        In {moneyShort(m.billed)} · Out {moneyShort(out)} · Net {moneyShort(m.net)}
                      </span>
                    </div>
                    <span className="text-[9.5px] text-chrome-dark">{monthLabel(m.key)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11.5px] text-chrome">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-blue" /> In (billed ex-GST)</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-amber-500/80" /> Expenses (ex-GST)</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-violet-500/80" /> GST due</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-emerald-500/70" /> Net after expenses</span>
              <span className="ml-auto">Collected {fy.label}: <span className="font-mono text-white">{money(collected)}</span></span>
            </div>
          </Card>

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

        <div className="space-y-4">
          <Card title="Position this year">
            <dl className="space-y-2.5 text-[13px]">
              {[
                ['Billed (ex-GST)', money(books.billed), 'text-white'],
                ['Collected', money(collected), 'text-emerald-300'],
                ['Expenses (ex-GST)', money(books.expenseTaxable), 'text-amber-300'],
                ['Net after expenses', money(books.netAfterExpenses), books.netAfterExpenses >= 0 ? 'text-white' : 'text-red-300'],
                ['Typical payroll kit', money(books.typicalPayroll), 'text-chrome-light'],
                ['Subscriptions / mo', money(books.subscriptionRunRate), 'text-chrome-light'],
                ['TDS receivable', money(tdsReceivable), 'text-chrome-light'],
                ['Outstanding', money(outstanding), outstanding > 0 ? 'text-amber-300' : 'text-chrome-light'],
              ].map(([l, v, c]) => (
                <div key={l} className="flex justify-between">
                  <dt className="text-chrome">{l}</dt>
                  <dd className={`font-mono tabular-nums ${c}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11.5px] leading-relaxed text-chrome-dark">
              Runway uses cash ÷ (full-kit payroll + subscription run-rate + trailing 3-month GST due avg
              {books.runway.recipe.gstAvg ? ` ${moneyShort(books.runway.recipe.gstAvg)}` : ''}).
            </p>
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
              <Link href="/team" className="btn-ghost w-full justify-start"><UsersRound size={14} /> Team payroll</Link>
              <Link href="/recurring-expenses" className="btn-ghost w-full justify-start"><CreditCard size={14} /> Subscriptions</Link>
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
