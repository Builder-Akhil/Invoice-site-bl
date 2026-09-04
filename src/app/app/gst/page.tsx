'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Landmark, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients, useProfile } from '@/lib/hooks';
import { useListFilters } from '@/lib/list-filters';
import type { Expense, GstPayment, Invoice, Payment } from '@/lib/types';
import { downloadCSV, financialYear, fmtDate, money, moneyShort, todayISO } from '@/lib/format';
import {
  buildGstPacks, fyStartForPeriodKey, gstr1CsvRows, llpAccountLabel, packCsvRows, packSummaryText, type MonthPack, type PeriodType,
} from '@/lib/gst-compliance';
import {
  Card, Collapse, EmptyState, Field, InfoHint, Input, Loading, Modal, PageHeader, Select, Tabs,
  Textarea, Tooltip, StatTile, toast, useConfirm, Spinner,
} from '@/components/ui';
import GstMonthPack, { copyPack } from '@/components/GstMonthPack';

const blankPayment = (period: string): Partial<GstPayment> => ({
  period, period_type: 'monthly', return_type: 'GSTR-3B', paid_on: todayISO(),
  igst_paid: 0, cgst_paid: 0, sgst_paid: 0, interest: 0, late_fee: 0, itc_utilised: 0, status: 'paid',
});

const GST_FILTERS = {
  cadence: 'monthly',
  fy: financialYear().start,
  month: todayISO().slice(0, 7),
};

/**
 * The explanations that used to sit in a wall of prose under the table. Each
 * one now hangs off the ⓘ next to the thing it explains, so the numbers get the
 * page and the teaching is one hover away.
 */
const TIPS = {
  collected: 'GST on invoices your clients have already paid. You do not owe tax on an invoice until the money lands.',
  claim: 'GST you already paid on company bills — Cursor, AWS, Adobe. Officially called input tax credit (ITC).',
  pay: 'Tax collected minus claim back. Pay this from the LLP bank account, never a personal one.',
  paid: 'Challans you have already logged against these periods.',
  unpaid: 'GST sitting on invoices nobody has paid yet. Not due until they do.',
  cadence: 'Most firms file monthly on GSTR-3B. Quarterly is the QRMP scheme, for smaller turnovers.',
  split: 'Same GST, split by whether the client is in your state (CGST + SGST) or another (IGST). The CSV keeps the split for your CA.',
  period: 'Pick any month — even a past one. If you missed sending August invoices to the CA, open August here in September and download the zip.',
};

export default function GstPage() {
  return (
    <Suspense fallback={<Loading />}>
      <GstInner />
    </Suspense>
  );
}

function GstInner() {
  const { clients } = useClients();
  const { profile } = useProfile();
  const { confirm, confirmNode } = useConfirm();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [gstPayments, setGstPayments] = useState<GstPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const { values: filt, set, patch } = useListFilters('gst', GST_FILTERS);
  const periodType = (filt.cadence === 'quarterly' ? 'quarterly' : 'monthly') as PeriodType;
  const fyStart = filt.fy;
  const selectedKey = filt.month;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState<Partial<GstPayment>>(blankPayment(todayISO().slice(0, 7)));

  const load = async () => {
    setLoading(true);
    const [inv, exp, gp, pay] = await Promise.all([
      sb().from('invoices').select('*').eq('doc_type', 'invoice').not('status', 'in', '("draft","cancelled")'),
      sb().from('expenses').select('*').eq('itc_eligible', true),
      sb().from('gst_payments').select('*').order('period', { ascending: false }),
      sb().from('payments').select('*'),
    ]);
    setInvoices((inv.data ?? []) as Invoice[]);
    setExpenses((exp.data ?? []) as Expense[]);
    setGstPayments((gp.data ?? []) as GstPayment[]);
    setPayments((pay.data ?? []) as Payment[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const fyEnd = useMemo(() => {
    const d = new Date(fyStart + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1); d.setDate(0);
    return d.toISOString().slice(0, 10);
  }, [fyStart]);

  const fyOptions = useMemo(() => {
    const now = new Date().getFullYear();
    return [0, 1, 2, 3].map((i) => {
      const y = now - i;
      return { start: `${y}-04-01`, label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` };
    });
  }, []);

  const packs = useMemo(() => buildGstPacks({
    invoices, expenses, payments, clients, fyStart, fyEnd, periodType,
  }), [invoices, expenses, payments, clients, fyStart, fyEnd, periodType]);

  useEffect(() => {
    if (!packs.length) return;
    if (packs.some((b) => b.key === selectedKey)) return;
    const withShare = [...packs].reverse().find((b) => b.share.length || b.zeroRated.length);
    set('month', withShare?.key ?? packs[packs.length - 1].key);
  }, [packs, selectedKey, periodType, fyStart, set]);

  const pack = packs.find((b) => b.key === selectedKey) ?? packs[packs.length - 1] ?? null;

  function selectPeriod(key: string) {
    if (/^\d{4}-\d{2}$/.test(key)) {
      patch({ month: key, fy: fyStartForPeriodKey(key) });
      return;
    }
    set('month', key);
  }

  const paidFor = (key: string) =>
    gstPayments.filter((g) => g.period === key)
      .reduce((a, g) => a + Number(g.igst_paid) + Number(g.cgst_paid) + Number(g.sgst_paid) + Number(g.interest) + Number(g.late_fee), 0);

  const ytd = packs.reduce((a, b) => ({
    output: a.output + b.totals.output,
    itc: a.itc + b.totals.itc,
    net: a.net + b.totals.netLlp,
    paid: a.paid + paidFor(b.key),
    zero: a.zero + b.totals.zeroRated,
    share: a.share + b.totals.shareCount,
    outstanding: a.outstanding + b.issuedUnpaid.reduce((s, l) => s + l.tax, 0),
  }), { output: 0, itc: 0, net: 0, paid: 0, zero: 0, share: 0, outstanding: 0 });

  function openRecord(from?: MonthPack) {
    const src = from ?? pack;
    const period = src?.key ?? todayISO().slice(0, 7);
    setP({
      ...blankPayment(period),
      period_type: periodType,
      igst_paid: src?.totals.igst ?? 0,
      cgst_paid: src?.totals.cgst ?? 0,
      sgst_paid: src?.totals.sgst ?? 0,
      itc_utilised: src?.totals.itc ?? 0,
      notes: src
        ? `Net ${money(src.totals.netLlp)} after ITC. Pay from ${llpAccountLabel(profile)}.`
        : '',
    });
    setOpen(true);
  }

  async function savePayment() {
    if (!p.period) return toast('Choose the period', 'error');
    setBusy(true);
    const total = Number(p.igst_paid ?? 0) + Number(p.cgst_paid ?? 0) + Number(p.sgst_paid ?? 0)
      + Number(p.cess_paid ?? 0) + Number(p.interest ?? 0) + Number(p.late_fee ?? 0);
    const payload = { ...p, period_type: periodType, total_paid: total };
    const id = payload.id; delete payload.id;
    const { error } = id
      ? await sb().from('gst_payments').update(payload).eq('id', id)
      : await sb().from('gst_payments').insert(payload);
    setBusy(false);
    if (error) return toast(error.message, 'error');
    toast('GST payment recorded'); setOpen(false); load();
  }

  async function removePayment(g: GstPayment) {
    if (!(await confirm(`Delete the ${g.return_type} record for ${g.period}?`))) return;
    await sb().from('gst_payments').delete().eq('id', g.id);
    toast('Removed'); load();
  }

  return (
    <>
      <PageHeader
        title="GST & Tax"
        hint="Tax you collected from clients, minus tax you can claim back on company bills. What is left is what you pay the Government — and only on invoices that have actually been paid."
        meta={[
          `${ytd.share} paid invoice${ytd.share === 1 ? '' : 's'}`,
          ytd.zero > 0 ? `exports ${moneyShort(ytd.zero)}` : null,
          ytd.outstanding > 0.5 ? `waiting on unpaid ${moneyShort(ytd.outstanding)}` : null,
        ].filter(Boolean) as string[]}>
        <Select className="max-w-[140px]" value={fyStart} onChange={(e) => set('fy', e.target.value)} aria-label="Financial year">
          {fyOptions.map((o) => <option key={o.start} value={o.start}>{o.label}</option>)}
        </Select>
        {periodType === 'monthly' ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="label-mono whitespace-nowrap">Month</span>
              <InfoHint tip={TIPS.period} side="bottom" />
            </span>
            <Input
              type="month"
              className="w-[10.75rem]"
              value={/^\d{4}-\d{2}$/.test(selectedKey) ? selectedKey : (pack?.key ?? '')}
              onChange={(e) => { if (e.target.value) selectPeriod(e.target.value); }}
              aria-label="Filing month"
              title={TIPS.period}
            />
          </div>
        ) : (
          <label className="flex items-center gap-2">
            <span className="label-mono whitespace-nowrap">Quarter</span>
            <Select className="w-[9.5rem]" value={selectedKey} onChange={(e) => set('month', e.target.value)} aria-label="Filing quarter">
              {packs.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </Select>
          </label>
        )}
        <button className="btn-primary" onClick={() => openRecord()}>
          <Plus size={15} /> Record payment
        </button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Tax collected" value={moneyShort(ytd.output)} hint={TIPS.collected} />
        <StatTile label="Claim back" value={moneyShort(ytd.itc)} tone="text-emerald-300" hint={TIPS.claim} />
        <StatTile label="Pay from company" value={moneyShort(ytd.net)} tone="text-amber-300" hint={TIPS.pay} />
        <StatTile label="Already paid" value={moneyShort(ytd.paid)} tone="text-blue-300" hint={TIPS.paid} />
      </div>

      <Card
        bodyClass=""
        className="mb-5"
        title="This year"
        hint={TIPS.cadence}
        subtitle="Pick a month above (or click a row). Download that month’s invoice PDFs as one zip for the CA — even if you are filing late."
        action={
          <Tabs active={periodType} onChange={(k) => set('cadence', k)}
            tabs={[{ key: 'monthly', label: 'Monthly' }, { key: 'quarterly', label: 'Quarterly' }]} />
        }>
        {loading ? <Loading />
          : packs.length === 0 ? (
            <EmptyState icon={<Landmark size={18} />} title="Nothing to report yet"
              body="When a client pays an invoice, that tax shows up in the month the money arrived." />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[700px]">
                <thead><tr className="bg-ink-800/50">
                  <th className="th">Period</th>
                  <th className="th text-right">Paid inv.</th>
                  <th className="th text-right">
                    <span className="inline-flex items-center gap-1.5">Tax in <InfoHint tip={TIPS.collected} side="bottom" /></span>
                  </th>
                  <th className="th text-right">
                    <span className="inline-flex items-center gap-1.5">Claim back <InfoHint tip={TIPS.claim} side="bottom" /></span>
                  </th>
                  <th className="th text-right">
                    <span className="inline-flex items-center gap-1.5">To pay <InfoHint tip={TIPS.pay} side="bottom" /></span>
                  </th>
                  <th className="th text-right">Paid</th>
                  <th className="th">Status</th>
                </tr></thead>
                <tbody>
                  {packs.map((b) => {
                    const net = b.totals.netLlp; const paid = paidFor(b.key);
                    const settled = paid >= net - 1 && net > 0;
                    const active = b.key === selectedKey;
                    return (
                      <tr key={b.key} className={`row-link ${active ? 'bg-blue/10' : ''}`}
                        onClick={() => selectPeriod(b.key)}>
                        <td className="td">
                          <span className="font-semibold text-white">{b.label}</span>
                          {b.issuedUnpaid.length > 0 && (
                            <Tooltip tip={TIPS.unpaid} side="right" className="ml-2 align-middle">
                              <span className="chip cursor-help !py-0 text-[10px]">{b.issuedUnpaid.length} unpaid</span>
                            </Tooltip>
                          )}
                        </td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-white">{b.totals.shareCount}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-[#C9CEDA]">{money(b.totals.output)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-emerald-300">{money(b.totals.itc)}</td>
                        <td className="td text-right font-mono tabular-nums text-[13px] font-semibold text-white">{money(net)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-blue-300">{paid ? money(paid) : '—'}</td>
                        <td className="td">
                          {net <= 0.5 ? <span className="pill bg-ink-400 text-chrome-dark">Nil</span>
                            : settled ? <span className="pill bg-emerald-500/15 text-emerald-300"><CheckCircle2 size={11} /> Settled</span>
                            : <span className="pill bg-amber-500/15 text-amber-300"><AlertTriangle size={11} /> Due</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {pack && !loading && (
        <div className="mb-5">
          <GstMonthPack
            pack={pack}
            profile={profile}
            onCopy={() => copyPack(packSummaryText(pack, profile))}
            onCsv={() => downloadCSV(`GST-pack-${pack.key}.csv`, packCsvRows(pack))}
            onGstr1={() => downloadCSV(`GSTR1-${pack.key}.csv`, gstr1CsvRows(pack, clients))}
            onRecord={() => openRecord(pack)}
          />
        </div>
      )}

      <Card
        title="Challans logged"
        hint="Recorded after your CA files. Keeping the CIN and ARN here is what turns a period green."
        bodyClass="">
        {gstPayments.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-chrome">Nothing recorded yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[620px]">
              <thead><tr className="bg-ink-800/50">
                <th className="th">Period</th><th className="th">Return</th><th className="th">Paid on</th>
                <th className="th">Challan / ARN</th>
                <th className="th text-right">
                  <span className="inline-flex items-center gap-1.5">Tax paid <InfoHint tip={TIPS.split} side="bottom" /></span>
                </th>
                <th className="th w-14"></th>
              </tr></thead>
              <tbody>
                {gstPayments.map((g) => (
                  <tr key={g.id} className="row-link">
                    <td className="td font-mono text-[12.5px] text-white">{g.period}</td>
                    <td className="td text-[12.5px] text-[#C9CEDA]">{g.return_type}</td>
                    <td className="td text-[12.5px] text-chrome">{fmtDate(g.paid_on)}</td>
                    <td className="td font-mono text-[11.5px] text-chrome">{g.challan_no || g.arn || '—'}</td>
                    <td className="td text-right">
                      {/* The IGST/CGST/SGST split is a CA detail — one hover away, not four columns. */}
                      <Tooltip
                        side="left"
                        tip={
                          <span className="block space-y-0.5">
                            <span className="block">IGST {money(g.igst_paid)}</span>
                            <span className="block">CGST {money(g.cgst_paid)}</span>
                            <span className="block">SGST {money(g.sgst_paid)}</span>
                            {Number(g.interest) > 0 && <span className="block">Interest {money(g.interest)}</span>}
                            {Number(g.late_fee) > 0 && <span className="block">Late fee {money(g.late_fee)}</span>}
                          </span>
                        }>
                        <span className="cursor-help border-b border-dotted border-chrome-dark font-mono tabular-nums text-[13px] text-white">
                          {money(g.total_paid)}
                        </span>
                      </Tooltip>
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="btn-subtle btn-xs" onClick={() => { setP({ ...g }); setOpen(true); }}>Edit</button>
                        <button className="btn-subtle btn-xs text-red-400" onClick={() => removePayment(g)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} width="max-w-2xl"
        title="Record a GST payment" subtitle={`Paid from ${llpAccountLabel(profile)}.`}
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={savePayment} disabled={busy}>{busy ? <Spinner /> : 'Save record'}</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Period" required hint={periodType === 'monthly' ? 'Format 2026-08' : 'Format 2026-Q2'}>
            <Input className="input-mono" value={p.period ?? ''} onChange={(e) => setP({ ...p, period: e.target.value })} />
          </Field>
          <Field label="Return type">
            <Select value={p.return_type} onChange={(e) => setP({ ...p, return_type: e.target.value })}>
              {['GSTR-3B', 'GSTR-1', 'GSTR-9', 'DRC-03', 'CMP-08'].map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label="Paid on"><Input type="date" value={p.paid_on ?? ''} onChange={(e) => setP({ ...p, paid_on: e.target.value })} /></Field>
          <Field label="Challan number (CIN)" tip="From the payment receipt on the GST portal.">
            <Input className="input-mono" value={p.challan_no ?? ''} onChange={(e) => setP({ ...p, challan_no: e.target.value })} />
          </Field>
          <Field label="IGST paid"><Input type="number" step="0.01" className="input-mono" value={p.igst_paid ?? 0} onChange={(e) => setP({ ...p, igst_paid: Number(e.target.value) })} /></Field>
          <Field label="CGST paid"><Input type="number" step="0.01" className="input-mono" value={p.cgst_paid ?? 0} onChange={(e) => setP({ ...p, cgst_paid: Number(e.target.value) })} /></Field>
          <Field label="SGST paid"><Input type="number" step="0.01" className="input-mono" value={p.sgst_paid ?? 0} onChange={(e) => setP({ ...p, sgst_paid: Number(e.target.value) })} /></Field>
        </div>

        {/* Six fields most months never need — folded away rather than deleted. */}
        <Collapse title="Credits, penalties and references" note="optional" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ITC utilised" tip="Credit offset from the ledger. This is not cash leaving the bank.">
              <Input type="number" step="0.01" className="input-mono" value={p.itc_utilised ?? 0} onChange={(e) => setP({ ...p, itc_utilised: Number(e.target.value) })} />
            </Field>
            <Field label="ARN" tip="Acknowledgement Reference Number from the filed return.">
              <Input className="input-mono" value={p.arn ?? ''} onChange={(e) => setP({ ...p, arn: e.target.value })} />
            </Field>
            <Field label="Filed on"><Input type="date" value={p.filed_on ?? ''} onChange={(e) => setP({ ...p, filed_on: e.target.value })} /></Field>
            <Field label="Interest"><Input type="number" step="0.01" className="input-mono" value={p.interest ?? 0} onChange={(e) => setP({ ...p, interest: Number(e.target.value) })} /></Field>
            <Field label="Late fee"><Input type="number" step="0.01" className="input-mono" value={p.late_fee ?? 0} onChange={(e) => setP({ ...p, late_fee: Number(e.target.value) })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={p.notes ?? ''} onChange={(e) => setP({ ...p, notes: e.target.value })} /></Field>
          </div>
        </Collapse>
      </Modal>
      {confirmNode}
    </>
  );
}
