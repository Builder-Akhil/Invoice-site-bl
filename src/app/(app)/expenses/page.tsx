'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Plus, Receipt, Pencil, Trash2, Search, Download } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients } from '@/lib/hooks';
import { useListFilters } from '@/lib/list-filters';
import { EXPENSE_CATEGORIES, PAYMENT_MODES, type Expense } from '@/lib/types';
import { GST_RATES } from '@/lib/gst';
import { CURRENCIES, downloadCSV, financialYear, fmtDate, money, moneyShort, todayISO } from '@/lib/format';
import { quoteInr, patchUnconvertedRates, rateLooksUnconverted } from '@/lib/fx';
import { FxRateField } from '@/components/FxRateField';
import {
  Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, toast, useConfirm, Spinner,
} from '@/components/ui';

type Split = 'igst' | 'cgst_sgst' | 'none';

const fy0 = financialYear();
const EXPENSE_FILTERS = { q: '', from: fy0.start, to: fy0.end };

const blank = (): Partial<Expense> & { split: Split } => ({
  expense_date: todayISO(), vendor_name: '', category: 'Software & Subscriptions',
  taxable_amount: 0, gst_rate: 18, itc_eligible: true, currency: 'INR', exchange_rate: 1,
  payment_mode: 'bank_transfer', split: 'igst', is_reverse_charge: false,
});

export default function ExpensesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ExpensesInner />
    </Suspense>
  );
}

function ExpensesInner() {
  const { clients } = useClients();
  const { confirm, confirmNode } = useConfirm();
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Partial<Expense> & { split: Split }>(blank());
  const fy = financialYear();
  const { values: filt, set, patch } = useListFilters('expenses', EXPENSE_FILTERS);
  const q = filt.q;
  const from = filt.from;
  const to = filt.to;

  const load = async () => {
    setLoading(true);
    const { data } = await sb().from('expenses').select('*').order('expense_date', { ascending: false });
    let list = (data ?? []) as Expense[];
    try {
      list = await patchUnconvertedRates(
        list,
        (r) => r.expense_date,
        async (id, rate) => { await sb().from('expenses').update({ exchange_rate: rate }).eq('id', id); },
      );
    } catch { /* keep stored rates if FX is down */ }
    setRows(list); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (from && r.expense_date < from) return false;
      if (to && r.expense_date > to) return false;
      if (!s) return true;
      return [r.vendor_name, r.category, r.description, r.bill_number].some((v) => (v ?? '').toLowerCase().includes(s));
    });
  }, [rows, q, from, to]);

  const inr = (r: Expense, v: number) => v * (Number(r.exchange_rate) || 1);
  const totalSpend = filtered.reduce((a, r) => a + inr(r, Number(r.total_amount)), 0);
  const itc = filtered.filter((r) => r.itc_eligible)
    .reduce((a, r) => a + inr(r, Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount)), 0);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => m.set(r.category, (m.get(r.category) ?? 0) + inr(r, Number(r.total_amount))));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [filtered]);

  function computed(v: Partial<Expense> & { split: Split }) {
    const taxable = Number(v.taxable_amount) || 0;
    const rate = v.split === 'none' ? 0 : Number(v.gst_rate) || 0;
    const igst = v.split === 'igst' ? +(taxable * rate / 100).toFixed(2) : 0;
    const half = v.split === 'cgst_sgst' ? +(taxable * rate / 200).toFixed(2) : 0;
    return { igst, cgst: half, sgst: half, total: +(taxable + igst + half * 2).toFixed(2) };
  }
  const calc = computed(f);

  async function save() {
    if (!f.vendor_name?.trim()) return toast('Vendor name is required', 'error');
    setBusy(true);
    const { split, ...rest } = f;
    const c = computed(f);
    const currency = rest.currency || 'INR';
    let exchange_rate = currency === 'INR' ? 1 : Number(rest.exchange_rate ?? 1);
    if (rateLooksUnconverted(currency, exchange_rate)) {
      try { exchange_rate = (await quoteInr(currency, rest.expense_date)).rate; }
      catch { /* keep typed rate */ }
    }
    const payload = {
      ...rest, currency, exchange_rate,
      gst_rate: split === 'none' ? 0 : rest.gst_rate,
      cgst_amount: c.cgst, sgst_amount: c.sgst, igst_amount: c.igst, total_amount: c.total,
    };
    const id = payload.id; delete payload.id;
    const { error } = id
      ? await sb().from('expenses').update(payload).eq('id', id)
      : await sb().from('expenses').insert(payload);
    setBusy(false);
    if (error) return toast(error.message, 'error');
    toast(id ? 'Expense updated' : 'Expense added'); setOpen(false); load();
  }

  async function remove(r: Expense) {
    if (!(await confirm(`Delete the ${money(r.total_amount, r.currency)} expense from ${r.vendor_name}?`))) return;
    await sb().from('expenses').delete().eq('id', r.id);
    toast('Deleted'); load();
  }

  const exportCsv = () => downloadCSV('buildablelabs-expenses.csv', [
    ['Date', 'Vendor', 'Vendor GSTIN', 'Category', 'Bill no', 'HSN/SAC', 'Taxable', 'GST %', 'CGST', 'SGST', 'IGST', 'Total', 'ITC eligible', 'Mode', 'Reference'],
    ...filtered.map((r) => [r.expense_date, r.vendor_name, r.vendor_gstin, r.category, r.bill_number, r.code,
      r.taxable_amount, r.gst_rate, r.cgst_amount, r.sgst_amount, r.igst_amount, r.total_amount,
      r.itc_eligible ? 'Yes' : 'No', r.payment_mode, r.reference]),
  ]);

  return (
    <>
      <PageHeader title="Expenses" subtitle="Organisation costs and the input tax credit you can claim against them.">
        <button className="btn-ghost" onClick={exportCsv}><Download size={15} /> CSV</button>
        <button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}><Plus size={15} /> New expense</button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <p className="label-mono">Spend in range</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-white">{moneyShort(totalSpend)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="label-mono">Input tax credit</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-emerald-300">{moneyShort(itc)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="label-mono">Entries</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-white">{filtered.length}</p>
        </div>
      </div>

      {byCategory.length > 0 && (
        <Card title="Where it goes" subtitle="Top categories in the selected range" className="mb-5">
          <div className="space-y-2.5">
            {byCategory.map(([cat, amt]) => (
              <div key={cat}>
                <div className="mb-1 flex justify-between text-[12.5px]">
                  <span className="text-[#C9CEDA]">{cat}</span>
                  <span className="font-mono tabular-nums text-chrome">{money(amt)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-500">
                  <div className="h-full rounded-full bg-blue" style={{ width: `${Math.max(3, (amt / (byCategory[0][1] || 1)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chrome-dark" />
          <Input className="pl-8" placeholder="Vendor, category, bill…" value={q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Input type="date" className="max-w-[150px]" value={from} onChange={(e) => set('from', e.target.value)} />
        <Input type="date" className="max-w-[150px]" value={to} onChange={(e) => set('to', e.target.value)} />
        <button className="btn-subtle btn-sm" onClick={() => patch({ from: fy.start, to: fy.end })}>{fy.label}</button>
      </div>

      <Card bodyClass="">
        {loading ? <Loading />
          : filtered.length === 0 ? (
            <EmptyState icon={<Receipt size={18} />} title="No expenses recorded"
              body="Log every organisation cost with its GST split — your ITC and compliance numbers come straight from here."
              action={<button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}><Plus size={15} /> New expense</button>} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[820px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">Date</th><th className="th">Vendor</th><th className="th">Category</th>
                  <th className="th text-right">Taxable</th><th className="th text-right">GST</th>
                  <th className="th text-right">Total</th><th className="th">ITC</th><th className="th w-20"></th>
                </tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td className="td text-[12.5px] text-chrome">{fmtDate(r.expense_date)}</td>
                      <td className="td">
                        <span className="block font-semibold text-white">{r.vendor_name}</span>
                        {r.description && <span className="block max-w-[240px] truncate text-[11.5px] text-chrome">{r.description}</span>}
                      </td>
                      <td className="td text-[12.5px] text-[#C9CEDA]">{r.category}</td>
                      <td className="td text-right font-mono tabular-nums text-[12.5px] text-[#C9CEDA]">{money(r.taxable_amount, r.currency)}</td>
                      <td className="td text-right font-mono tabular-nums text-[12.5px] text-chrome">
                        {money(Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount), r.currency)}
                      </td>
                      <td className="td text-right font-mono tabular-nums text-[13px] text-white">
                        <span className="block">{money(r.total_amount, r.currency)}</span>
                        {r.currency !== 'INR' && (
                          <span className="block text-[10.5px] font-normal text-amber-300/90">
                            ≈ {money(inr(r, Number(r.total_amount)))} · ×{Number(r.exchange_rate).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="td">
                        <span className={`pill ${r.itc_eligible ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink-400 text-chrome-dark'}`}>
                          {r.itc_eligible ? 'Claimable' : 'Blocked'}
                        </span>
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button className="btn-subtle btn-xs" onClick={() => {
                            const split: Split = Number(r.igst_amount) > 0 ? 'igst' : Number(r.cgst_amount) > 0 ? 'cgst_sgst' : 'none';
                            setF({ ...r, split }); setOpen(true);
                          }}><Pencil size={14} /></button>
                          <button className="btn-subtle btn-xs text-red-400" onClick={() => remove(r)}><Trash2 size={14} /></button>
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
        title={f.id ? 'Edit expense' : 'New expense'} subtitle="Capture the GST split so your ITC is ready at filing time."
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save expense'}</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><Input type="date" value={f.expense_date ?? ''} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
          <Field label="Vendor" required><Input value={f.vendor_name ?? ''} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} placeholder="Amazon Web Services" /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Vendor GSTIN"><Input className="input-mono uppercase" value={f.vendor_gstin ?? ''} onChange={(e) => setF({ ...f, vendor_gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Bill / invoice number"><Input value={f.bill_number ?? ''} onChange={(e) => setF({ ...f, bill_number: e.target.value })} /></Field>
          <Field label="HSN / SAC"><Input className="input-mono" value={f.code ?? ''} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>

          <Field label="Taxable amount" required>
            <Input type="number" step="0.01" className="input-mono" value={f.taxable_amount ?? 0} onChange={(e) => setF({ ...f, taxable_amount: Number(e.target.value) })} />
          </Field>
          <Field label="Tax split">
            <Select value={f.split} onChange={(e) => setF({ ...f, split: e.target.value as Split })}>
              <option value="igst">IGST (out-of-state / import)</option>
              <option value="cgst_sgst">CGST + SGST (within Telangana)</option>
              <option value="none">No GST</option>
            </Select>
          </Field>
          <Field label="GST rate %">
            <Select value={String(f.gst_rate)} disabled={f.split === 'none'} onChange={(e) => setF({ ...f, gst_rate: Number(e.target.value) })}>
              {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={f.currency ?? 'INR'} onChange={(e) => {
              const currency = e.target.value;
              setF((prev) => ({ ...prev, currency, exchange_rate: currency === 'INR' ? 1 : prev.exchange_rate }));
            }}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </Select>
          </Field>
          <FxRateField
            currency={f.currency}
            onDate={f.expense_date}
            amount={Number(f.taxable_amount) || 0}
            rate={Number(f.exchange_rate) || 1}
            onRate={(n) => setF((prev) => ({ ...prev, exchange_rate: n }))}
          />
          <Field label="Payment mode">
            <Select value={f.payment_mode ?? 'bank_transfer'} onChange={(e) => setF({ ...f, payment_mode: e.target.value })}>
              {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Reference"><Input value={f.reference ?? ''} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Rebill to client" hint="Optional — tag a pass-through cost">
            <Select value={f.billable_to ?? ''} onChange={(e) => setF({ ...f, billable_to: e.target.value || null })}>
              <option value="">Not billable</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </Select>
          </Field>
          <Field label="Receipt URL" hint="Link to the bill in Drive / storage">
            <Input value={f.attachment_url ?? ''} onChange={(e) => setF({ ...f, attachment_url: e.target.value })} />
          </Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>

          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-ink-800/50 px-4 py-3">
            <div className="flex flex-wrap gap-6">
              <Toggle checked={!!f.itc_eligible} onChange={(v) => setF({ ...f, itc_eligible: v })} label="ITC claimable" />
              <Toggle checked={!!f.is_reverse_charge} onChange={(v) => setF({ ...f, is_reverse_charge: v })} label="Reverse charge" />
            </div>
            <p className="font-mono text-[13px] text-white">
              Total {money(calc.total, f.currency)}
              {f.currency !== 'INR' && Number(f.exchange_rate) > 1 && (
                <span className="ml-2 text-amber-300">≈ {money(calc.total * Number(f.exchange_rate))}</span>
              )}
              <span className="ml-2 text-[11.5px] text-chrome-dark">
                {f.split === 'igst' ? `IGST ${calc.igst}` : f.split === 'cgst_sgst' ? `CGST ${calc.cgst} + SGST ${calc.sgst}` : 'no GST'}
              </span>
            </p>
          </div>
        </div>
      </Modal>
      {confirmNode}
    </>
  );
}
