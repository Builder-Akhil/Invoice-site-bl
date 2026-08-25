'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Landmark, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients, useProfile } from '@/lib/hooks';
import { useListFilters } from '@/lib/list-filters';
import type { Expense, GstPayment, Invoice, Payment } from '@/lib/types';
import { downloadCSV, financialYear, fmtDate, money, moneyShort, todayISO } from '@/lib/format';
import {
  buildGstPacks, gstr1CsvRows, llpAccountLabel, packCsvRows, packSummaryText, type MonthPack, type PeriodType,
} from '@/lib/gst-compliance';
import {
  Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, toast, useConfirm, Spinner,
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
  const { values: filt, set } = useListFilters('gst', GST_FILTERS);
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

  const paidFor = (key: string) =>
    gstPayments.filter((g) => g.period === key)
      .reduce((a, g) => a + Number(g.igst_paid) + Number(g.cgst_paid) + Number(g.sgst_paid) + Number(g.interest) + Number(g.late_fee), 0);

  const ytd = packs.reduce((a, b) => ({
    output: a.output + b.totals.output,
    itc: a.itc + b.totals.itc,
    net: a.net + b.totals.netLlp,
    paid: a.paid + paidFor(b.key),
    taxable: a.taxable + b.totals.taxable,
    zero: a.zero + b.totals.zeroRated,
    share: a.share + b.totals.shareCount,
    outstanding: a.outstanding + b.issuedUnpaid.reduce((s, l) => s + l.tax, 0),
  }), { output: 0, itc: 0, net: 0, paid: 0, taxable: 0, zero: 0, share: 0, outstanding: 0 });

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
        subtitle="Monthly pack for the GST team. Government GST is only on payments received, paid from the LLP account.">
        <Select className="max-w-[150px]" value={fyStart} onChange={(e) => set('fy', e.target.value)}>
          {fyOptions.map((o) => <option key={o.start} value={o.start}>{o.label}</option>)}
        </Select>
        <button className="btn-primary" onClick={() => openRecord()}>
          <Plus size={15} /> Record GST payment
        </button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['GST on receipts', ytd.output, 'text-white'],
          ['Input tax credit', ytd.itc, 'text-emerald-300'],
          ['Net from LLP', ytd.net, 'text-amber-300'],
          ['Recorded as paid', ytd.paid, 'text-blue-300'],
        ].map(([l, v, c]) => (
          <div key={l as string} className="card px-4 py-3">
            <p className="label-mono">{l as string}</p>
            <p className={`mt-1.5 font-display text-[26px] leading-none ${c as string}`}>{moneyShort(v as number)}</p>
          </div>
        ))}
      </div>
      <p className="mb-5 text-[12.5px] text-chrome">
        FY receipts: {ytd.share} paid invoice{ytd.share === 1 ? '' : 's'} · taxable {money(ytd.taxable)}
        {ytd.zero > 0 ? ` · zero-rated ${money(ytd.zero)}` : ''}
        {ytd.outstanding > 0.5 ? ` · GST still on unpaid invoices ${money(ytd.outstanding)} (not this year’s Government payment until collected)` : ''}
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs active={periodType} onChange={(k) => set('cadence', k)}
          tabs={[{ key: 'monthly', label: 'Monthly (GSTR-3B)' }, { key: 'quarterly', label: 'Quarterly (QRMP)' }]} />
      </div>

      <Card bodyClass="" className="mb-5" title="Year at a glance"
        subtitle="Click a period to open the share pack. Output GST follows the payment date, not the invoice date.">
        {loading ? <Loading />
          : packs.length === 0 ? (
            <EmptyState icon={<Landmark size={18} />} title="Nothing to report yet"
              body="Once invoices are marked paid, they appear in the month the money landed." />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[980px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">Period</th>
                  <th className="th text-right">Share</th>
                  <th className="th text-right">Taxable collected</th>
                  <th className="th text-right">CGST</th><th className="th text-right">SGST</th>
                  <th className="th text-right">IGST</th><th className="th text-right">ITC</th>
                  <th className="th text-right">Net from LLP</th><th className="th text-right">Paid</th>
                  <th className="th">Status</th>
                </tr></thead>
                <tbody>
                  {packs.map((b) => {
                    const net = b.totals.netLlp; const paid = paidFor(b.key);
                    const settled = paid >= net - 1 && net > 0;
                    const active = b.key === selectedKey;
                    return (
                      <tr key={b.key} className={`row-link ${active ? 'bg-blue/10' : ''}`}
                        onClick={() => set('month', b.key)}>
                        <td className="td">
                          <span className="font-semibold text-white">{b.label}</span>
                          <span className="ml-2 font-mono text-[11px] text-chrome-dark">{b.key}</span>
                          {b.issuedUnpaid.length > 0 && (
                            <span className="mt-1 block text-[11px] text-chrome">
                              {b.issuedUnpaid.length} unpaid this period · hold
                            </span>
                          )}
                        </td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-white">{b.totals.shareCount}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-[#C9CEDA]">{money(b.totals.taxable)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(b.totals.cgst)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(b.totals.sgst)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(b.totals.igst)}</td>
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

      <Card title="Recorded GST payments" subtitle="Challans, ARNs and filing dates — cash that left the LLP account." bodyClass="">
        {gstPayments.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-chrome">Nothing recorded yet. Log each 3B payment so the ledger reconciles.</p>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[760px]">
              <thead><tr className="bg-ink-800/60">
                <th className="th">Period</th><th className="th">Return</th><th className="th">Paid on</th>
                <th className="th">Challan / ARN</th><th className="th text-right">IGST</th>
                <th className="th text-right">CGST</th><th className="th text-right">SGST</th>
                <th className="th text-right">Total</th><th className="th w-14"></th>
              </tr></thead>
              <tbody>
                {gstPayments.map((g) => (
                  <tr key={g.id} className="row-link">
                    <td className="td font-mono text-[12.5px] text-white">{g.period}</td>
                    <td className="td text-[12.5px] text-[#C9CEDA]">{g.return_type}</td>
                    <td className="td text-[12.5px] text-chrome">{fmtDate(g.paid_on)}</td>
                    <td className="td font-mono text-[11.5px] text-chrome">{g.challan_no || g.arn || '—'}</td>
                    <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(g.igst_paid)}</td>
                    <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(g.cgst_paid)}</td>
                    <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(g.sgst_paid)}</td>
                    <td className="td text-right font-mono tabular-nums text-[13px] text-white">{money(g.total_paid)}</td>
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
        title="Record a GST payment" subtitle={`Cash / credit ledger through ${llpAccountLabel(profile)}.`}
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
          <Field label="Filed on"><Input type="date" value={p.filed_on ?? ''} onChange={(e) => setP({ ...p, filed_on: e.target.value })} /></Field>
          <Field label="Paid on"><Input type="date" value={p.paid_on ?? ''} onChange={(e) => setP({ ...p, paid_on: e.target.value })} /></Field>
          <Field label="Challan number (CIN)"><Input className="input-mono" value={p.challan_no ?? ''} onChange={(e) => setP({ ...p, challan_no: e.target.value })} /></Field>
          <Field label="ARN"><Input className="input-mono" value={p.arn ?? ''} onChange={(e) => setP({ ...p, arn: e.target.value })} /></Field>
          <Field label="IGST paid"><Input type="number" step="0.01" className="input-mono" value={p.igst_paid ?? 0} onChange={(e) => setP({ ...p, igst_paid: Number(e.target.value) })} /></Field>
          <Field label="CGST paid"><Input type="number" step="0.01" className="input-mono" value={p.cgst_paid ?? 0} onChange={(e) => setP({ ...p, cgst_paid: Number(e.target.value) })} /></Field>
          <Field label="SGST paid"><Input type="number" step="0.01" className="input-mono" value={p.sgst_paid ?? 0} onChange={(e) => setP({ ...p, sgst_paid: Number(e.target.value) })} /></Field>
          <Field label="ITC utilised" hint="Offset from the credit ledger"><Input type="number" step="0.01" className="input-mono" value={p.itc_utilised ?? 0} onChange={(e) => setP({ ...p, itc_utilised: Number(e.target.value) })} /></Field>
          <Field label="Interest"><Input type="number" step="0.01" className="input-mono" value={p.interest ?? 0} onChange={(e) => setP({ ...p, interest: Number(e.target.value) })} /></Field>
          <Field label="Late fee"><Input type="number" step="0.01" className="input-mono" value={p.late_fee ?? 0} onChange={(e) => setP({ ...p, late_fee: Number(e.target.value) })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={p.notes ?? ''} onChange={(e) => setP({ ...p, notes: e.target.value })} /></Field>
        </div>
      </Modal>
      {confirmNode}
    </>
  );
}
