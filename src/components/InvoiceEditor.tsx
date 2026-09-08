'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Save, Eye, PencilLine, UserPlus, Loader2, Info, GripVertical } from 'lucide-react';
import { useClients, useItems, useProfile } from '@/lib/hooks';
import { emptyLine, loadInvoice, peekNumber, saveInvoice } from '@/lib/invoice-service';
import {
  GST_RATES, STATE_CODES, TAX_MODE_LABEL, computeTotals, defaultPlaceOfSupply,
  resolveTaxMode, stateNameByCode, supplierState,
} from '@/lib/gst';
import { CURRENCIES, addDays, money, num, todayISO } from '@/lib/format';
import { TERM_PRESETS, resolveInvoiceTerms } from '@/lib/terms';
import { UNITS, unitLabel, type Client, type DocType, type Invoice, type InvoiceLine, type TaxMode } from '@/lib/types';
import { Card, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, toast, Spinner } from './ui';
import { SacPicker } from './SacPicker';
import { resolveSacCodes } from '@/lib/sac';
import ClientForm from './ClientForm';
import InvoicePaper from './InvoicePaper';

export default function InvoiceEditor({ docType, invoiceId, presetClientId }: {
  docType: DocType; invoiceId?: string; presetClientId?: string | null;
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const { clients, reload: reloadClients } = useClients();
  const { items } = useItems();

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const [autoNumber, setAutoNumber] = useState(!invoiceId);
  const [roundOff, setRoundOff] = useState(true);
  const [modeOverride, setModeOverride] = useState(false);
  const [h, setH] = useState<Partial<Invoice>>({
    doc_type: docType, invoice_date: todayISO(), terms_label: 'Due on Receipt',
    currency: 'INR', exchange_rate: 1, tax_mode: 'inter', status: 'draft',
  });
  const [lines, setLines] = useState<InvoiceLine[]>([emptyLine(0, { unit: 'hour' })]);

  const set = <K extends keyof Invoice>(k: K, v: Invoice[K]) => setH((s) => ({ ...s, [k]: v }));
  const client = useMemo(() => clients.find((c) => c.id === h.client_id) ?? null, [clients, h.client_id]);
  const supplier = supplierState(profile);

  /* ---------------------------------------------------------- bootstrap */
  useEffect(() => {
    (async () => {
      if (invoiceId) {
        try {
          const inv = await loadInvoice(invoiceId);
          setH(inv);
          setLines(inv.invoice_items?.length ? inv.invoice_items : [emptyLine(0, { unit: 'hour' })]);
          setRoundOff(Math.abs(Number(inv.round_off)) > 0 || true);
          setModeOverride(true);
        } catch (e) { toast(e instanceof Error ? e.message : 'Could not load', 'error'); }
        setReady(true);
        return;
      }
      const seedRaw = typeof window !== 'undefined' ? sessionStorage.getItem('bl:draft-seed') : null;
      const number = await peekNumber(docType);
      setH((s) => ({
        ...s, invoice_number: number,
        due_date: addDays(todayISO(), profile?.default_due_days ?? 7),
        notes: profile?.default_notes ?? '', terms: profile?.default_terms ?? '',
        lut_number: profile?.lut_number ?? null,
      }));
      if (seedRaw) {
        sessionStorage.removeItem('bl:draft-seed');
        try {
          const seed = JSON.parse(seedRaw) as { header?: Partial<Invoice>; lines?: InvoiceLine[] };
          if (seed.header) setH((s) => ({ ...s, ...seed.header }));
          if (seed.lines?.length) setLines(seed.lines.map((l, i) => emptyLine(i, l)));
        } catch { /* ignore */ }
      } else if (presetClientId) {
        set('client_id', presetClientId);
      } else {
        setLines([emptyLine(0, {
          unit: 'hour',
          code: profile?.default_sac ?? resolveSacCodes(profile?.sac_codes)[0]?.code ?? '',
          gst_rate: Number(profile?.default_gst_rate ?? 18),
        })]);
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, profile?.id]);

  /* ------------------------------------------------- client-driven defaults */
  function applyClient(c: Client | null) {
    if (!c) return;
    const pos = defaultPlaceOfSupply(c);
    const mode = resolveTaxMode(supplier.code, c.gst_treatment, pos.code);
    setH((s) => ({
      ...s,
      client_id: c.id,
      client_snapshot: c,
      place_of_supply_code: pos.code,
      place_of_supply: pos.name,
      currency: c.currency || 'INR',
      exchange_rate: (c.currency || 'INR') === 'INR' ? 1 : Number(s.exchange_rate) || 83,
      tax_mode: mode,
      ...resolveInvoiceTerms({
        invoiceDate: s.invoice_date ?? todayISO(),
        paymentTermsDays: c.payment_terms_days,
      }),
      tds_applicable: c.tds_applicable,
      tds_section: c.tds_section, tds_rate: c.tds_rate ?? 10,
      subject: s.subject || `${c.company_name} — ${docType === 'quote' ? 'Proposal' : 'Services'}`,
    }));
    setModeOverride(false);
    if (c.default_gst_rate || c.default_sac) {
      setLines((ls) => ls.map((l) => ({
        ...l,
        gst_rate: l.gst_rate || Number(c.default_gst_rate ?? 18),
        code: l.code || c.default_sac || '',
      })));
    }
  }

  // keep tax mode honest when place of supply changes
  useEffect(() => {
    if (modeOverride || !client) return;
    const mode = resolveTaxMode(supplier.code, client.gst_treatment, h.place_of_supply_code);
    if (mode !== h.tax_mode) set('tax_mode', mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.place_of_supply_code, client?.id, supplier.code]);

  /* ---------------------------------------------------------- line editing */
  const updateLine = (i: number, patch: Partial<InvoiceLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function pickCatalog(i: number, name: string) {
    const found = items.find((it) => it.name.toLowerCase() === name.toLowerCase());
    if (!found) return updateLine(i, { name, description: '', item_id: null });
    updateLine(i, {
      name: found.name, description: found.description ?? '', code: found.code ?? '',
      code_type: found.code_type, unit: found.unit, rate: Number(found.rate) || 0,
      gst_rate: Number(found.gst_rate), item_id: found.id,
    });
  }

  const totals = useMemo(
    () => computeTotals(lines, (h.tax_mode ?? 'inter') as TaxMode, {
      roundOff, tdsApplicable: !!h.tds_applicable, tdsRate: Number(h.tds_rate ?? 10),
    }),
    [lines, h.tax_mode, h.tds_applicable, h.tds_rate, roundOff],
  );

  const previewInvoice: Partial<Invoice> = {
    ...h, ...totals, balance_due: totals.total - Number(h.amount_paid ?? 0), amount_paid: Number(h.amount_paid ?? 0),
  };
  const previewLines = lines.map((l) => {
    const c = computeTotals([l], (h.tax_mode ?? 'inter') as TaxMode, { roundOff: false });
    return { ...l, taxable_value: c.subtotal, cgst_amount: c.cgst_total, sgst_amount: c.sgst_total, igst_amount: c.igst_total };
  });

  /* ---------------------------------------------------------------- save */
  async function persist(nextStatus?: string) {
    if (!h.client_id) return toast('Choose a client first', 'error');
    setBusy(true);
    try {
      const id = await saveInvoice({
        id: invoiceId ?? null,
        header: { ...h, status: (nextStatus ?? h.status ?? 'draft') as Invoice['status'] },
        lines, autoNumber, roundOff,
      });
      toast(invoiceId ? 'Saved' : `${docType === 'quote' ? 'Quote' : 'Invoice'} created`);
      router.push(`/app/invoices/${id}`);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally { setBusy(false); }
  }

  if (!ready) return <Loading label="Preparing document" />;

  const isExport = h.tax_mode === 'export_lut' || h.tax_mode === 'export_paid';
  const showCgst = h.tax_mode === 'intra';

  return (
    <>
      <PageHeader
        title={invoiceId ? `Edit ${h.invoice_number}` : docType === 'quote' ? 'New quote' : 'New invoice'}
        subtitle={client ? `${client.company_name} · ${TAX_MODE_LABEL[(h.tax_mode ?? 'inter') as TaxMode]}` : 'Pick a client to begin'}>
        <button className="btn-ghost" onClick={() => setPreview(!preview)}>
          {preview ? <><PencilLine size={15} /> Back to edit</> : <><Eye size={15} /> Preview</>}
        </button>
        <button className="btn-primary" onClick={() => persist()} disabled={busy}>
          {busy ? <Spinner /> : <><Save size={15} /> {invoiceId ? 'Save changes' : 'Save draft'}</>}
        </button>
      </PageHeader>

      {preview ? (
        <div className="rounded-xl border border-line bg-ink-800/40 p-4 sm:p-8">
          <InvoicePaper invoice={previewInvoice} lines={previewLines} client={client} profile={profile} />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <div className="space-y-5 min-w-0">
            {/* ---------------- header card ---------------- */}
            <Card title="Document details">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Client" required className="lg:col-span-2">
                  <div className="flex gap-2">
                    <Select value={h.client_id ?? ''}
                      onChange={(e) => applyClient(clients.find((c) => c.id === e.target.value) ?? null)}>
                      <option value="">— Select a client —</option>
                      {clients.filter((c) => c.status === 'active' || c.id === h.client_id).map((c) => (
                        <option key={c.id} value={c.id}>{c.company_name}</option>
                      ))}
                    </Select>
                    <button className="btn-ghost shrink-0" onClick={() => setNewClient(true)} title="New client"><UserPlus size={15} /></button>
                  </div>
                </Field>

                <Field label={docType === 'quote' ? 'Quote number' : 'Invoice number'} required
                  hint={autoNumber ? 'Assigned from the series when you save' : 'Manual — make sure it is unique'}>
                  <div className="flex gap-2">
                    <Input className="input-mono" value={h.invoice_number ?? ''} disabled={autoNumber && !invoiceId}
                      onChange={(e) => set('invoice_number', e.target.value)} />
                    {!invoiceId && (
                      <button className={`btn ${autoNumber ? 'btn-ghost' : 'btn-primary'} shrink-0 px-2.5`}
                        title={autoNumber ? 'Switch to manual' : 'Back to auto series'}
                        onClick={() => setAutoNumber(!autoNumber)}>
                        <PencilLine size={14} />
                      </button>
                    )}
                  </div>
                </Field>

                <Field label={docType === 'quote' ? 'Quote date' : 'Invoice date'} required>
                  <Input type="date" value={h.invoice_date ?? ''} onChange={(e) => {
                    set('invoice_date', e.target.value);
                    const preset = TERM_PRESETS.find((t) => t.label === h.terms_label);
                    if (preset && preset.days >= 0) set('due_date', addDays(e.target.value, preset.days));
                  }} />
                </Field>

                <Field label="Terms">
                  <Select
                    value={TERM_PRESETS.some((t) => t.label === h.terms_label) ? h.terms_label! : 'Custom'}
                    onChange={(e) => {
                    const preset = TERM_PRESETS.find((t) => t.label === e.target.value)!;
                    set('terms_label', preset.label);
                    if (preset.days >= 0) set('due_date', addDays(h.invoice_date ?? todayISO(), preset.days));
                  }}>
                    {TERM_PRESETS.map((t) => <option key={t.label}>{t.label}</option>)}
                  </Select>
                </Field>

                <Field label={docType === 'quote' ? 'Valid till' : 'Due date'}>
                  <Input type="date" value={h.due_date ?? ''}
                    onChange={(e) => { set('due_date', e.target.value); set('terms_label', 'Custom'); }} />
                </Field>

                <Field label="Place of supply" hint="Drives IGST vs CGST + SGST">
                  <Select value={h.place_of_supply_code ?? ''} onChange={(e) => {
                    set('place_of_supply_code', e.target.value);
                    set('place_of_supply', stateNameByCode(e.target.value));
                  }}>
                    <option value="">—</option>
                    {STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                  </Select>
                </Field>

                <Field label="Tax treatment" className="lg:col-span-2"
                  hint={`Supplier state ${supplier.name} (${supplier.code}). ${modeOverride ? 'Manually overridden.' : 'Auto-detected.'}`}>
                  <Select value={h.tax_mode ?? 'inter'}
                    onChange={(e) => { set('tax_mode', e.target.value as TaxMode); setModeOverride(true); }}>
                    {(Object.keys(TAX_MODE_LABEL) as TaxMode[]).map((m) => (
                      <option key={m} value={m}>{TAX_MODE_LABEL[m]}</option>
                    ))}
                  </Select>
                </Field>

                <Field label="Currency">
                  <Select value={h.currency ?? 'INR'} onChange={(e) => {
                    set('currency', e.target.value);
                    if (e.target.value === 'INR') set('exchange_rate', 1);
                  }}>
                    {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                  </Select>
                </Field>

                {h.currency !== 'INR' && (
                  <Field label="Exchange rate to INR" hint="Used for revenue & GST reporting">
                    <Input type="number" step="0.0001" className="input-mono" value={h.exchange_rate ?? 1}
                      onChange={(e) => set('exchange_rate', Number(e.target.value))} />
                  </Field>
                )}

                {isExport && (
                  <Field label="LUT / Bond ARN" hint="Printed on the export declaration">
                    <Input className="input-mono" value={h.lut_number ?? ''} onChange={(e) => set('lut_number', e.target.value)} />
                  </Field>
                )}

                <Field label="PO number"><Input value={h.po_number ?? ''} onChange={(e) => set('po_number', e.target.value)} /></Field>

                <Field label="Subject" className="sm:col-span-2 lg:col-span-3">
                  <Input value={h.subject ?? ''} onChange={(e) => set('subject', e.target.value)}
                    placeholder="AAFM India - Consulting CTO - Akhil Alampally" />
                </Field>
              </div>
            </Card>

            {/* ---------------- line items ---------------- */}
            <Card title="Line items" subtitle="One line per service. SAC and units sit underneath."
              bodyClass="p-0"
              action={<button className="btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, emptyLine(ls.length, {
                code: client?.default_sac ?? profile?.default_sac ?? resolveSacCodes(profile?.sac_codes)[0]?.code ?? '',
                gst_rate: Number(client?.default_gst_rate ?? profile?.default_gst_rate ?? 18),
                unit: ls[ls.length - 1]?.unit ?? 'hour',
              })])}>
                <Plus size={14} /> Add line
              </button>}>
              <datalist id="catalog">
                {items.map((i) => <option key={i.id} value={i.name} />)}
              </datalist>

              <div className="divide-y divide-line">
                {lines.map((l, i) => {
                  const c = computeTotals([l], (h.tax_mode ?? 'inter') as TaxMode, { roundOff: false });
                  return (
                    <div key={i} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <GripVertical size={13} className="shrink-0 text-chrome-dark" />
                        <Input
                          list="catalog"
                          className="h-8 flex-1 border-transparent bg-transparent px-1.5 text-[14px] font-medium shadow-none hover:bg-ink-800/70 focus:border-line focus:bg-ink-800"
                          placeholder="Item description"
                          value={l.name}
                          onChange={(e) => pickCatalog(i, e.target.value)}
                        />
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[13.5px] tabular-nums text-white">{num(c.subtotal)}</p>
                          {c.tax_total > 0 && (
                            <p className="font-mono text-[10.5px] tabular-nums text-chrome-dark">+{num(c.tax_total)} tax</p>
                          )}
                        </div>
                        <button className="btn-subtle btn-xs shrink-0 text-red-400 hover:text-red-300" disabled={lines.length === 1}
                          onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                        <Select className="input-compact w-[4.6rem]" value={l.code_type ?? 'SAC'}
                          onChange={(e) => updateLine(i, { code_type: e.target.value })}>
                          <option value="SAC">SAC</option><option value="HSN">HSN</option>
                        </Select>
                        {(l.code_type ?? 'SAC') === 'HSN' ? (
                          <Input className="input-compact input-mono w-[6.5rem]" placeholder="HSN" value={l.code ?? ''}
                            onChange={(e) => updateLine(i, { code: e.target.value.replace(/\s/g, '') })} />
                        ) : (
                          <SacPicker compact value={l.code ?? ''} codes={profile?.sac_codes}
                            onChange={(code) => updateLine(i, { code, code_type: 'SAC' })} />
                        )}

                        <span className="ml-1 text-[11px] font-medium text-chrome">{unitLabel(l.unit)}</span>
                        <Input type="number" step="0.01" min={0}
                          className="input-compact input-mono w-[3.75rem] text-right" value={l.quantity}
                          onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} />
                        <Select className="input-compact w-[6.75rem]" value={l.unit ?? 'hour'}
                          onChange={(e) => updateLine(i, { unit: e.target.value })}>
                          {UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                        </Select>

                        <span className="text-[11px] font-medium text-chrome">Rate</span>
                        <Input type="number" step="0.01" className="input-compact input-mono w-[5.5rem] text-right" value={l.rate}
                          onChange={(e) => updateLine(i, { rate: Number(e.target.value) })} />

                        <span className="text-[11px] font-medium text-chrome">Disc %</span>
                        <Input type="number" step="0.01" className="input-compact input-mono w-[3.5rem] text-right" value={l.discount_pct}
                          onChange={(e) => updateLine(i, { discount_pct: Number(e.target.value) })} />

                        <span className="text-[11px] font-medium text-chrome">GST</span>
                        <Select className="input-compact w-[4.4rem]" value={String(l.gst_rate)}
                          disabled={h.tax_mode === 'export_lut' || h.tax_mode === 'exempt'}
                          onChange={(e) => updateLine(i, { gst_rate: Number(e.target.value) })}>
                          {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* ---------------- notes ---------------- */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Notes on the invoice" subtitle="Bank details are appended automatically.">
                <Textarea rows={4} value={h.notes ?? ''} onChange={(e) => set('notes', e.target.value)}
                  placeholder={'HSN Code: 999293'} />
              </Card>
              <Card title="Terms & conditions">
                <Textarea rows={4} value={h.terms ?? ''} onChange={(e) => set('terms', e.target.value)} />
              </Card>
              <Card title="Internal notes" subtitle="Never shown to the client." className="lg:col-span-2">
                <Textarea rows={2} value={h.internal_notes ?? ''} onChange={(e) => set('internal_notes', e.target.value)} />
              </Card>
            </div>
          </div>

          {/* ---------------- summary rail ---------------- */}
          <div className="xl:sticky xl:top-6 xl:self-start space-y-4">
            <Card title="Summary">
              <dl className="space-y-2 text-[13px]">
                <div className="flex justify-between"><dt className="text-chrome">Sub total</dt>
                  <dd className="font-mono tabular-nums text-white">{money(totals.subtotal, h.currency)}</dd></div>
                {totals.discount_total > 0 && (
                  <div className="flex justify-between"><dt className="text-chrome">Discount</dt>
                    <dd className="font-mono tabular-nums text-amber-300">-{num(totals.discount_total)}</dd></div>)}
                {showCgst ? (
                  <>
                    <div className="flex justify-between"><dt className="text-chrome">CGST</dt>
                      <dd className="font-mono tabular-nums text-white">{num(totals.cgst_total)}</dd></div>
                    <div className="flex justify-between"><dt className="text-chrome">SGST</dt>
                      <dd className="font-mono tabular-nums text-white">{num(totals.sgst_total)}</dd></div>
                  </>
                ) : (h.tax_mode === 'inter' || h.tax_mode === 'export_paid') ? (
                  <div className="flex justify-between"><dt className="text-chrome">IGST</dt>
                    <dd className="font-mono tabular-nums text-white">{num(totals.igst_total)}</dd></div>
                ) : (
                  <div className="flex justify-between"><dt className="text-chrome">GST</dt>
                    <dd className="font-mono text-emerald-300">Zero-rated</dd></div>
                )}
                {Math.abs(totals.round_off) > 0.001 && (
                  <div className="flex justify-between"><dt className="text-chrome">Round off</dt>
                    <dd className="font-mono tabular-nums text-chrome-light">{num(totals.round_off)}</dd></div>)}
                <div className="mt-2 flex justify-between border-t border-line pt-3">
                  <dt className="font-semibold text-white">Total</dt>
                  <dd className="font-display text-[22px] leading-none text-white">{money(totals.total, h.currency)}</dd>
                </div>
                {h.currency !== 'INR' && (
                  <p className="pt-1 text-right text-[11px] text-chrome-dark">
                    ≈ {money(totals.total * (Number(h.exchange_rate) || 1))} at {h.exchange_rate}
                  </p>
                )}
              </dl>

              <div className="mt-4 space-y-3 border-t border-line pt-3">
                <Toggle checked={roundOff} onChange={setRoundOff} label="Round off to nearest rupee" />
                <Toggle checked={!!h.reverse_charge} onChange={(v) => set('reverse_charge', v)} label="Reverse charge applicable" />
                <Toggle checked={!!h.tds_applicable} onChange={(v) => set('tds_applicable', v)} label="Client deducts TDS" />
                {h.tds_applicable && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input className="text-[12px]" value={h.tds_section ?? '194J'} onChange={(e) => set('tds_section', e.target.value)} />
                    <Input type="number" step="0.01" className="input-mono text-[12px]" value={h.tds_rate ?? 10}
                      onChange={(e) => set('tds_rate', Number(e.target.value))} />
                  </div>
                )}
                {h.tds_applicable && totals.tds_amount > 0 && (
                  <p className="flex gap-1.5 rounded-lg border border-line bg-ink-800/60 px-2.5 py-2 text-[11.5px] leading-snug text-chrome">
                    <Info size={13} className="mt-px shrink-0" />
                    TDS {money(totals.tds_amount, h.currency)} tracked separately — the invoice total stays{' '}
                    {money(totals.total, h.currency)}. Expected receipt {money(totals.net_receivable, h.currency)}.
                  </p>
                )}
              </div>
            </Card>

            {client && (
              <Card title="Client on file">
                <p className="text-[13.5px] font-semibold text-white">{client.company_name}</p>
                <p className="mt-0.5 text-[12px] text-chrome">{client.email || 'No email on file'}</p>
                {client.gstin && <p className="mt-1 font-mono text-[11.5px] text-chrome-light">{client.gstin}</p>}
                <p className="mt-2 text-[11.5px] text-chrome-dark">
                  {client.place_of_supply_state} · {client.currency} · Net {client.payment_terms_days}
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      <ClientForm open={newClient} onClose={() => setNewClient(false)} onSaved={(c) => { reloadClients(); applyClient(c); }} />
    </>
  );
}
