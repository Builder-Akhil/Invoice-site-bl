'use client';
import { Suspense, useMemo, useState } from 'react';
import { Plus, Package, Pencil, Trash2, Search } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useItems, useProfile } from '@/lib/hooks';
import { useListFilters } from '@/lib/list-filters';
import { UNITS, unitLabel, type CatalogItem } from '@/lib/types';
import { GST_RATES } from '@/lib/gst';
import { money } from '@/lib/format';
import { Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, toast, useConfirm } from '@/components/ui';
import { SacPicker } from '@/components/SacPicker';

const blank = (): Partial<CatalogItem> => ({
  name: '', description: '', kind: 'service', code_type: 'SAC', code: '998314',
  unit: 'qty', rate: 0, currency: 'INR', gst_rate: 18, is_active: true,
});

const ITEM_FILTERS = { q: '' };

export default function ItemsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ItemsInner />
    </Suspense>
  );
}

function ItemsInner() {
  const { items, loading, reload } = useItems();
  const { profile } = useProfile();
  const { confirm, confirmNode } = useConfirm();
  const { values: filt, set: setFilter } = useListFilters('items', ITEM_FILTERS);
  const q = filt.q;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Partial<CatalogItem>>(blank());

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => !s || [i.name, i.description, i.code].some((v) => (v ?? '').toLowerCase().includes(s)));
  }, [items, q]);

  async function save() {
    if (!f.name?.trim()) return toast('Name is required', 'error');
    const payload = { ...f };
    const id = payload.id; delete payload.id;
    const { error } = id
      ? await sb().from('items').update(payload).eq('id', id)
      : await sb().from('items').insert(payload);
    if (error) return toast(error.message, 'error');
    toast(id ? 'Service updated' : 'Service added');
    setOpen(false); reload();
  }

  async function remove(i: CatalogItem) {
    if (!(await confirm(`Remove "${i.name}" from the catalog? Invoices already raised keep their line items.`))) return;
    const { error } = await sb().from('items').delete().eq('id', i.id);
    if (error) return toast(error.message, 'error');
    toast('Removed'); reload();
  }

  return (
    <>
      <PageHeader title="Services" subtitle="Your reusable line items with SAC / HSN codes for GST compliance.">
        <button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}><Plus size={15} /> New service</button>
      </PageHeader>

      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chrome-dark" />
        <Input className="pl-8" placeholder="Search services or codes…" value={q} onChange={(e) => setFilter('q', e.target.value)} />
      </div>

      <Card bodyClass="">
        {loading ? <Loading />
          : filtered.length === 0 ? (
            <EmptyState icon={<Package size={18} />} title="No services yet"
              body="Save your recurring line items once — retainers, builds, advisory — with their SAC code and GST rate."
              action={<button className="btn-primary" onClick={() => { setF(blank()); setOpen(true); }}><Plus size={15} /> New service</button>} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[720px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">Service</th><th className="th">Code</th><th className="th">Unit</th>
                  <th className="th text-right">Rate</th><th className="th text-right">GST</th><th className="th w-20"></th>
                </tr></thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} className="row-link">
                      <td className="td">
                        <span className="block font-semibold text-white">{i.name}</span>
                        {i.description && <span className="block max-w-md truncate text-[12px] text-chrome">{i.description}</span>}
                        {!i.is_active && <span className="pill mt-1 bg-ink-400 text-chrome-dark">Inactive</span>}
                      </td>
                      <td className="td font-mono text-[12.5px] text-[#C9CEDA]">
                        <span className="text-chrome-dark">{i.code_type}</span> {i.code || '—'}
                      </td>
                      <td className="td text-[12.5px] text-chrome">{unitLabel(i.unit)}</td>
                      <td className="td text-right font-mono tabular-nums text-[13px] text-[#C9CEDA]">
                        {i.rate ? money(i.rate, i.currency) : '—'}
                      </td>
                      <td className="td text-right font-mono text-[12.5px] text-chrome">{i.gst_rate}%</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button className="btn-subtle btn-xs" onClick={() => { setF({ ...i }); setOpen(true); }}><Pencil size={14} /></button>
                          <button className="btn-subtle btn-xs text-red-400 hover:text-red-300" onClick={() => remove(i)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={f.id ? 'Edit service' : 'New service'}
        subtitle="Used to pre-fill invoice lines."
        footer={<><button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={save}>{f.id ? 'Save' : 'Add service'}</button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Consulting CTO Retainer" />
          </Field>
          <Field label="Description" className="sm:col-span-2" hint="Appears under the item name on the invoice">
            <Textarea value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="Aug 15 - Sept 15: Month 1 Consultation" />
          </Field>
          <Field label="Type">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'service' | 'goods', code_type: e.target.value === 'goods' ? 'HSN' : 'SAC' })}>
              <option value="service">Service (SAC)</option><option value="goods">Goods (HSN)</option>
            </Select>
          </Field>
          <Field label={`${f.code_type} code`} hint="GST needs a code on every line. Pick a tagged SAC, or switch to goods for HSN.">
            {f.code_type === 'HSN' ? (
              <Input className="input-mono" value={f.code ?? ''} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="HSN" />
            ) : (
              <SacPicker compact={false} value={f.code ?? ''} codes={profile?.sac_codes}
                onChange={(code) => setF({ ...f, code })} />
            )}
          </Field>
          <Field label="Unit">
            <Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              {UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
            </Select>
          </Field>
          <Field label="Default rate">
            <Input type="number" step="0.01" className="input-mono" value={f.rate ?? 0}
              onChange={(e) => setF({ ...f, rate: Number(e.target.value) })} />
          </Field>
          <Field label="GST rate %">
            <Select value={String(f.gst_rate)} onChange={(e) => setF({ ...f, gst_rate: Number(e.target.value) })}>
              {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
          </Field>
          <div className="flex items-end pb-1">
            <Toggle checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Active in catalog" />
          </div>
        </div>
      </Modal>
      {confirmNode}
    </>
  );
}
