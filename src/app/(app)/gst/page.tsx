'use client';
import { useEffect, useMemo, useState } from 'react';
import { Landmark, Plus, Download, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients } from '@/lib/hooks';
import type { Expense, GstPayment, Invoice } from '@/lib/types';
import { downloadCSV, financialYear, fmtDate, money, moneyShort, monthLabel, quarterOf, todayISO } from '@/lib/format';
import {
  Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, toast, useConfirm, Spinner,
} from '@/components/ui';

interface Bucket {
  key: string; label: string;
  taxable: number; cgst: number; sgst: number; igst: number; zeroRated: number;
  itcCgst: number; itcSgst: number; itcIgst: number;
  invoices: Invoice[];
}

const emptyBucket = (key: string, label: string): Bucket => ({
  key, label, taxable: 0, cgst: 0, sgst: 0, igst: 0, zeroRated: 0,
  itcCgst: 0, itcSgst: 0, itcIgst: 0, invoices: [],
});

const blankPayment = (period: string): Partial<GstPayment> => ({
  period, period_type: 'monthly', return_type: 'GSTR-3B', paid_on: todayISO(),
  igst_paid: 0, cgst_paid: 0, sgst_paid: 0, interest: 0, late_fee: 0, itc_utilised: 0, status: 'paid',
});

export default function GstPage() {
  const { clients } = useClients();
  const { confirm, confirmNode } = useConfirm();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [gstPayments, setGstPayments] = useState<GstPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodType, setPeriodType] = useState<'monthly' | 'quarterly'>('monthly');
  const [fyStart, setFyStart] = useState(financialYear().start);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState<Partial<GstPayment>>(blankPayment(todayISO().slice(0, 7)));
  const [detail, setDetail] = useState<Bucket | null>(null);

  const load = async () => {
    setLoading(true);
    const [inv, exp, gp] = await Promise.all([
      sb().from('invoices').select('*').eq('doc_type', 'invoice').not('status', 'in', '("draft","cancelled")'),
      sb().from('expenses').select('*').eq('itc_eligible', true),
      sb().from('gst_payments').select('*').order('period', { ascending: false }),
    ]);
    setInvoices((inv.data ?? []) as Invoice[]);
    setExpenses((exp.data ?? []) as Expense[]);
    setGstPayments((gp.data ?? []) as GstPayment[]);
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

  const keyOf = (iso: string) => periodType === 'monthly' ? iso.slice(0, 7) : quarterOf(iso).key;
  const labelOf = (iso: string) => periodType === 'monthly' ? monthLabel(iso.slice(0, 7)) : quarterOf(iso).label;

  const buckets = useMemo(() => {
    const m = new Map<string, Bucket>();
    const inRange = (d: string) => d >= fyStart && d <= fyEnd;

    invoices.filter((i) => inRange(i.invoice_date)).forEach((i) => {
      const k = keyOf(i.invoice_date);
      const b = m.get(k) ?? emptyBucket(k, labelOf(i.invoice_date));
      const fx = Number(i.exchange_rate) || 1;
      const zero = i.tax_mode === 'export_lut' || i.tax_mode === 'exempt';
      if (zero) b.zeroRated += Number(i.subtotal) * fx;
      else b.taxable += Number(i.subtotal) * fx;
      b.cgst += Number(i.cgst_total) * fx;
      b.sgst += Number(i.sgst_total) * fx;
      b.igst += Number(i.igst_total) * fx;
      b.invoices.push(i);
      m.set(k, b);
    });

    expenses.filter((e) => inRange(e.expense_date)).forEach((e) => {
      const k = keyOf(e.expense_date);
      const b = m.get(k) ?? emptyBucket(k, labelOf(e.expense_date));
      const fx = Number(e.exchange_rate) || 1;
      b.itcCgst += Number(e.cgst_amount) * fx;
      b.itcSgst += Number(e.sgst_amount) * fx;
      b.itcIgst += Number(e.igst_amount) * fx;
      m.set(k, b);
    });

    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [invoices, expenses, fyStart, fyEnd, periodType]);

  const paidFor = (key: string) =>
    gstPayments.filter((g) => g.period === key)
      .reduce((a, g) => a + Number(g.igst_paid) + Number(g.cgst_paid) + Number(g.sgst_paid) + Number(g.interest) + Number(g.late_fee), 0);

  const netOf = (b: Bucket) =>
    Math.max(0, (b.cgst + b.sgst + b.igst) - (b.itcCgst + b.itcSgst + b.itcIgst));

  const ytd = buckets.reduce((a, b) => ({
    output: a.output + b.cgst + b.sgst + b.igst,
    itc: a.itc + b.itcCgst + b.itcSgst + b.itcIgst,
    net: a.net + netOf(b),
    paid: a.paid + paidFor(b.key),
    taxable: a.taxable + b.taxable,
    zero: a.zero + b.zeroRated,
  }), { output: 0, itc: 0, net: 0, paid: 0, taxable: 0, zero: 0 });

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

  function exportGstr1(b: Bucket) {
    const rows: (string | number | null)[][] = [[
      'GSTIN of recipient', 'Receiver name', 'Invoice number', 'Invoice date', 'Invoice value',
      'Place of supply', 'Reverse charge', 'Invoice type', 'Rate', 'Taxable value',
      'CGST', 'SGST', 'IGST', 'Cess',
    ]];
    b.invoices.forEach((i) => {
      const c = clients.find((x) => x.id === i.client_id);
      const fx = Number(i.exchange_rate) || 1;
      rows.push([
        c?.gstin ?? '', c?.company_name ?? '', i.invoice_number, i.invoice_date,
        (Number(i.total) * fx).toFixed(2),
        `${i.place_of_supply_code}-${i.place_of_supply}`,
        i.reverse_charge ? 'Y' : 'N',
        i.tax_mode === 'export_lut' ? 'Export without payment'
          : i.tax_mode === 'export_paid' ? 'Export with payment'
          : c?.gstin ? 'Regular B2B' : 'B2C',
        (i.invoice_items?.[0]?.gst_rate ?? 18),
        (Number(i.subtotal) * fx).toFixed(2),
        (Number(i.cgst_total) * fx).toFixed(2),
        (Number(i.sgst_total) * fx).toFixed(2),
        (Number(i.igst_total) * fx).toFixed(2), '0.00',
      ]);
    });
    downloadCSV(`GSTR1-${b.key}.csv`, rows);
  }

  return (
    <>
      <PageHeader title="GST & Tax" subtitle="Output tax, input credit and what you actually owe — period by period.">
        <Select className="max-w-[150px]" value={fyStart} onChange={(e) => setFyStart(e.target.value)}>
          {fyOptions.map((o) => <option key={o.start} value={o.start}>{o.label}</option>)}
        </Select>
        <button className="btn-primary" onClick={() => { setP(blankPayment(buckets[buckets.length - 1]?.key ?? todayISO().slice(0, 7))); setOpen(true); }}>
          <Plus size={15} /> Record GST payment
        </button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Output tax', ytd.output, 'text-white'],
          ['Input tax credit', ytd.itc, 'text-emerald-300'],
          ['Net liability', ytd.net, 'text-amber-300'],
          ['Recorded as paid', ytd.paid, 'text-blue-300'],
        ].map(([l, v, c]) => (
          <div key={l as string} className="card px-4 py-3">
            <p className="label-mono">{l as string}</p>
            <p className={`mt-1.5 font-display text-[26px] leading-none ${c as string}`}>{moneyShort(v as number)}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs active={periodType} onChange={(k) => setPeriodType(k as 'monthly' | 'quarterly')}
          tabs={[{ key: 'monthly', label: 'Monthly (GSTR-3B)' }, { key: 'quarterly', label: 'Quarterly (QRMP)' }]} />
        <p className="text-[12px] text-chrome">
          Taxable outward {money(ytd.taxable)} · Zero-rated exports {money(ytd.zero)}
        </p>
      </div>

      <Card bodyClass="" className="mb-5">
        {loading ? <Loading />
          : buckets.length === 0 ? (
            <EmptyState icon={<Landmark size={18} />} title="Nothing to report yet"
              body="Once invoices are marked sent or paid in this financial year, your GST position appears here." />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[900px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">Period</th><th className="th text-right">Taxable</th>
                  <th className="th text-right">CGST</th><th className="th text-right">SGST</th>
                  <th className="th text-right">IGST</th><th className="th text-right">ITC</th>
                  <th className="th text-right">Net payable</th><th className="th text-right">Paid</th>
                  <th className="th">Status</th><th className="th w-24"></th>
                </tr></thead>
                <tbody>
                  {buckets.map((b) => {
                    const net = netOf(b); const paid = paidFor(b.key);
                    const settled = paid >= net - 1 && net > 0;
                    return (
                      <tr key={b.key} className="row-link">
                        <td className="td">
                          <span className="font-semibold text-white">{b.label}</span>
                          <span className="ml-2 font-mono text-[11px] text-chrome-dark">{b.key}</span>
                          {b.zeroRated > 0 && <span className="mt-1 block text-[11px] text-chrome">Exports {money(b.zeroRated)}</span>}
                        </td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-[#C9CEDA]">{money(b.taxable)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(b.cgst)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(b.sgst)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(b.igst)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-emerald-300">{money(b.itcCgst + b.itcSgst + b.itcIgst)}</td>
                        <td className="td text-right font-mono tabular-nums text-[13px] font-semibold text-white">{money(net)}</td>
                        <td className="td text-right font-mono tabular-nums text-[12.5px] text-blue-300">{paid ? money(paid) : '—'}</td>
                        <td className="td">
                          {net <= 0.5 ? <span className="pill bg-ink-400 text-chrome-dark">Nil</span>
                            : settled ? <span className="pill bg-emerald-500/15 text-emerald-300"><CheckCircle2 size={11} /> Settled</span>
                            : <span className="pill bg-amber-500/15 text-amber-300"><AlertTriangle size={11} /> Due</span>}
                        </td>
                        <td className="td">
                          <div className="flex justify-end gap-1">
                            <button className="btn-subtle btn-xs" title="Invoice detail" onClick={() => setDetail(b)}>View</button>
                            <button className="btn-subtle btn-xs" title="GSTR-1 CSV" onClick={() => exportGstr1(b)}><Download size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Card title="Recorded GST payments" subtitle="Challans, ARNs and filing dates — your audit trail." bodyClass="">
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

      {/* -------- record payment -------- */}
      <Modal open={open} onClose={() => setOpen(false)} width="max-w-2xl"
        title="Record a GST payment" subtitle="What actually went out through the cash / credit ledger."
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

      {/* -------- period detail -------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} width="max-w-3xl"
        title={detail ? `${detail.label} — invoice detail` : ''}
        subtitle="What feeds GSTR-1 for this period."
        footer={detail ? <button className="btn-ghost" onClick={() => exportGstr1(detail)}><Download size={15} /> Download GSTR-1 CSV</button> : null}>
        {detail && (
          <div className="scroll-x">
            <table className="w-full min-w-[620px]">
              <thead><tr className="bg-ink-800/60">
                <th className="th">Invoice</th><th className="th">Client</th><th className="th">GSTIN</th>
                <th className="th text-right">Taxable</th><th className="th text-right">Tax</th><th className="th text-right">Total</th>
              </tr></thead>
              <tbody>
                {detail.invoices.map((i) => {
                  const c = clients.find((x) => x.id === i.client_id);
                  const fx = Number(i.exchange_rate) || 1;
                  return (
                    <tr key={i.id}>
                      <td className="td font-mono text-[12.5px] text-white">{i.invoice_number}</td>
                      <td className="td text-[12.5px] text-[#C9CEDA]">{c?.company_name ?? '—'}</td>
                      <td className="td font-mono text-[11.5px] text-chrome">{c?.gstin || (i.tax_mode.startsWith('export') ? 'Export' : 'B2C')}</td>
                      <td className="td text-right font-mono tabular-nums text-[12.5px]">{money(Number(i.subtotal) * fx)}</td>
                      <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">{money(Number(i.tax_total) * fx)}</td>
                      <td className="td text-right font-mono tabular-nums text-[13px] text-white">{money(Number(i.total) * fx)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      {confirmNode}
    </>
  );
}
