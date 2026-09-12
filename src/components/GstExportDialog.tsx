'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Archive, CalendarDays, Check, Download, FileSpreadsheet, Landmark, Receipt, X,
} from 'lucide-react';
import type { Client, Invoice, Payment } from '@/lib/types';
import type { PeriodType } from '@/lib/gst-compliance';
import {
  BASIS_META, availablePeriods, exportCsvText, exportFilename, selectExportLines,
  selectionLabel, summarise, zipInvoices,
  type ExportBasis,
} from '@/lib/gst-export';
import { downloadBlob } from '@/lib/zip';
import { money, moneyShort } from '@/lib/format';
import { InfoHint, Modal, Spinner, toast } from '@/components/ui';

/**
 * The "send it to my CA" widget.
 *
 * Two things the single-period pack could not do: choose which date the month
 * is measured by, and pick several months at once. Both matter because the two
 * accountants want different things — income tax wants everything raised in
 * July, GST wants whatever was actually collected.
 */

function BasisCard({
  basis, active, onPick, icon,
}: {
  basis: ExportBasis; active: boolean; onPick: () => void; icon: React.ReactNode;
}) {
  const m = BASIS_META[basis];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={`flex-1 rounded-[9px] border p-3.5 text-left transition ${
        active
          ? 'border-blue/50 bg-blue/10 ring-1 ring-inset ring-blue/30'
          : 'border-line bg-ink-800/40 hover:border-chrome-dark'}`}>
      <span className="flex items-center gap-2">
        <span className={active ? 'text-blue-300' : 'text-chrome'}>{icon}</span>
        <span className={`text-[13.5px] font-bold ${active ? 'text-white' : 'text-chrome-light'}`}>{m.label}</span>
        {active && <Check size={13} className="ml-auto shrink-0 text-blue-300" strokeWidth={3} />}
      </span>
      <span className="mt-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-chrome-dark">
        For your {m.who}
      </span>
      <span className="mt-1.5 block text-[11.5px] leading-snug text-chrome">{m.blurb}</span>
    </button>
  );
}

export default function GstExportDialog({
  open, onClose, invoices, payments, clients, periodType, initialKeys, initialBasis, onBasisChange,
}: {
  open: boolean;
  onClose: () => void;
  invoices: Invoice[];
  payments: Payment[];
  clients: Client[];
  periodType: PeriodType;
  initialKeys: string[];
  initialBasis: ExportBasis;
  onBasisChange?: (b: ExportBasis) => void;
}) {
  const [basis, setBasis] = useState<ExportBasis>(initialBasis);
  const [selected, setSelected] = useState<string[]>(initialKeys);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);

  // Re-seed each time the dialog opens, so it reflects the period you were
  // looking at rather than whatever you picked three days ago.
  useEffect(() => {
    if (!open) return;
    setBasis(initialBasis);
    setSelected(initialKeys);
  }, [open, initialBasis, initialKeys]);

  const periods = useMemo(
    () => availablePeriods({ invoices, payments, clients, basis, periodType }),
    [invoices, payments, clients, basis, periodType],
  );

  // Switching basis can strip a month that only exists on the other one.
  useEffect(() => {
    const valid = new Set(periods.map((p) => p.key));
    setSelected((s) => {
      const next = s.filter((k) => valid.has(k));
      return next.length === s.length ? s : next;
    });
  }, [periods]);

  const byFy = useMemo(() => {
    const map = new Map<string, { label: string; items: typeof periods }>();
    for (const p of periods) {
      const entry = map.get(p.fyStart) ?? { label: p.fyLabel, items: [] as typeof periods };
      entry.items.push(p);
      map.set(p.fyStart, entry);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [periods]);

  const lines = useMemo(
    () => selectExportLines({ invoices, payments, clients, keys: selected, basis, periodType }),
    [invoices, payments, clients, selected, basis, periodType],
  );
  const stats = useMemo(() => summarise(lines), [lines]);

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const busy = prog !== null;

  async function downloadZip() {
    if (!lines.length || busy) return;
    setProg({ done: 0, total: lines.length });
    try {
      const failed = await zipInvoices(
        lines.map((l) => ({
          invoiceId: l.invoice.id,
          invoiceNumber: l.invoice.invoice_number,
          folder: selected.length > 1 ? l.periodKey : undefined,
        })),
        {
          filename: exportFilename(selected, basis, 'zip'),
          indexCsv: exportCsvText(lines, basis),
          onProgress: (done, total) => setProg({ done, total }),
        },
      );
      if (failed.length) toast(`Packed, but ${failed.length} PDF${failed.length === 1 ? '' : 's'} failed: ${failed.join(', ')}`, 'error');
      else toast(`Packed ${stats.invoices} invoice${stats.invoices === 1 ? '' : 's'} across ${selected.length} period${selected.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not pack invoices', 'error');
    } finally {
      setProg(null);
    }
  }

  function downloadCsv() {
    if (!lines.length) return;
    downloadBlob(
      exportFilename(selected, basis, 'csv'),
      new Blob([exportCsvText(lines, basis)], { type: 'text/csv;charset=utf-8' }),
    );
    toast('CSV downloaded');
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => toast('Still packing — hold on.', 'info') : onClose}
      width="max-w-3xl"
      title="Download invoices"
      subtitle="Pick the date basis, then tag every month you need. One zip, one CSV."
      footer={
        <>
          <span className="mr-auto text-[12px] text-chrome">
            {stats.lines === 0
              ? 'Select at least one month'
              : <>{stats.invoices} invoice{stats.invoices === 1 ? '' : 's'} · {money(stats.taxable)} before tax · {money(stats.tax)} GST</>}
          </span>
          <button className="btn-ghost btn-sm" onClick={downloadCsv} disabled={!lines.length || busy}>
            <FileSpreadsheet size={14} /> CSV only
          </button>
          <button className="btn-primary" onClick={downloadZip} disabled={!lines.length || busy}>
            {busy ? <Spinner size={14} /> : <Archive size={14} />}
            {busy ? `Packing ${prog!.done}/${prog!.total}…` : 'Download zip'}
          </button>
        </>
      }>

      {/* ------------------------------------------------------------ basis */}
      <div role="radiogroup" aria-label="Date basis" className="flex flex-col gap-2.5 sm:flex-row">
        <BasisCard
          basis="raised"
          icon={<Receipt size={15} />}
          active={basis === 'raised'}
          onPick={() => { setBasis('raised'); onBasisChange?.('raised'); }}
        />
        <BasisCard
          basis="paid"
          icon={<Landmark size={15} />}
          active={basis === 'paid'}
          onPick={() => { setBasis('paid'); onBasisChange?.('paid'); }}
        />
      </div>

      {/* ------------------------------------------------------------ chips */}
      <div className="mt-5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-chrome">
            <CalendarDays size={13} /> Periods
            <InfoHint
              side="bottom"
              tip={`Only periods with something to send are listed, and the counts follow the basis above. On the ${BASIS_META[basis].label.toLowerCase()} basis, ${BASIS_META[basis].blurb.toLowerCase()}`}
            />
          </h4>
          <div className="flex items-center gap-1.5">
            {selected.length > 0 && (
              <button className="btn-subtle btn-xs" onClick={() => setSelected([])} disabled={busy}>Clear</button>
            )}
            <button
              className="btn-subtle btn-xs"
              disabled={busy || periods.length === 0}
              onClick={() => setSelected(periods.map((p) => p.key))}>
              Select all
            </button>
          </div>
        </div>

        {periods.length === 0 ? (
          <p className="rounded-[8px] border border-line bg-ink-800/40 px-4 py-6 text-center text-[12.5px] text-chrome">
            Nothing to export on this basis yet.
          </p>
        ) : (
          <div className="space-y-3.5">
            {byFy.map(([fyStart, group]) => {
              const allOn = group.items.every((p) => selected.includes(p.key));
              return (
                <div key={fyStart}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="label-mono">{group.label}</span>
                    <button
                      className="text-[11px] text-chrome hover:text-white"
                      disabled={busy}
                      onClick={() => setSelected((s) => {
                        const keys = group.items.map((p) => p.key);
                        return allOn ? s.filter((k) => !keys.includes(k)) : [...new Set([...s, ...keys])];
                      })}>
                      {allOn ? 'none' : 'all'}
                    </button>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((p) => {
                      const on = selected.includes(p.key);
                      return (
                        <button
                          key={p.key}
                          type="button"
                          aria-pressed={on}
                          disabled={busy}
                          onClick={() => toggle(p.key)}
                          title={`${p.count} invoice${p.count === 1 ? '' : 's'} · ${money(p.taxable)} before tax · ${money(p.tax)} GST`}
                          className={`group inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 text-[12.5px] font-semibold transition ${
                            on
                              ? 'border-blue/50 bg-blue/15 text-white'
                              : 'border-line bg-ink-800/50 text-chrome-light hover:border-chrome-dark hover:text-white'}`}>
                          {on
                            ? <Check size={12} strokeWidth={3} className="text-blue-300" />
                            : <span className="h-3 w-3 rounded-[3px] border border-chrome-dark" />}
                          {p.label}
                          <span className={`font-mono text-[10.5px] ${on ? 'text-blue-200' : 'text-chrome-dark'}`}>
                            {p.count}
                          </span>
                          {on && (
                            <X
                              size={11}
                              className="text-blue-200/70 transition group-hover:text-white"
                              aria-hidden
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- preview */}
      {lines.length > 0 && (
        <div className="mt-5 rounded-[9px] border border-line bg-ink-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/80 px-4 py-2.5">
            <p className="text-[12.5px] font-semibold text-white">
              {selectionLabel(selected, periodType)}
            </p>
            <p className="text-[11.5px] text-chrome">
              {BASIS_META[basis].short} basis · {money(stats.total)} total
              {stats.unpaid > 0 && basis === 'raised' && (
                <span className="ml-1.5 text-amber-300">· {stats.unpaid} still unpaid</span>
              )}
            </p>
          </div>
          <div className="max-h-[190px] overflow-y-auto">
            <table className="w-full">
              <tbody>
                {lines.slice(0, 60).map((l, idx) => (
                  <tr key={`${l.invoice.id}-${l.periodKey}-${idx}`} className="border-t border-line/50 first:border-t-0">
                    <td className="px-4 py-2 font-mono text-[11.5px] text-chrome-dark">{l.periodKey}</td>
                    <td className="px-2 py-2 font-mono text-[12px] text-white">{l.invoice.invoice_number}</td>
                    <td className="max-w-[190px] truncate px-2 py-2 text-[12px] text-[#C9CEDA]">{l.clientName}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[12px] text-chrome">
                      {moneyShort(l.taxable)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-[12px] text-white">
                      {moneyShort(l.taxInPeriod)}
                      {l.partial && <span className="ml-1 text-[10px] text-amber-300">part</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines.length > 60 && (
            <p className="border-t border-line/80 px-4 py-2 text-[11.5px] text-chrome-dark">
              …and {lines.length - 60} more. All of them go in the download.
            </p>
          )}
          <p className="flex items-center gap-1.5 border-t border-line/80 px-4 py-2 text-[11px] text-chrome-dark">
            <Download size={11} />
            {selected.length > 1
              ? `Zip contains one folder per period, plus _index.csv listing every invoice. File: ${exportFilename(selected, basis, 'zip')}`
              : `Zip contains the PDFs plus _index.csv. File: ${exportFilename(selected, basis, 'zip')}`}
          </p>
        </div>
      )}
    </Modal>
  );
}
