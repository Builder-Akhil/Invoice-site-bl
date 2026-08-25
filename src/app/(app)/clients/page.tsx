'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Users, Pencil, FileText, Globe, Building2 } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useClients } from '@/lib/hooks';
import { useListFilters } from '@/lib/list-filters';
import { GST_TREATMENTS, type Client } from '@/lib/types';
import { money, moneyShort, initials, downloadCSV } from '@/lib/format';
import ClientForm from '@/components/ClientForm';
import { Card, EmptyState, Input, Loading, PageHeader, Tabs } from '@/components/ui';

type Agg = Record<string, { billed: number; due: number; count: number }>;

const CLIENT_FILTERS = { q: '', tab: 'active' };

export default function ClientsPage() {
  return (
    <Suspense fallback={<Loading label="Loading clients" />}>
      <ClientsInner />
    </Suspense>
  );
}

function ClientsInner() {
  const { clients, loading, reload } = useClients();
  const [agg, setAgg] = useState<Agg>({});
  const { values: f, set } = useListFilters('clients', CLIENT_FILTERS);
  const q = f.q;
  const tab = f.tab;
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    sb().from('invoices')
      .select('client_id,total,balance_due,exchange_rate,status,doc_type')
      .eq('doc_type', 'invoice')
      .then(({ data }) => {
        const a: Agg = {};
        (data ?? []).forEach((r) => {
          const k = r.client_id as string; if (!k) return;
          a[k] ??= { billed: 0, due: 0, count: 0 };
          const fx = Number(r.exchange_rate) || 1;
          if (r.status !== 'cancelled' && r.status !== 'draft') {
            a[k].billed += Number(r.total) * fx;
            a[k].due += Number(r.balance_due) * fx;
          }
          a[k].count += 1;
        });
        setAgg(a);
      });
  }, [clients]);

  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) =>
      [c.company_name, c.contact_person, c.email, c.gstin, c.bill_city]
        .some((v) => (v ?? '').toLowerCase().includes(s)));
  }, [clients, q]);

  const filtered = useMemo(() => {
    return searched.filter((c) => tab === 'all' || c.status === tab);
  }, [searched, tab]);

  const exportCsv = () => downloadCSV('buildablelabs-clients.csv', [
    ['Company', 'Contact', 'Email', 'Phone', 'GST treatment', 'GSTIN', 'Place of supply', 'Currency', 'Terms (days)', 'Billed (INR)', 'Outstanding (INR)'],
    ...filtered.map((c) => [c.company_name, c.contact_person, c.email, c.work_phone,
      c.gst_treatment, c.gstin, c.place_of_supply_state, c.currency, c.payment_terms_days,
      (agg[c.id]?.billed ?? 0).toFixed(2), (agg[c.id]?.due ?? 0).toFixed(2)]),
  ]);

  return (
    <>
      <PageHeader title="Clients" subtitle="Everyone you bill, with their GST treatment and terms.">
        <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
        <button className="btn-primary" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus size={15} /> New client
        </button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chrome-dark" />
          <Input className="pl-8" placeholder="Search name, email, GSTIN, city…" value={q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Tabs active={tab} onChange={(k) => set('tab', k)} tabs={[
          { key: 'active', label: 'Active', count: searched.filter((c) => c.status === 'active').length },
          { key: 'inactive', label: 'Inactive', count: searched.filter((c) => c.status !== 'active').length },
          { key: 'all', label: 'All', count: searched.length },
        ]} />
      </div>

      <Card bodyClass="">
        {loading ? <Loading label="Loading clients" />
          : filtered.length === 0 ? (
            <EmptyState icon={<Users size={18} />} title="No clients yet"
              body="Add the company you bill — GSTIN, place of supply and payment terms flow straight onto every invoice."
              action={<button className="btn-primary" onClick={() => { setEditing(null); setOpen(true); }}><Plus size={15} /> New client</button>} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[880px]">
                <thead><tr className="bg-ink-800/60">
                  <th className="th">Client</th><th className="th">GST treatment</th>
                  <th className="th">Place of supply</th><th className="th text-right">Invoices</th>
                  <th className="th text-right">Billed</th><th className="th text-right">Outstanding</th>
                  <th className="th w-24"></th>
                </tr></thead>
                <tbody>
                  {filtered.map((c) => {
                    const a = agg[c.id] ?? { billed: 0, due: 0, count: 0 };
                    return (
                      <tr key={c.id} className="row-link">
                        <td className="td">
                          <div className="flex items-center gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue/15 text-[11.5px] font-bold text-blue-300 ring-1 ring-inset ring-blue/25">
                              {initials(c.company_name)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-white">{c.company_name}</span>
                              <span className="block truncate text-[12px] text-chrome">
                                {c.contact_person ? `${c.contact_person} · ` : ''}{c.email || 'no email'}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="td">
                          <span className="flex items-center gap-1.5 text-[12.5px] text-[#C9CEDA]">
                            {c.is_overseas ? <Globe size={13} className="text-chrome" /> : <Building2 size={13} className="text-chrome" />}
                            {GST_TREATMENTS.find((t) => t.value === c.gst_treatment)?.label.split(' — ')[0]}
                          </span>
                          {c.gstin && <span className="mt-0.5 block font-mono text-[11px] text-chrome-dark">{c.gstin}</span>}
                        </td>
                        <td className="td text-[12.5px] text-[#C9CEDA]">
                          {c.place_of_supply_state || '—'}
                          <span className="ml-1 font-mono text-[11px] text-chrome-dark">{c.place_of_supply_code}</span>
                        </td>
                        <td className="td text-right font-mono text-[12.5px] text-chrome">{a.count}</td>
                        <td className="td text-right font-mono tabular-nums text-[13px] text-[#C9CEDA]">{moneyShort(a.billed)}</td>
                        <td className={`td text-right font-mono tabular-nums text-[13px] ${a.due > 0.5 ? 'text-amber-300' : 'text-chrome-dark'}`}>
                          {a.due > 0.5 ? money(a.due) : '—'}
                        </td>
                        <td className="td">
                          <div className="flex justify-end gap-1">
                            <Link href={`/invoices/new?client=${c.id}`} className="btn-subtle btn-xs" title="New invoice"><FileText size={14} /></Link>
                            <button className="btn-subtle btn-xs" title="Edit"
                              onClick={() => { setEditing(c); setOpen(true); }}><Pencil size={14} /></button>
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

      <ClientForm open={open} onClose={() => setOpen(false)} client={editing} onSaved={() => reload()} />
    </>
  );
}
