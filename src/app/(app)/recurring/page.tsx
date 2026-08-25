'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Repeat, Pencil, Trash2, Zap, PauseCircle, PlayCircle } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients, useItems, useProfile } from '@/lib/hooks';
import { computeTotals } from '@/lib/gst';
import { CURRENCIES, fmtDate, money, moneyShort, todayISO } from '@/lib/format';
import { UNITS, type InvoiceLine, type RecurringProfile } from '@/lib/types';
import { emptyLine } from '@/lib/invoice-service';
import {
  Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, toast, useConfirm, Spinner,
} from '@/components/ui';

const FREQ = [
  { value: 'monthly', label: 'Monthly', perMonth: 1 },
  { value: 'quarterly', label: 'Quarterly', perMonth: 1 / 3 },
  { value: 'yearly', label: 'Yearly', perMonth: 1 / 12 },
  { value: 'weekly', label: 'Weekly', perMonth: 52 / 12 },
];
const mrrOf = (amount: number, frequency: string) =>
  amount * (FREQ.find((f) => f.value === frequency)?.perMonth ?? 1);

const blank = (): Partial<RecurringProfile> => ({
  title: '', client_id: '', frequency: 'monthly', start_date: todayISO(), next_run_date: todayISO(),
  day_of_month: 1, currency: 'INR', due_days: 7, auto_send: false, is_active: true,
  line_items: [emptyLine(0, { unit: 'month', quantity: 1, gst_rate: 18 })],
});

export default function RecurringPage() {
  const { clients } = useClients(true);
  const { items } = useItems();
  const { profile } = useProfile();
  const { confirm, confirmNode } = useConfirm();
  const [rows, setRows] = useState<(RecurringProfile & { clients?: { company_name: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [f, setF] = useState<Partial<RecurringProfile>>(blank());

  const load = async () => {
    setLoading(true);
    const { data } = await sb().from('recurring_profiles').select('*, clients(company_name)').order('next_run_date');
    setRows((data ?? []) as never[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const lines = (f.line_items ?? []) as InvoiceLine[];
  const totals = useMemo(() => computeTotals(lines, 'inter', { roundOff: true }), [lines]);
  const mrr = rows.filter((r) => r.is_active).reduce((a, r) => a + mrrOf(Number(r.amount), r.frequency), 0);

  const updateLine = (i: number, patch: Partial<InvoiceLine>) =>
    setF((s) => ({ ...s, line_items: (s.line_items ?? []).map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  async function save() {
    if (!f.title?.trim()) return toast('Give the retainer a name', 'error');
    if (!f.client_id) return toast('Pick a client', 'error');
    setBusy('save');
    const payload = { ...f, amount: totals.total, line_items: lines };
    const id = payload.id; delete payload.id;
    delete (payload as Record<string, unknown>).clients;
    const { error } = id
      ? await sb().from('recurring_profiles').update(payload).eq('id', id)
      : await sb().from('recurring_profiles').insert(payload);
    setBusy('');
    if (error) return toast(error.message, 'error');
    toast(id ? 'Retainer updated' : 'Retainer created'); setOpen(false); load();
  }

  async function generate(id?: string) {
    setBusy(id ?? 'all');
    try {
      const res = await fetch('/api/cron/recurring', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      if (j.created?.length) toast(`Created ${j.created.join(', ')}`);
      else toast(j.failed?.length ? j.failed.join(' · ') : 'Nothing due right now', j.failed?.length ? 'error' : 'info');
      load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'error'); }
    finally { setBusy(''); }
  }

  async function remove(r: RecurringProfile) {
    if (!(await confirm(`Delete the retainer "${r.title}"? Invoices already generated are untouched.`))) return;
    await sb().from('recurring_profiles').delete().eq('id', r.id);
    toast('Deleted'); load();
  }

  async function toggle(r: RecurringProfile) {
    await sb().from('recurring_profiles').update({ is_active: !r.is_active }).eq('id', r.id);
    load();
  }

  return (
    <>
      <PageHeader title="Retainers" subtitle="Recurring engagements generate draft invoices automatically — and drive your MRR.">
        <button className="btn-ghost" onClick={() => generate()} disabled={busy === 'all'}>
          {busy === 'all' ? <Spinner /> : <><Zap size={15} /> Run due now</>}
        </button>
        <button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}><Plus size={15} /> New retainer</button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <p className="label-mono">Monthly recurring revenue</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-emerald-300">{moneyShort(mrr)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="label-mono">Annual run rate</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-white">{moneyShort(mrr * 12)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="label-mono">Active retainers</p>
          <p className="mt-1.5 font-display text-[26px] leading-none text-white">{rows.filter((r) => r.is_active).length}</p>
        </div>
      </div>

      <Card bodyClass="">
        {loading ? <Loading />
          : rows.length === 0 ? (
            <EmptyState icon={<Repeat size={18} />} title="No retainers yet"
              body="Set up a monthly engagement once — a draft invoice appears on schedule and the value counts towards MRR."
              action={<button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}><Plus size={15} /> New retainer</button>} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[820px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">Retainer</th><th className="th">Client</th><th className="th">Cadence</th>
                  <th className="th">Next invoice</th><th className="th text-right">Value</th>
                  <th className="th text-right">MRR</th><th className="th w-28"></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="row-link">
                      <td className="td">
                        <span className="block font-semibold text-white">{r.title}</span>
                        {!r.is_active && <span className="pill mt-1 bg-ink-400 text-chrome-dark">Paused</span>}
                      </td>
                      <td className="td text-[13px] text-[#C9CEDA]">{r.clients?.company_name ?? '—'}</td>
                      <td className="td text-[12.5px] text-chrome">{FREQ.find((x) => x.value === r.frequency)?.label}</td>
                      <td className="td text-[12.5px] text-chrome">{fmtDate(r.next_run_date)}</td>
                      <td className="td text-right font-mono tabular-nums text-[13px] text-white">{money(r.amount, r.currency)}</td>
                      <td className="td text-right font-mono tabular-nums text-[13px] text-emerald-300">{moneyShort(mrrOf(Number(r.amount), r.frequency), r.currency)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button className="btn-subtle btn-xs" title="Generate now" onClick={() => generate(r.id)} disabled={busy === r.id}>
                            {busy === r.id ? <Spinner size={13} /> : <Zap size={14} />}
                          </button>
                          <button className="btn-subtle btn-xs" title={r.is_active ? 'Pause' : 'Resume'} onClick={() => toggle(r)}>
                            {r.is_active ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                          </button>
                          <button className="btn-subtle btn-xs" onClick={() => { setF({ ...r }); setOpen(true); }}><Pencil size={14} /></button>
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

      <Modal open={open} onClose={() => setOpen(false)} width="max-w-3xl"
        title={f.id ? 'Edit retainer' : 'New retainer'}
        subtitle="A draft invoice is created on each run — you review and send."
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : 'Save retainer'}</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Retainer name" required className="sm:col-span-2">
            <Input value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="AAFM India — Consulting CTO" />
          </Field>
          <Field label="Client" required>
            <Select value={f.client_id ?? ''} onChange={(e) => {
              const c = clients.find((x) => x.id === e.target.value);
              setF({ ...f, client_id: e.target.value, currency: c?.currency ?? 'INR', due_days: c?.payment_terms_days ?? 7 });
            }}>
              <option value="">— Select —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </Select>
          </Field>
          <Field label="Frequency">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
              {FREQ.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </Select>
          </Field>
          <Field label="Next invoice date" hint="Rolls forward after each run">
            <Input type="date" value={f.next_run_date ?? ''} onChange={(e) => setF({ ...f, next_run_date: e.target.value })} />
          </Field>
          <Field label="Bill on day of month" hint="Used when rolling forward">
            <Input type="number" min={1} max={31} value={f.day_of_month ?? 1} onChange={(e) => setF({ ...f, day_of_month: Number(e.target.value) })} />
          </Field>
          <Field label="Payment terms (days)">
            <Input type="number" min={0} value={f.due_days ?? 7} onChange={(e) => setF({ ...f, due_days: Number(e.target.value) })} />
          </Field>
          <Field label="Currency">
            <Select value={f.currency ?? 'INR'} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </Select>
          </Field>
          <Field label="End date (optional)" className="sm:col-span-2">
            <Input type="date" value={f.end_date ?? ''} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
          </Field>

          <div className="sm:col-span-2 border-t border-line pt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="label-mono">Line items</p>
              <button className="btn-ghost btn-xs"
                onClick={() => setF({ ...f, line_items: [...lines, emptyLine(lines.length, { unit: 'month', gst_rate: 18 })] })}>
                <Plus size={13} /> Add
              </button>
            </div>
            <datalist id="catalog-rec">{items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-line bg-ink-800/50 p-3 sm:grid-cols-12">
                  <Input list="catalog-rec" className="sm:col-span-5" placeholder="Item name" value={l.name}
                    onChange={(e) => {
                      const found = items.find((it) => it.name.toLowerCase() === e.target.value.toLowerCase());
                      updateLine(i, found
                        ? { name: found.name, description: found.description ?? '', code: found.code ?? '', unit: found.unit, rate: Number(found.rate), gst_rate: Number(found.gst_rate) }
                        : { name: e.target.value });
                    }} />
                  <Input className="input-mono sm:col-span-2" placeholder="SAC" value={l.code ?? ''} onChange={(e) => updateLine(i, { code: e.target.value })} />
                  <Input type="number" step="0.01" className="input-mono text-right sm:col-span-1" value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} />
                  <Select className="sm:col-span-2" value={l.unit ?? 'month'} onChange={(e) => updateLine(i, { unit: e.target.value })}>
                    {UNITS.map((u) => <option key={u} value={u}>per {u}</option>)}
                  </Select>
                  <Input type="number" step="0.01" className="input-mono text-right sm:col-span-2" placeholder="Rate" value={l.rate} onChange={(e) => updateLine(i, { rate: Number(e.target.value) })} />
                  <Textarea rows={1} className="sm:col-span-10 text-[12.5px]" placeholder="Description" value={l.description ?? ''} onChange={(e) => updateLine(i, { description: e.target.value })} />
                  <Select className="sm:col-span-1" value={String(l.gst_rate)} onChange={(e) => updateLine(i, { gst_rate: Number(e.target.value) })}>
                    {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                  </Select>
                  <button className="btn-subtle btn-xs text-red-400 sm:col-span-1" disabled={lines.length === 1}
                    onClick={() => setF({ ...f, line_items: lines.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-right text-[13px] text-chrome">
              Each run bills <span className="font-mono text-white">{money(totals.total, f.currency)}</span>
              <span className="ml-2 text-chrome-dark">(incl. GST, at inter-state rates — recalculated per client at generation)</span>
            </p>
          </div>

          <Field label="Subject on the invoice" className="sm:col-span-2">
            <Input value={f.subject ?? ''} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={f.notes ?? profile?.default_notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <div className="sm:col-span-2 flex flex-wrap gap-6 border-t border-line pt-4">
            <Toggle checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Active" />
          </div>
        </div>
      </Modal>
      {confirmNode}
    </>
  );
}
