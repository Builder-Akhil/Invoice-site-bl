'use client';
import { useEffect, useState } from 'react';
import { Plus, CreditCard, Pencil, Trash2, Zap, PauseCircle, PlayCircle } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { FREQ_PER_MONTH, splitExpenseTax, subscriptionRunRate } from '@/lib/finance';
import { CURRENCIES, fmtDate, money, moneyShort, todayISO } from '@/lib/format';
import { EXPENSE_CATEGORIES, type RecurringExpense, type TaxSplit } from '@/lib/types';
import { GST_RATES } from '@/lib/gst';
import {
  Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle,
  toast, useConfirm, Spinner,
} from '@/components/ui';

const FREQ = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'weekly', label: 'Weekly' },
];

const blank = (): Partial<RecurringExpense> => ({
  title: '', vendor: '', category: 'Software & Subscriptions', frequency: 'monthly',
  next_run_date: todayISO(), day_of_month: 1, taxable_amount: 0, gst_rate: 18,
  tax_split: 'igst', itc_eligible: true, currency: 'INR', exchange_rate: 1, is_active: true, notes: '',
});

export default function RecurringExpensesPage() {
  const { confirm, confirmNode } = useConfirm();
  const [rows, setRows] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [f, setF] = useState<Partial<RecurringExpense>>(blank());

  const load = async () => {
    setLoading(true);
    const { data } = await sb().from('recurring_expenses').select('*').order('next_run_date');
    setRows((data ?? []) as RecurringExpense[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const runRate = subscriptionRunRate(rows);
  const tax = splitExpenseTax(Number(f.taxable_amount) || 0, Number(f.gst_rate) || 0, f.tax_split ?? 'igst');

  async function save() {
    if (!f.title?.trim()) return toast('Give the subscription a name', 'error');
    if (!f.vendor?.trim()) return toast('Vendor is required', 'error');
    setBusy('save');
    const payload = {
      title: f.title.trim(),
      vendor: f.vendor.trim(),
      category: f.category || 'Software & Subscriptions',
      frequency: f.frequency || 'monthly',
      next_run_date: f.next_run_date || todayISO(),
      day_of_month: Number(f.day_of_month ?? 1),
      taxable_amount: Number(f.taxable_amount) || 0,
      gst_rate: f.tax_split === 'none' ? 0 : Number(f.gst_rate) || 0,
      tax_split: f.tax_split || 'igst',
      itc_eligible: f.tax_split === 'none' ? false : (f.itc_eligible !== false),
      currency: f.currency || 'INR',
      exchange_rate: Number(f.exchange_rate ?? 1),
      is_active: f.is_active !== false,
      notes: f.notes || null,
    };
    const { error } = f.id
      ? await sb().from('recurring_expenses').update(payload).eq('id', f.id)
      : await sb().from('recurring_expenses').insert(payload);
    setBusy('');
    if (error) return toast(error.message, 'error');
    toast(f.id ? 'Subscription updated' : 'Subscription saved');
    setOpen(false); load();
  }

  async function generate(id?: string) {
    setBusy(id ?? 'all');
    try {
      const res = await fetch('/api/cron/recurring', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: 'expenses', expenseId: id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      if (j.expenses?.length) toast(`Logged ${j.expenses.length} expense${j.expenses.length > 1 ? 's' : ''}`);
      else toast(j.failed?.length ? j.failed.join(' · ') : 'Nothing due right now', j.failed?.length ? 'error' : 'info');
      load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'error'); }
    finally { setBusy(''); }
  }

  async function remove(r: RecurringExpense) {
    if (!(await confirm(`Delete "${r.title}"? Expenses already logged stay in the books.`))) return;
    await sb().from('recurring_expenses').delete().eq('id', r.id);
    toast('Deleted'); load();
  }

  return (
    <>
      <PageHeader title="Subscriptions"
        subtitle="Recurring vendor spend — Cursor, AWS, Adobe. Money out, distinct from Retainers (invoices in). The same nightly cron that drafts retainers also logs these when due.">
        <button className="btn-ghost" onClick={() => generate()} disabled={busy === 'all'}>
          {busy === 'all' ? <Spinner /> : <><Zap size={15} /> Run due now</>}
        </button>
        <button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}>
          <Plus size={15} /> New subscription
        </button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <p className="label-mono">Monthly run-rate (ex-GST)</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-amber-300">{moneyShort(runRate)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="label-mono">Annual run-rate</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-white">{moneyShort(runRate * 12)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="label-mono">Active</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-white">{rows.filter((r) => r.is_active).length}</p>
        </div>
      </div>

      <Card bodyClass="">
        {loading ? <Loading />
          : rows.length === 0 ? (
            <EmptyState icon={<CreditCard size={18} />} title="No subscriptions yet"
              body="Log Cursor, Anthropic, Adobe, AWS once — a matching expense appears on schedule and counts toward burn and runway."
              action={<button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}><Plus size={15} /> New subscription</button>} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[820px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">Subscription</th><th className="th">Vendor</th><th className="th">Cadence</th>
                  <th className="th">Next run</th><th className="th text-right">Taxable</th>
                  <th className="th text-right">/ month</th><th className="th w-28"></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const monthly = Number(r.taxable_amount) * (FREQ_PER_MONTH[r.frequency] ?? 1) * (Number(r.exchange_rate) || 1);
                    return (
                      <tr key={r.id} className="row-link">
                        <td className="td">
                          <span className="block font-semibold text-white">{r.title}</span>
                          {!r.is_active && <span className="pill mt-1 bg-ink-400 text-chrome-dark">Paused</span>}
                        </td>
                        <td className="td text-[13px] text-[#C9CEDA]">{r.vendor}</td>
                        <td className="td text-[12.5px] text-chrome">{FREQ.find((x) => x.value === r.frequency)?.label}</td>
                        <td className="td text-[12.5px] text-chrome">{fmtDate(r.next_run_date)}</td>
                        <td className="td text-right font-mono tabular-nums text-[13px] text-white">{money(r.taxable_amount, r.currency)}</td>
                        <td className="td text-right font-mono tabular-nums text-[13px] text-amber-300">{moneyShort(monthly)}</td>
                        <td className="td">
                          <div className="flex justify-end gap-1">
                            <button className="btn-subtle btn-xs" title="Log now" onClick={() => generate(r.id)} disabled={busy === r.id}>
                              {busy === r.id ? <Spinner size={13} /> : <Zap size={14} />}
                            </button>
                            <button className="btn-subtle btn-xs" title={r.is_active ? 'Pause' : 'Resume'}
                              onClick={async () => { await sb().from('recurring_expenses').update({ is_active: !r.is_active }).eq('id', r.id); load(); }}>
                              {r.is_active ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                            </button>
                            <button className="btn-subtle btn-xs" onClick={() => { setF({ ...r }); setOpen(true); }}><Pencil size={14} /></button>
                            <button className="btn-subtle btn-xs text-red-400" onClick={() => remove(r)}><Trash2 size={14} /></button>
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

      <Modal open={open} onClose={() => setOpen(false)} width="max-w-2xl"
        title={f.id ? 'Edit subscription' : 'New subscription'}
        subtitle="Same GST split as a one-off expense. The nightly cron logs it when next-run is due."
        footer={<>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : 'Save'}</button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Cursor Pro" />
          </Field>
          <Field label="Vendor" required>
            <Input value={f.vendor ?? ''} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="Anysphere" />
          </Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Frequency">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
              {FREQ.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </Select>
          </Field>
          <Field label="Next run date">
            <Input type="date" value={f.next_run_date ?? ''} onChange={(e) => setF({ ...f, next_run_date: e.target.value })} />
          </Field>
          <Field label="Day of month" hint="Used when rolling forward">
            <Input type="number" min={1} max={31} value={f.day_of_month ?? 1} onChange={(e) => setF({ ...f, day_of_month: Number(e.target.value) })} />
          </Field>
          <Field label="Taxable amount (ex-GST)" required>
            <Input type="number" step="0.01" className="input-mono" value={f.taxable_amount ?? 0}
              onChange={(e) => setF({ ...f, taxable_amount: Number(e.target.value) })} />
          </Field>
          <Field label="Tax split">
            <Select value={f.tax_split} onChange={(e) => setF({ ...f, tax_split: e.target.value as TaxSplit })}>
              <option value="igst">IGST (out-of-state / most SaaS)</option>
              <option value="cgst_sgst">CGST + SGST (Telangana vendor)</option>
              <option value="none">No GST</option>
            </Select>
          </Field>
          <Field label="GST rate %">
            <Select value={String(f.gst_rate)} disabled={f.tax_split === 'none'} onChange={(e) => setF({ ...f, gst_rate: Number(e.target.value) })}>
              {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={f.currency ?? 'INR'} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </Select>
          </Field>
          {f.currency !== 'INR' && (
            <Field label="Exchange rate to INR">
              <Input type="number" step="0.0001" className="input-mono" value={f.exchange_rate ?? 1}
                onChange={(e) => setF({ ...f, exchange_rate: Number(e.target.value) })} />
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-ink-800/50 px-4 py-3">
            <div className="flex flex-wrap gap-6">
              <Toggle checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Active" />
              <Toggle checked={!!f.itc_eligible && f.tax_split !== 'none'}
                onChange={(v) => setF({ ...f, itc_eligible: v })} label="ITC claimable" />
            </div>
            <p className="font-mono text-[13px] text-white">
              Each run {money(tax.total_amount, f.currency)}
              <span className="ml-2 text-[11.5px] text-chrome-dark">
                {f.tax_split === 'none' ? 'no GST' : f.tax_split === 'igst' ? `IGST ${tax.igst_amount}` : `CGST+SGST ${tax.cgst_amount * 2}`}
              </span>
            </p>
          </div>
        </div>
      </Modal>
      {confirmNode}
    </>
  );
}
