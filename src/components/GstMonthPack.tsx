'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  Archive, Ban, Building2, CheckCircle2, Copy, Download, FileText, Landmark, Send, Wallet,
} from 'lucide-react';
import type { CompanyProfile, Expense } from '@/lib/types';
import {
  SHARE_KIND_LABEL, llpAccountLabel, type MonthPack, type PackLine,
} from '@/lib/gst-compliance';
import { csvEscape, fmtDate, money, monthLabelLong } from '@/lib/format';
import { fxInr } from '@/lib/finance';
import { STATUS_LABEL, Spinner, toast } from '@/components/ui';
import { downloadBlob, zipStore } from '@/lib/zip';

function LineTable({
  lines, collectedLabel, extra, dateOf,
}: {
  lines: PackLine[];
  collectedLabel?: string;
  extra?: (l: PackLine) => ReactNode;
  dateOf?: (l: PackLine) => string | null;
}) {
  const when = dateOf ?? ((l: PackLine) => l.collectedOn);
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[640px]">
        <thead><tr className="bg-ink-800/60">
          <th className="th">Invoice</th>
          <th className="th">Client</th>
          <th className="th">{collectedLabel ?? 'Paid on'}</th>
          <th className="th text-right">Before tax</th>
          <th className="th text-right">GST</th>
        </tr></thead>
        <tbody>
          {lines.map((l) => {
            const d = when(l);
            return (
              <tr key={l.invoice.id}>
                <td className="td">
                  <Link href={`/app/invoices/${l.invoice.id}`} className="font-mono text-[12.5px] text-white hover:text-blue-200">
                    {l.invoice.invoice_number}
                  </Link>
                  {l.gstin && <span className="mt-0.5 block font-mono text-[10.5px] text-chrome-dark">{l.gstin}</span>}
                  {extra?.(l)}
                </td>
                <td className="td text-[12.5px] text-[#C9CEDA]">
                  {l.clientName}
                  <span className="mt-0.5 block text-[11px] text-chrome">{SHARE_KIND_LABEL[l.kind]}</span>
                </td>
                <td className="td text-[12px] text-chrome">{d ? fmtDate(d) : '—'}</td>
                <td className="td text-right font-mono tabular-nums text-[12.5px]">{money(l.taxable)}</td>
                <td className="td text-right font-mono tabular-nums text-[13px] font-semibold text-white">{money(l.tax)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function safeZipName(invoiceNumber: string, used: Set<string>) {
  const base = `${invoiceNumber}.pdf`.replace(/[^\w.-]/g, '_');
  if (!used.has(base)) { used.add(base); return base; }
  let n = 2;
  let name = `${invoiceNumber}-${n}.pdf`.replace(/[^\w.-]/g, '_');
  while (used.has(name)) {
    n += 1;
    name = `${invoiceNumber}-${n}.pdf`.replace(/[^\w.-]/g, '_');
  }
  used.add(name);
  return name;
}

async function zipIssuedInvoices(
  lines: PackLine[],
  periodKey: string,
  onProgress: (done: number, total: number) => void,
) {
  const used = new Set<string>();
  const files: { name: string; data: Uint8Array }[] = [];
  const failed: string[] = [];
  const index = [[
    'Invoice', 'Date', 'Client', 'GSTIN', 'Status', 'Taxable', 'GST', 'Total',
  ]];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const name = safeZipName(l.invoice.invoice_number, used);
    index.push([
      l.invoice.invoice_number, l.invoiceDate, l.clientName, l.gstin,
      STATUS_LABEL[l.invoice.status] ?? l.invoice.status,
      l.taxable.toFixed(2), l.tax.toFixed(2), l.total.toFixed(2),
    ]);
    const res = await fetch(`/api/invoices/${l.invoice.id}/pdf`);
    if (!res.ok) {
      failed.push(l.invoice.invoice_number);
    } else {
      files.push({ name, data: new Uint8Array(await res.arrayBuffer()) });
    }
    onProgress(i + 1, lines.length);
  }

  const csv = `\uFEFF${index.map((row) => row.map(csvEscape).join(',')).join('\n')}`;
  files.unshift({ name: '_index.csv', data: new TextEncoder().encode(csv) });
  downloadBlob(`invoices-${periodKey}.zip`, zipStore(files));
  return failed;
}

function Section({
  icon, title, count, tone, children, empty,
}: {
  icon: ReactNode; title: string; count: number;
  tone: string; children: ReactNode; empty: string;
}) {
  return (
    <section className="border-t border-line">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}>{icon}</span>
          <h3 className="text-[14px] font-bold text-white">{title}</h3>
        </div>
        <span className="pill bg-ink-500 text-chrome">{count}</span>
      </header>
      {count === 0 ? <p className="px-5 pb-5 text-[13px] text-chrome-dark">{empty}</p> : children}
    </section>
  );
}

export default function GstMonthPack({
  pack, profile, onCopy, onCsv, onGstr1, onRecord,
}: {
  pack: MonthPack;
  profile: CompanyProfile | null;
  onCopy: () => void;
  onCsv: () => void;
  onGstr1: () => void;
  onRecord: () => void;
}) {
  const llp = llpAccountLabel(profile);
  const t = pack.totals;
  const hold = pack.issuedUnpaid.length + pack.earlierUnpaid.length;
  const heading = /^\d{4}-\d{2}$/.test(pack.key) ? monthLabelLong(pack.key) : pack.label;
  const [zipProg, setZipProg] = useState<{ done: number; total: number } | null>(null);

  async function downloadZip() {
    if (!pack.issued.length) return toast('No invoices were dated this period.', 'info');
    if (zipProg) return;
    setZipProg({ done: 0, total: pack.issued.length });
    try {
      const failed = await zipIssuedInvoices(pack.issued, pack.key, (done, total) => setZipProg({ done, total }));
      if (failed.length) toast(`Packed with ${failed.length} missing: ${failed.join(', ')}`, 'error');
      else toast(`Packed ${pack.issued.length} invoice${pack.issued.length === 1 ? '' : 's'} for ${heading}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not pack invoices', 'error');
    } finally {
      setZipProg(null);
    }
  }

  return (
    <div className="card overflow-hidden">
      <header className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-mono">Filing period</p>
            <h2 className="mt-1 font-display text-[26px] leading-none text-white">{heading}</h2>
            <p className="mt-1.5 max-w-md text-[12.5px] leading-snug text-chrome">
              Invoice PDFs dated this period, packed as one zip for the CA. Pick a past month if you missed the window.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" onClick={downloadZip} disabled={!!zipProg || pack.issued.length === 0}>
              {zipProg ? <Spinner size={14} /> : <Archive size={14} />}
              {zipProg
                ? `Packing ${zipProg.done}/${zipProg.total}…`
                : `Download ${pack.issued.length} invoice${pack.issued.length === 1 ? '' : 's'}`}
            </button>
            <button className="btn-ghost btn-sm" onClick={onCopy}><Copy size={14} /> Copy briefing</button>
            <button className="btn-ghost btn-sm" onClick={onCsv}><Download size={14} /> Pack CSV</button>
            <button className="btn-ghost btn-sm" onClick={onGstr1}><Download size={14} /> GSTR-1 CSV</button>
            <button className="btn-ghost btn-sm" onClick={onRecord}><Landmark size={14} /> Record payment</button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Invoices dated here', String(pack.issued.length), 'text-white'],
            ['Tax collected', money(t.output), 'text-white'],
            ['Claim back', money(t.itc), 'text-emerald-300'],
            ['Pay from company', money(t.netLlp), 'text-amber-300'],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-line bg-ink-800/40 px-3.5 py-2.5">
              <p className="label-mono">{l}</p>
              <p className={`mt-1 font-display text-[22px] leading-none ${c}`}>{v}</p>
            </div>
          ))}
        </div>
      </header>

      <Section
        icon={<Archive size={15} />}
        tone="bg-blue/15 text-blue-300"
        title="Invoices dated this period — pack for the CA"
        count={pack.issued.length}
        empty="No invoices were dated this period.">
        <LineTable
          lines={pack.issued}
          collectedLabel="Issued"
          dateOf={(l) => l.invoiceDate}
          extra={(l) => l.collectedOn ? (
            <span className="mt-0.5 block text-[10.5px] text-chrome-dark">Paid {fmtDate(l.collectedOn)}</span>
          ) : (
            <span className="mt-0.5 block text-[10.5px] text-amber-200/80">Unpaid</span>
          )} />
      </Section>

      <Section
        icon={<Send size={15} />}
        tone="bg-emerald-500/15 text-emerald-300"
        title="Paid — GST to file"
        count={pack.share.length}
        empty="No paid invoices this period.">
        <LineTable lines={pack.share} extra={(l) => l.paymentRefs.length ? (
          <span className="mt-0.5 block text-[10.5px] text-chrome-dark">{l.paymentRefs.join(' · ')}</span>
        ) : null} />
      </Section>

      <Section
        icon={<FileText size={15} />}
        tone="bg-blue/15 text-blue-300"
        title="Exports — copies only, no GST to pay"
        count={pack.zeroRated.length}
        empty="No export collections this period.">
        <LineTable lines={pack.zeroRated} />
      </Section>

      <Section
        icon={<Wallet size={15} />}
        tone="bg-amber-500/15 text-amber-300"
        title="Part-paid"
        count={pack.partial.length}
        empty="No part-payments this period.">
        <LineTable
          lines={pack.partial}
          collectedLabel="Last receipt"
          extra={(l) => (
            <span className="mt-0.5 block text-[10.5px] text-amber-200/80">
              Received {money(l.collectedThisPeriod)} of {money(l.total)}
            </span>
          )} />
      </Section>

      <Section
        icon={<Ban size={15} />}
        tone="bg-ink-500 text-chrome"
        title="Not paid yet"
        count={hold}
        empty="Nothing outstanding.">
        {pack.issuedUnpaid.length > 0 && (
          <>
            <p className="px-5 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-chrome">Issued this period</p>
            <LineTable lines={pack.issuedUnpaid} collectedLabel="Paid on" />
          </>
        )}
        {pack.earlierUnpaid.length > 0 && (
          <>
            <p className="px-5 pb-2 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-chrome">Older invoices</p>
            <LineTable lines={pack.earlierUnpaid} collectedLabel="Paid on" />
          </>
        )}
      </Section>

      <Section
        icon={<Building2 size={15} />}
        tone="bg-emerald-500/15 text-emerald-300"
        title="Tax on expenses — claim back"
        count={pack.itcExpenses.length}
        empty="No claimable tax on expenses this period.">
        <ItcTable expenses={pack.itcExpenses} />
      </Section>

      <footer className="border-t border-line bg-ink-800/40 px-5 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-chrome">
          {t.netLlp > 0.5
            ? <><CheckCircle2 size={13} className="mr-1 inline text-amber-300" /> Pay {money(t.netLlp)} from {llp} after claim-back. Record the challan when filing is done.</>
            : <>Nothing to pay this period after claim-back.</>}
        </p>
      </footer>
    </div>
  );
}

function ItcTable({ expenses }: { expenses: Expense[] }) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[640px]">
        <thead><tr className="bg-ink-800/60">
          <th className="th">Date</th><th className="th">Vendor</th><th className="th">GSTIN</th>
          <th className="th">Bill</th><th className="th text-right">Before tax</th><th className="th text-right">Claim back</th>
        </tr></thead>
        <tbody>
          {expenses.map((e) => {
            const fx = Number(e.exchange_rate) || 1;
            const itc = fxInr(Number(e.cgst_amount) + Number(e.sgst_amount) + Number(e.igst_amount), fx);
            return (
              <tr key={e.id}>
                <td className="td text-[12.5px] text-chrome">{fmtDate(e.expense_date)}</td>
                <td className="td text-[12.5px] text-white">{e.vendor_name}</td>
                <td className="td font-mono text-[11.5px] text-chrome">{e.vendor_gstin || '—'}</td>
                <td className="td font-mono text-[11.5px] text-chrome">{e.bill_number || '—'}</td>
                <td className="td text-right font-mono tabular-nums text-[12.5px]">{money(fxInr(e.taxable_amount, fx))}</td>
                <td className="td text-right font-mono tabular-nums text-[13px] text-emerald-300">{money(itc)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function copyPack(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied — paste this into an email to the GST team'),
    () => toast('Could not copy. Download the CSV instead.', 'error'),
  );
}
