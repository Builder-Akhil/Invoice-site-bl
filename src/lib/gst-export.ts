import type { Client, Invoice, Payment } from './types';
import { fxInr } from './finance';
import {
  collectedOn, invoiceTaxInr, isFullyPaid, isoDate, labelForKey, periodKeyOf,
  shareKind, type PeriodType, type ShareKind,
} from './gst-compliance';
import { csvEscape, monthLabelLong } from './format';
import { downloadBlob, zipStore } from './zip';
import { STATUS_LABEL } from './invoice-status';

/**
 * Bulk export of invoice packs, on either of the two dates that matter.
 *
 * These serve different people and must not be conflated:
 *
 *   'raised' — every invoice dated in the period, paid or not. This is turnover,
 *              and it is what the income-tax CA asks for: "send me July".
 *   'paid'   — only invoices whose payment landed in the period. This is the
 *              GST view, because output tax is due on money received, not on
 *              the day you raised the bill.
 *
 * The GST page's own arithmetic stays on the 'paid' basis regardless of what is
 * selected here. This module only decides which PDFs go in the envelope.
 */

export type ExportBasis = 'raised' | 'paid';

export const BASIS_META: Record<ExportBasis, {
  label: string; short: string; who: string; dateColumn: string; blurb: string;
}> = {
  raised: {
    label: 'Invoice date',
    short: 'Raised',
    who: 'Income-tax CA',
    dateColumn: 'Invoice date',
    blurb: 'Every invoice dated in the month, paid or not. This is your turnover for the month.',
  },
  paid: {
    label: 'Payment received',
    short: 'Paid',
    who: 'GST filing',
    dateColumn: 'Payment received',
    blurb: 'Only invoices whose payment landed in the month. GST is due on money in the bank.',
  },
};

export type ExportLine = {
  invoice: Invoice;
  periodKey: string;
  clientName: string;
  gstin: string;
  invoiceDate: string;
  collectedOn: string | null;
  /** The date this line is filed under, decided by the basis. */
  basisDate: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  kind: ShareKind;
  /** Amount that landed in this period. Equals total on the 'raised' basis. */
  amountInPeriod: number;
  /** Tax attributable to this period. Equals tax on the 'raised' basis. */
  taxInPeriod: number;
  /** True when only part of the invoice was collected in this period. */
  partial: boolean;
};

export type PeriodOption = {
  key: string;
  label: string;
  fyStart: string;
  fyLabel: string;
  count: number;
  taxable: number;
  tax: number;
};

const live = (invoices: Invoice[]) =>
  invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled' && i.doc_type !== 'quote');

function clientBits(i: Invoice, clients: Client[]) {
  const row = clients.find((c) => c.id === i.client_id);
  const snap = i.client_snapshot;
  return {
    row: row ?? null,
    name: row?.company_name || snap?.company_name || '—',
    gstin: row?.gstin || snap?.gstin || '',
  };
}

/** Financial year (April start) containing a YYYY-MM or YYYY-Qn key. */
function fyOfKey(key: string): { start: string; label: string } {
  const year = Number(key.slice(0, 4));
  const month = /^\d{4}-Q(\d)$/.test(key)
    ? [4, 7, 10, 1][Number(key.slice(6, 7)) - 1]
    : Number(key.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return {
    start: `${startYear}-04-01`,
    label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
  };
}

function baseLine(i: Invoice, clients: Client[], periodKey: string, basisDate: string, collected: string | null): ExportLine {
  const c = clientBits(i, clients);
  const t = invoiceTaxInr(i);
  return {
    invoice: i,
    periodKey,
    clientName: c.name,
    gstin: c.gstin || (i.tax_mode?.startsWith('export') ? 'Export' : ''),
    invoiceDate: i.invoice_date,
    collectedOn: collected,
    basisDate,
    ...t,
    kind: shareKind(i, c.row ?? i.client_snapshot),
    amountInPeriod: t.total,
    taxInPeriod: t.tax,
    partial: false,
  };
}

/**
 * Every invoice line that belongs to any of `keys`, on the chosen basis.
 * Sorted by period then invoice date so a multi-month pack reads chronologically.
 */
export function selectExportLines(opts: {
  invoices: Invoice[];
  payments: Payment[];
  clients: Client[];
  keys: string[];
  basis: ExportBasis;
  periodType: PeriodType;
}): ExportLine[] {
  const { invoices, payments, clients, basis, periodType } = opts;
  const wanted = new Set(opts.keys);
  if (wanted.size === 0) return [];

  const rows = live(invoices);
  const out: ExportLine[] = [];

  if (basis === 'raised') {
    for (const i of rows) {
      const date = isoDate(i.invoice_date);
      if (!date) continue;
      const key = periodKeyOf(date, periodType);
      if (!wanted.has(key)) continue;
      out.push(baseLine(i, clients, key, date, collectedOn(i, payments.filter((p) => p.invoice_id === i.id))));
    }
  } else {
    const byInvoice = new Map<string, Payment[]>();
    for (const p of payments) {
      const list = byInvoice.get(p.invoice_id) ?? [];
      list.push(p);
      byInvoice.set(p.invoice_id, list);
    }

    for (const i of rows) {
      const mine = byInvoice.get(i.id) ?? [];

      // Settled in one go: the whole invoice files under its settlement date.
      if (isFullyPaid(i)) {
        const paidOn = collectedOn(i, mine);
        if (!paidOn) continue;
        const key = periodKeyOf(paidOn, periodType);
        if (!wanted.has(key)) continue;
        out.push(baseLine(i, clients, key, paidOn, paidOn));
        continue;
      }

      // Still open: each period that saw money gets its own line, carrying only
      // the tax attributable to what actually landed.
      const perPeriod = new Map<string, Payment[]>();
      for (const p of mine) {
        const d = isoDate(p.payment_date);
        if (!d) continue;
        const key = periodKeyOf(d, periodType);
        if (!wanted.has(key)) continue;
        const list = perPeriod.get(key) ?? [];
        list.push(p);
        perPeriod.set(key, list);
      }
      for (const [key, list] of perPeriod) {
        const amount = list.reduce((a, p) => a + fxInr(p.amount, p.exchange_rate ?? i.exchange_rate), 0);
        const t = invoiceTaxInr(i);
        const ratio = t.total > 0 ? Math.min(1, amount / t.total) : 0;
        const last = [...list].map((p) => isoDate(p.payment_date)).filter(Boolean).sort().slice(-1)[0] ?? null;
        const line = baseLine(i, clients, key, last ?? i.invoice_date, last);
        line.amountInPeriod = +amount.toFixed(2);
        line.taxInPeriod = +(t.tax * ratio).toFixed(2);
        line.partial = true;
        out.push(line);
      }
    }
  }

  return out.sort((a, b) =>
    a.periodKey.localeCompare(b.periodKey)
    || a.basisDate.localeCompare(b.basisDate)
    || a.invoice.invoice_number.localeCompare(b.invoice.invoice_number));
}

/** Every period that has something to export, newest first, for the chip picker. */
export function availablePeriods(opts: {
  invoices: Invoice[];
  payments: Payment[];
  clients: Client[];
  basis: ExportBasis;
  periodType: PeriodType;
}): PeriodOption[] {
  const keys = new Set<string>();
  const rows = live(opts.invoices);

  if (opts.basis === 'raised') {
    for (const i of rows) {
      const d = isoDate(i.invoice_date);
      if (d) keys.add(periodKeyOf(d, opts.periodType));
    }
  } else {
    const ids = new Set(rows.map((i) => i.id));
    for (const p of opts.payments) {
      if (!ids.has(p.invoice_id)) continue;
      const d = isoDate(p.payment_date);
      if (d) keys.add(periodKeyOf(d, opts.periodType));
    }
    // A fully-paid invoice with no payment rows still settles somewhere.
    for (const i of rows) {
      if (!isFullyPaid(i)) continue;
      const d = collectedOn(i, opts.payments.filter((p) => p.invoice_id === i.id));
      if (d) keys.add(periodKeyOf(d, opts.periodType));
    }
  }

  const all = [...keys];
  const lines = selectExportLines({ ...opts, keys: all });
  const byKey = new Map<string, ExportLine[]>();
  for (const l of lines) {
    const list = byKey.get(l.periodKey) ?? [];
    list.push(l);
    byKey.set(l.periodKey, list);
  }

  return all
    .sort((a, b) => b.localeCompare(a))
    .map((key) => {
      const list = byKey.get(key) ?? [];
      const fy = fyOfKey(key);
      return {
        key,
        label: labelForKey(key, opts.periodType),
        fyStart: fy.start,
        fyLabel: fy.label,
        count: list.length,
        taxable: +list.reduce((a, l) => a + l.taxable, 0).toFixed(2),
        tax: +list.reduce((a, l) => a + l.taxInPeriod, 0).toFixed(2),
      };
    });
}

export function summarise(lines: ExportLine[]) {
  const invoices = new Set(lines.map((l) => l.invoice.id));
  return {
    lines: lines.length,
    invoices: invoices.size,
    taxable: +lines.reduce((a, l) => a + l.taxable, 0).toFixed(2),
    tax: +lines.reduce((a, l) => a + l.taxInPeriod, 0).toFixed(2),
    total: +lines.reduce((a, l) => a + l.amountInPeriod, 0).toFixed(2),
    unpaid: lines.filter((l) => !isFullyPaid(l.invoice)).length,
  };
}

/** The index sheet that rides inside the zip, and the standalone CSV. */
export function exportCsvRows(lines: ExportLine[], basis: ExportBasis): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [[
    'Period', 'Invoice', 'Invoice date', 'Payment received', 'Client', 'GSTIN', 'Supply type',
    'Status', 'Taxable', 'CGST', 'SGST', 'IGST', 'GST', 'Invoice total',
    basis === 'paid' ? 'Received in period' : 'Amount', 'File',
  ]];
  for (const l of lines) {
    rows.push([
      l.periodKey,
      l.invoice.invoice_number,
      l.invoiceDate,
      l.collectedOn ?? '',
      l.clientName,
      l.gstin,
      l.kind,
      STATUS_LABEL[l.invoice.status] ?? l.invoice.status,
      l.taxable.toFixed(2),
      l.cgst.toFixed(2),
      l.sgst.toFixed(2),
      l.igst.toFixed(2),
      l.taxInPeriod.toFixed(2),
      l.total.toFixed(2),
      l.amountInPeriod.toFixed(2),
      `${l.periodKey}/${zipEntryName(l)}`,
    ]);
  }
  const s = summarise(lines);
  rows.push([]);
  rows.push(['TOTAL', s.invoices, '', '', '', '', '', '', s.taxable.toFixed(2), '', '', '', s.tax.toFixed(2), '', s.total.toFixed(2), '']);
  return rows;
}

export function exportCsvText(lines: ExportLine[], basis: ExportBasis) {
  // BOM so Excel on Windows opens the rupee amounts as UTF-8.
  return `﻿${exportCsvRows(lines, basis).map((r) => r.map(csvEscape).join(',')).join('\n')}`;
}

function sanitise(s: string) {
  return s.replace(/[^\w.-]/g, '_');
}

export function zipEntryName(l: ExportLine) {
  return `${sanitise(l.invoice.invoice_number)}.pdf`;
}

/**
 * Filename for the download. One period reads as the month; several read as a
 * range, because "invoices-2026-07_2026-08_2026-09.zip" helps nobody.
 */
export function exportFilename(keys: string[], basis: ExportBasis, ext: string) {
  const sorted = [...keys].sort();
  const tag = basis === 'paid' ? 'paid' : 'raised';
  if (sorted.length === 0) return `invoices-${tag}.${ext}`;
  if (sorted.length === 1) return `invoices-${sorted[0]}-${tag}.${ext}`;
  return `invoices-${sorted[0]}_to_${sorted[sorted.length - 1]}-${tag}.${ext}`;
}

/** Human heading for the selection, e.g. "July 2026 + 2 more". */
export function selectionLabel(keys: string[], periodType: PeriodType) {
  const sorted = [...keys].sort();
  if (sorted.length === 0) return 'Nothing selected';
  const first = /^\d{4}-\d{2}$/.test(sorted[0]) && periodType === 'monthly'
    ? monthLabelLong(sorted[0])
    : labelForKey(sorted[0], periodType);
  if (sorted.length === 1) return first;
  return `${first} + ${sorted.length - 1} more`;
}

/* ------------------------------------------------------------------- zip */

export type ZipItem = {
  invoiceId: string;
  invoiceNumber: string;
  /** Optional folder, e.g. the period key, so a multi-month pack is browsable. */
  folder?: string;
};

/**
 * Fetch each invoice PDF and pack them into one zip, with an index sheet.
 *
 * Sequential on purpose: a CA pack of forty invoices fired in parallel will
 * trip the PDF route's own rate limits and time out the slow ones. A missing
 * PDF is collected and reported rather than aborting the whole download —
 * a pack of 39 plus a named gap beats no pack at all.
 */
export async function zipInvoices(
  items: ZipItem[],
  opts: {
    filename: string;
    indexCsv: string;
    indexName?: string;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<string[]> {
  const used = new Set<string>();
  const files: { name: string; data: Uint8Array }[] = [];
  const failed: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = uniqueName(it, used);
    try {
      const res = await fetch(`/api/invoices/${it.invoiceId}/pdf`);
      if (!res.ok) failed.push(it.invoiceNumber);
      else files.push({ name, data: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      failed.push(it.invoiceNumber);
    }
    opts.onProgress?.(i + 1, items.length);
  }

  files.unshift({
    name: opts.indexName ?? '_index.csv',
    data: new TextEncoder().encode(opts.indexCsv),
  });
  downloadBlob(opts.filename, zipStore(files));
  return failed;
}

function uniqueName(it: ZipItem, used: Set<string>) {
  const dir = it.folder ? `${sanitise(it.folder)}/` : '';
  const base = sanitise(it.invoiceNumber);
  let name = `${dir}${base}.pdf`;
  let n = 2;
  while (used.has(name)) {
    name = `${dir}${base}-${n}.pdf`;
    n += 1;
  }
  used.add(name);
  return name;
}
