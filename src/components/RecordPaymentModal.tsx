'use client';
import { useEffect, useMemo, useState } from 'react';
import { sb } from '@/lib/supabase/client';
import { logActivity } from '@/lib/invoice-service';
import type { Invoice, Payment } from '@/lib/types';
import { PAYMENT_MODES } from '@/lib/types';
import { invoiceSettlement } from '@/lib/payments';
import { money, todayISO } from '@/lib/format';
import { Field, Input, Modal, Select, Spinner, toast } from '@/components/ui';

const blank = {
  payment_date: todayISO(),
  amount: 0,
  mode: 'bank_transfer',
  reference: '',
  tds_deducted: 0,
  bank_charges: 0,
  notes: '',
};

export default function RecordPaymentModal({
  invoice, open, onClose, onSaved,
}: {
  invoice: Invoice | null;
  open: boolean;
  onClose: () => void;
  onSaved: (invoice: Invoice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pay, setPay] = useState(blank);

  useEffect(() => {
    if (!open || !invoice) return;
    let alive = true;
    sb().from('payments').select('*').eq('invoice_id', invoice.id).then(({ data }) => {
      if (!alive) return;
      const rows = (data ?? []) as Payment[];
      setPayments(rows);
      const s = invoiceSettlement(invoice, rows);
      setPay({
        ...blank,
        payment_date: todayISO(),
        amount: s.remainingBank || s.remaining,
        tds_deducted: s.remainingTds,
      });
    });
    return () => { alive = false; };
  }, [open, invoice]);

  const s = useMemo(() => (invoice ? invoiceSettlement(invoice, payments) : null), [invoice, payments]);
  const thisSettles = r2safe(pay.amount) + r2safe(pay.tds_deducted) + r2safe(pay.bank_charges);
  const remainingAfter = s ? r2safe(s.remaining - thisSettles) : 0;

  async function save() {
    if (!invoice) return;
    if (!pay.amount && !pay.tds_deducted) return toast('Enter the amount that landed in the bank (or the TDS withheld)', 'error');
    setBusy(true);
    const { error } = await sb().from('payments').insert({
      invoice_id: invoice.id,
      client_id: invoice.client_id,
      currency: invoice.currency,
      exchange_rate: invoice.exchange_rate,
      payment_date: pay.payment_date,
      amount: Number(pay.amount) || 0,
      mode: pay.mode,
      reference: pay.reference || null,
      tds_deducted: Number(pay.tds_deducted) || 0,
      bank_charges: Number(pay.bank_charges) || 0,
      notes: pay.notes || null,
    });
    if (error) { setBusy(false); return toast(error.message, 'error'); }
    await logActivity('payment', invoice.id, 'recorded', `${money(pay.amount, invoice.currency)} via ${pay.mode}`);
    const { data } = await sb().from('invoices').select('*').eq('id', invoice.id).single();
    setBusy(false);
    toast(remainingAfter <= 0.5 ? `${invoice.invoice_number} recorded and marked paid` : 'Payment recorded');
    onClose();
    if (data) onSaved(data as Invoice);
  }

  if (!open || !invoice || !s) return null;

  return (
    <Modal open={open} onClose={onClose} title="Record a payment" width="max-w-lg"
      subtitle={`${invoice.invoice_number} · match this against the LLP bank statement`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save payment'}</button>
      </>}>
      <div className="mb-4 rounded-xl border border-line bg-ink-800/60 px-3.5 py-3 text-[12.5px]">
        <div className="flex justify-between gap-3"><span className="text-chrome">Invoice total</span><span className="font-mono text-white">{money(s.total, invoice.currency)}</span></div>
        {s.tdsDue > 0 && (
          <div className="mt-1 flex justify-between gap-3"><span className="text-chrome">TDS (client withholds)</span><span className="font-mono text-chrome">{money(s.tdsDue, invoice.currency)}</span></div>
        )}
        <div className="mt-1 flex justify-between gap-3"><span className="text-chrome">Net expected in bank</span><span className="font-mono font-semibold text-amber-300">{money(s.netExpected, invoice.currency)}</span></div>
        {s.bank > 0 && (
          <div className="mt-1 flex justify-between gap-3"><span className="text-chrome">Already received</span><span className="font-mono text-emerald-300">{money(s.bank, invoice.currency)}</span></div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount received in bank" required hint="The credit on the LLP statement">
          <Input type="number" step="0.01" className="input-mono" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} />
        </Field>
        <Field label="Payment date"><Input type="date" value={pay.payment_date} onChange={(e) => setPay({ ...pay, payment_date: e.target.value })} /></Field>
        <Field label="Mode">
          <Select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
            {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Reference / UTR"><Input className="input-mono" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
        <Field label="TDS withheld by client" hint="Counts toward settling the invoice; for 26AS">
          <Input type="number" step="0.01" className="input-mono" value={pay.tds_deducted} onChange={(e) => setPay({ ...pay, tds_deducted: Number(e.target.value) })} />
        </Field>
        <Field label="Bank charges" hint="Deducted on inward wires — still counts as paid">
          <Input type="number" step="0.01" className="input-mono" value={pay.bank_charges} onChange={(e) => setPay({ ...pay, bank_charges: Number(e.target.value) })} />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} /></Field>
      </div>

      <p className="mt-4 rounded-lg border border-line bg-ink-800/60 px-3 py-2 text-[11.5px] leading-relaxed text-chrome">
        This receipt settles {money(thisSettles, invoice.currency)}.
        Remaining after save: {money(Math.max(0, remainingAfter), invoice.currency)}.
        {remainingAfter <= 0.5
          ? ' The invoice will be marked paid, and this row appears under Payments on the invoice.'
          : ' Status will be part-paid until the rest lands.'}
      </p>
    </Modal>
  );
}

function r2safe(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
