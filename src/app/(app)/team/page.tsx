'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Plus, UsersRound, Pencil, Trash2, Banknote, RefreshCw, PauseCircle, PlayCircle } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import {
  asComponents, asPayrollLines, applyPayrollEdits, computeLines, defaultPayComponents,
  newPayLineKey, payReleaseMonth, periodLabel, previousPeriod, salaryExpensePayload,
  snapshotPayroll, typicalMemberBurn, typicalTeamBurn, PAY_KINDS,
} from '@/lib/payroll';
import { CURRENCIES, money, moneyShort, todayISO } from '@/lib/format';
import type { PayComponent, PayrollItem, PayrollLine, TeamMember } from '@/lib/types';
import { useListFilters } from '@/lib/list-filters';
import {
  Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle,
  toast, useConfirm, Spinner,
} from '@/components/ui';

const blankMember = (): Partial<TeamMember> & { components: PayComponent[] } => ({
  name: '', role: '', email: '', start_date: todayISO(), is_active: true,
  currency: 'INR', exchange_rate: 1, notes: '', components: defaultPayComponents(),
});

const TEAM_FILTERS = { period: previousPeriod() };

export default function TeamPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TeamInner />
    </Suspense>
  );
}

function TeamInner() {
  const { confirm, confirmNode } = useConfirm();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [payroll, setPayroll] = useState<PayrollItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { values: filt, set } = useListFilters('team', TEAM_FILTERS);
  const period = filt.period || previousPeriod();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [f, setF] = useState(blankMember());
  const [drafts, setDrafts] = useState<Record<string, PayrollLine[]>>({});

  const load = async (p = period) => {
    setLoading(true);
    const [m, pay] = await Promise.all([
      sb().from('team_members').select('*').order('name'),
      sb().from('payroll_items').select('*').eq('period', p),
    ]);
    const people = (m.data ?? []).map((row) => ({
      ...row, components: asComponents(row.components),
    })) as TeamMember[];
    const items = (pay.data ?? []).map((row) => ({
      ...row, lines: asPayrollLines(row.lines),
    })) as PayrollItem[];
    setMembers(people);
    setPayroll(items);
    const next: Record<string, PayrollLine[]> = {};
    items.forEach((it) => { next[it.team_member_id] = it.lines; });
    setDrafts(next);
    setLoading(false);
  };
  useEffect(() => { load(period); }, [period]);

  const itemFor = (id: string) => payroll.find((p) => p.team_member_id === id);
  const burn = typicalTeamBurn(members);
  const planned = payroll.reduce((a, p) => a + Number(p.total), 0);
  const paid = payroll.filter((p) => p.status === 'paid').reduce((a, p) => a + Number(p.total), 0);
  const active = members.filter((m) => m.is_active);

  async function saveMember() {
    if (!f.name?.trim()) return toast('Name is required', 'error');
    setBusy('save');
    const payload = {
      name: f.name.trim(),
      role: f.role || null,
      email: f.email || null,
      start_date: f.start_date || null,
      is_active: f.is_active !== false,
      notes: f.notes || null,
      currency: f.currency || 'INR',
      exchange_rate: Number(f.exchange_rate ?? 1),
      components: asComponents(f.components),
      updated_at: new Date().toISOString(),
    };
    const { error } = f.id
      ? await sb().from('team_members').update(payload).eq('id', f.id)
      : await sb().from('team_members').insert(payload);
    setBusy('');
    if (error) return toast(error.message, 'error');
    toast(f.id ? 'Member updated' : 'Member added');
    setOpen(false);
    load();
  }

  async function removeMember(m: TeamMember) {
    if (!(await confirm(`Remove ${m.name}? Planned pay for them is deleted. Salary expenses already logged stay in the books.`))) return;
    await sb().from('team_members').delete().eq('id', m.id);
    toast('Removed'); load();
  }

  async function generateMissing() {
    setBusy('gen');
    const missing = active.filter((m) => !itemFor(m.id));
    if (!missing.length) { setBusy(''); return toast('Everyone already has a row for this work month', 'info'); }
    const rows = missing.map((m) => {
      const snap = snapshotPayroll(m.components, 'full_kit');
      return {
        team_member_id: m.id,
        period,
        lines: snap.lines,
        total: snap.total,
        status: 'planned',
      };
    });
    const { error } = await sb().from('payroll_items').insert(rows);
    setBusy('');
    if (error) return toast(error.message, 'error');
    toast(`Generated ${rows.length} paycheck${rows.length > 1 ? 's' : ''} at full-kit scores — edit the scores, then mark paid.`);
    load();
  }

  async function resetFromContract(m: TeamMember) {
    const item = itemFor(m.id);
    if (!item || item.status === 'paid') return;
    const snap = snapshotPayroll(m.components, 'full_kit');
    const { error } = await sb().from('payroll_items').update({
      lines: snap.lines, total: snap.total, updated_at: new Date().toISOString(),
    }).eq('id', item.id);
    if (error) return toast(error.message, 'error');
    toast('Reset to full-kit from the current contract');
    load();
  }

  function editScore(memberId: string, key: string, patch: { score?: number; value?: number }) {
    setDrafts((s) => {
      const lines = s[memberId] ?? itemFor(memberId)?.lines ?? [];
      const { lines: next } = applyPayrollEdits(lines, [{ key, ...patch }]);
      return { ...s, [memberId]: next };
    });
  }

  async function saveScores(m: TeamMember) {
    const item = itemFor(m.id);
    if (!item || item.status === 'paid') return;
    const lines = drafts[m.id] ?? item.lines;
    const { lines: next, total } = computeLines(lines, 'entered');
    setBusy(item.id);
    const { error } = await sb().from('payroll_items').update({
      lines: next, total, updated_at: new Date().toISOString(),
    }).eq('id', item.id);
    setBusy('');
    if (error) return toast(error.message, 'error');
    toast(`Saved ${money(total, m.currency)}`);
    load();
  }

  async function markPaid(m: TeamMember) {
    const item = itemFor(m.id);
    if (!item || item.status === 'paid') return;
    const lines = drafts[m.id] ?? item.lines;
    const { lines: next, total } = computeLines(lines, 'entered');
    if (total <= 0) return toast('Total is zero — nothing to pay', 'error');
    setBusy(`pay-${m.id}`);
    const paidOn = todayISO();
    const { data: exp, error: expErr } = await sb().from('expenses').insert(
      salaryExpensePayload(m, { period: item.period, total }, paidOn),
    ).select('id').single();
    if (expErr || !exp) { setBusy(''); return toast(expErr?.message ?? 'Could not write salary expense', 'error'); }
    const { error } = await sb().from('payroll_items').update({
      lines: next, total, status: 'paid', paid_on: paidOn, expense_id: exp.id, updated_at: new Date().toISOString(),
    }).eq('id', item.id);
    setBusy('');
    if (error) return toast(error.message, 'error');
    toast(`Paid ${money(total, m.currency)} — logged as Salaries & Wages (no GST)`);
    load();
  }

  const components = asComponents(f.components);
  const kitPreview = useMemo(() => snapshotPayroll(components, 'full_kit'), [components]);

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={`Work month is what they flew. Pay goes out the first week of the next month — ${periodLabel(period)} work is released in ${payReleaseMonth(period)}.`}>
        <button className="btn-ghost" onClick={generateMissing} disabled={busy === 'gen'}>
          {busy === 'gen' ? <Spinner /> : <><RefreshCw size={15} /> Generate month</>}
        </button>
        <button className="btn-primary" onClick={() => { setF(blankMember()); setOpen(true); }}>
          <Plus size={15} /> Add teammate
        </button>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Work month">
          <Input type="month" className="max-w-[180px]" value={period} onChange={(e) => set('period', e.target.value)} />
        </Field>
        <p className="pb-2 text-[12.5px] text-chrome">
          Planned pay does not hit expenses until you mark paid — like a flight plan that is not fuel burn until takeoff.
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Active crew', value: String(active.length), sub: `${members.length} on the roster` },
          { label: 'Typical burn / month', value: moneyShort(burn), sub: 'Every line at maximum (full kit)' },
          { label: `${periodLabel(period)} planned`, value: moneyShort(planned), sub: 'This work month, as scored' },
          { label: 'Marked paid', value: moneyShort(paid), sub: 'Written as Salaries & Wages' },
        ].map((t) => (
          <div key={t.label} className="card px-4 py-3">
            <p className="label-mono">{t.label}</p>
            <p className="mt-1.5 font-display text-[26px] leading-none text-white">{t.value}</p>
            <p className="mt-1.5 text-[11.5px] text-chrome-dark">{t.sub}</p>
          </div>
        ))}
      </div>

      {loading ? <Loading label="Loading the crew" />
        : members.length === 0 ? (
          <Card>
            <EmptyState icon={<UsersRound size={18} />} title="No teammates yet"
              body="Add someone with the default contract lines (basic, skill-gap, performance, client bonus). You can add, remove, or rename lines later — nothing is frozen in stone."
              action={<button className="btn-primary" onClick={() => { setF(blankMember()); setOpen(true); }}><Plus size={15} /> Add teammate</button>} />
          </Card>
        ) : (
          <div className="space-y-4">
            {members.map((m) => {
              const item = itemFor(m.id);
              const lines = drafts[m.id] ?? item?.lines;
              const live = lines ? computeLines(lines, 'entered') : null;
              const kit = typicalMemberBurn(m);
              const locked = item?.status === 'paid';
              return (
                <Card key={m.id} title={
                  <span className="flex items-center gap-2">
                    {m.name}
                    {!m.is_active && <span className="pill bg-ink-400 text-chrome-dark">Paused</span>}
                    {locked && <span className="pill bg-emerald-500/15 text-emerald-300">Paid</span>}
                  </span>
                } subtitle={[m.role, m.email].filter(Boolean).join(' · ') || 'No role yet'}
                  action={
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-subtle btn-xs" title={m.is_active ? 'Pause' : 'Resume'}
                        onClick={async () => { await sb().from('team_members').update({ is_active: !m.is_active }).eq('id', m.id); load(); }}>
                        {m.is_active ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                      </button>
                      <button className="btn-subtle btn-xs" onClick={() => { setF({ ...m, components: asComponents(m.components) }); setOpen(true); }}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn-subtle btn-xs text-red-400" onClick={() => removeMember(m)}><Trash2 size={14} /></button>
                    </div>
                  }>
                  <p className="mb-3 text-[12px] text-chrome">
                    Full kit {money(kit, m.currency)}
                    {live ? <> · this month {money(live.total, m.currency)}</> : ' · no paycheck generated yet'}
                  </p>
                  {!item ? (
                    <p className="text-[13px] text-chrome">Generate this work month to score them (starts at full kit).</p>
                  ) : (
                    <div className="space-y-2">
                      {live!.lines.filter((l) => l.kind !== 'note').map((l) => (
                        <div key={l.key} className="grid items-center gap-2 rounded-lg border border-line bg-ink-800/40 px-3 py-2 sm:grid-cols-[1fr_140px_110px]">
                          <div>
                            <p className="text-[13px] font-semibold text-white">{l.label}</p>
                            {l.conditions && <p className="text-[11px] text-chrome-dark">{l.conditions}</p>}
                          </div>
                          {l.kind === 'percent_of_base' ? (
                            <Field label="Score %">
                              <Input type="number" min={0} max={100} disabled={locked} className="input-mono"
                                value={l.score ?? 0}
                                onChange={(e) => editScore(m.id, l.key, { score: Number(e.target.value) })} />
                            </Field>
                          ) : l.kind === 'capped_amount' ? (
                            <Field label={`Amount (cap ${money(Number(l.cap ?? 0), m.currency)})`}>
                              <Input type="number" min={0} disabled={locked} className="input-mono"
                                value={l.value ?? 0}
                                onChange={(e) => editScore(m.id, l.key, { value: Number(e.target.value) })} />
                            </Field>
                          ) : (
                            <p className="text-[12px] text-chrome">Fixed</p>
                          )}
                          <p className="text-right font-mono text-[13px] text-white">{money(l.computed, m.currency)}</p>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        {!locked && (
                          <>
                            <button className="btn-ghost btn-sm" onClick={() => resetFromContract(m)}>Reset from contract</button>
                            <button className="btn-ghost btn-sm" onClick={() => saveScores(m)} disabled={busy === item.id}>
                              {busy === item.id ? <Spinner /> : 'Save scores'}
                            </button>
                            <button className="btn-primary btn-sm" onClick={() => markPaid(m)} disabled={busy === `pay-${m.id}`}>
                              {busy === `pay-${m.id}` ? <Spinner /> : <><Banknote size={14} /> Mark paid</>}
                            </button>
                          </>
                        )}
                        {locked && (
                          <p className="text-[12.5px] text-emerald-300">
                            Paid {item.paid_on} · expense in Salaries & Wages
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} width="max-w-3xl"
        title={f.id ? 'Edit teammate' : 'New teammate'}
        subtitle="Pay lines are a list, not fixed columns — add housing, drop a bonus, change the cap later."
        footer={<>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={saveMember} disabled={busy === 'save'}>
            {busy === 'save' ? <Spinner /> : 'Save member'}
          </button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Role"><Input value={f.role ?? ''} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Engineer" /></Field>
          <Field label="Email"><Input type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Start date"><Input type="date" value={f.start_date ?? ''} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
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
          <div className="sm:col-span-2">
            <Toggle checked={f.is_active !== false} onChange={(v) => setF({ ...f, is_active: v })} label="Active (counts toward typical burn)" />
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="label-mono">Pay lines</p>
            <button className="btn-ghost btn-xs" onClick={() => setF({
              ...f,
              components: [...components, {
                key: newPayLineKey(), kind: 'fixed_monthly', label: 'New pay line',
                amount: 0, enabled: true, conditions: '',
              }],
            })}><Plus size={13} /> Add pay line</button>
          </div>
          <div className="space-y-3">
            {components.map((c, i) => (
              <div key={c.key} className="rounded-lg border border-line bg-ink-800/50 p-3">
                <div className="grid gap-2 sm:grid-cols-12">
                  <Input className="sm:col-span-4" value={c.label} placeholder="Label"
                    onChange={(e) => setF({ ...f, components: components.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x) })} />
                  <Select className="sm:col-span-3" value={String(c.kind)}
                    onChange={(e) => setF({ ...f, components: components.map((x, idx) => idx === i ? { ...x, kind: e.target.value } : x) })}>
                    {PAY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </Select>
                  {c.kind === 'percent_of_base' ? (
                    <Input type="number" step="0.01" className="input-mono sm:col-span-2" placeholder="% of basic" value={c.pct ?? 0}
                      onChange={(e) => setF({ ...f, components: components.map((x, idx) => idx === i ? { ...x, pct: Number(e.target.value) } : x) })} />
                  ) : c.kind === 'capped_amount' ? (
                    <Input type="number" step="0.01" className="input-mono sm:col-span-2" placeholder="Cap ₹" value={c.cap ?? 0}
                      onChange={(e) => setF({ ...f, components: components.map((x, idx) => idx === i ? { ...x, cap: Number(e.target.value) } : x) })} />
                  ) : (
                    <Input type="number" step="0.01" className="input-mono sm:col-span-2" placeholder="₹ / month" value={c.amount ?? 0}
                      onChange={(e) => setF({ ...f, components: components.map((x, idx) => idx === i ? { ...x, amount: Number(e.target.value) } : x) })} />
                  )}
                  <div className="flex items-center gap-2 sm:col-span-3">
                    <Toggle checked={c.enabled} onChange={(v) => setF({
                      ...f, components: components.map((x, idx) => idx === i ? { ...x, enabled: v } : x),
                    })} label="On" />
                    <button className="btn-subtle btn-xs text-red-400 ml-auto"
                      onClick={() => setF({ ...f, components: components.filter((_, idx) => idx !== i) })}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <Input className="sm:col-span-12 text-[12.5px]" placeholder="Conditions (shown on the contract)"
                    value={c.conditions ?? ''}
                    onChange={(e) => setF({ ...f, components: components.map((x, idx) => idx === i ? { ...x, conditions: e.target.value } : x) })} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-right text-[13px] text-chrome">
            Full kit this person: <span className="font-mono text-white">{money(kitPreview.total, f.currency)}</span>
          </p>
        </div>
      </Modal>
      {confirmNode}
    </>
  );
}
