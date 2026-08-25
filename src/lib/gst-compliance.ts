import type { Client, CompanyProfile, Expense, Invoice, Payment } from './types';
import { fxInr } from './finance';
import { monthLabel, money, quarterOf } from './format';

export type PeriodType = 'monthly' | 'quarterly';
export type ShareKind = 'b2b' | 'b2c' | 'export_lut' | 'export_paid' | 'exempt';

export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  b2b: 'B2B — registered',
  b2c: 'B2C / unregistered',
  export_lut: 'Export / SEZ under LUT (0%)',
  export_paid: 'Export with IGST',
  exempt: 'Exempt / nil-rated',
};

export function isoDate(v?: string | null) {
  if (!v) return '';
  return v.slice(0, 10);
}

export function periodKeyOf(iso: string, periodType: PeriodType) {
  const d = isoDate(iso);
  return periodType === 'monthly' ? d.slice(0, 7) : quarterOf(d).key;
}

export function fyPeriodKeys(fyStart: string, fyEnd: string, periodType: PeriodType): string[] {
  if (periodType === 'quarterly') {
    const y = Number(fyStart.slice(0, 4));
    return [`${y}-Q1`, `${y}-Q2`, `${y}-Q3`, `${y}-Q4`];
  }
  const keys: string[] = [];
  const end = fyEnd.slice(0, 7);
  let [y, m] = fyStart.slice(0, 7).split('-').map(Number);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    keys.push(k);
    if (k >= end) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

export function labelForKey(key: string, periodType: PeriodType) {
  if (periodType === 'monthly') return monthLabel(key);
  const y = Number(key.slice(0, 4));
  const q = Number(key.slice(-1));
  const month = q === 4 ? '01' : String(4 + (q - 1) * 3).padStart(2, '0');
  const year = q === 4 ? y + 1 : y;
  return quarterOf(`${year}-${month}-01`).label;
}

export function isZeroRated(i: Invoice) {
  return i.tax_mode === 'export_lut' || i.tax_mode === 'exempt';
}

export function isFullyPaid(i: Invoice) {
  return i.status === 'paid' || Number(i.balance_due) <= 0.5;
}

export function invoiceTaxInr(i: Invoice) {
  const fx = Number(i.exchange_rate) || 1;
  const cgst = fxInr(i.cgst_total, fx);
  const sgst = fxInr(i.sgst_total, fx);
  const igst = fxInr(i.igst_total, fx);
  return {
    taxable: fxInr(i.subtotal, fx),
    cgst, sgst, igst,
    tax: +(cgst + sgst + igst).toFixed(2),
    total: fxInr(i.total, fx),
  };
}

export function collectedOn(i: Invoice, payments: Payment[]): string | null {
  if (!isFullyPaid(i)) return null;
  const dates = payments
    .filter((p) => p.invoice_id === i.id)
    .map((p) => isoDate(p.payment_date))
    .filter(Boolean)
    .sort();
  if (dates.length) return dates[dates.length - 1];
  if (i.paid_at) return isoDate(i.paid_at);
  return isoDate(i.invoice_date) || null;
}

export function shareKind(i: Invoice, client?: Partial<Client> | null): ShareKind {
  if (i.tax_mode === 'export_lut') return 'export_lut';
  if (i.tax_mode === 'export_paid') return 'export_paid';
  if (i.tax_mode === 'exempt') return 'exempt';
  const gstin = client?.gstin;
  return gstin ? 'b2b' : 'b2c';
}

function clientOf(i: Invoice, clients: Client[]) {
  const row = clients.find((c) => c.id === i.client_id);
  const snap = i.client_snapshot;
  const name = row?.company_name || snap?.company_name || '—';
  const gstin = row?.gstin || snap?.gstin || '';
  return { row: row ?? null, name, gstin };
}

function refsFor(payments: Payment[]) {
  return payments
    .map((p) => [p.mode, p.reference, p.deposit_to].filter(Boolean).join(' · '))
    .filter(Boolean);
}

export type PackLine = {
  invoice: Invoice;
  clientName: string;
  gstin: string;
  invoiceDate: string;
  collectedOn: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  kind: ShareKind;
  paymentRefs: string[];
  collectedThisPeriod: number;
  taxThisPeriod: number;
};

export type MonthPack = {
  key: string;
  label: string;
  share: PackLine[];
  zeroRated: PackLine[];
  partial: PackLine[];
  issuedUnpaid: PackLine[];
  earlierUnpaid: PackLine[];
  itcExpenses: Expense[];
  totals: {
    shareCount: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    output: number;
    zeroRated: number;
    itcCgst: number;
    itcSgst: number;
    itcIgst: number;
    itc: number;
    netLlp: number;
    outstandingGst: number;
    partialGst: number;
  };
};

function emptyTotals(): MonthPack['totals'] {
  return {
    shareCount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, output: 0, zeroRated: 0,
    itcCgst: 0, itcSgst: 0, itcIgst: 0, itc: 0, netLlp: 0, outstandingGst: 0, partialGst: 0,
  };
}

function emptyPack(key: string, label: string): MonthPack {
  return {
    key, label,
    share: [], zeroRated: [], partial: [], issuedUnpaid: [], earlierUnpaid: [],
    itcExpenses: [], totals: emptyTotals(),
  };
}

function toLine(i: Invoice, clients: Client[], payments: Payment[], collected: string | null): PackLine {
  const c = clientOf(i, clients);
  const t = invoiceTaxInr(i);
  const mine = payments.filter((p) => p.invoice_id === i.id);
  return {
    invoice: i,
    clientName: c.name,
    gstin: c.gstin || (i.tax_mode.startsWith('export') ? 'Export' : ''),
    invoiceDate: i.invoice_date,
    collectedOn: collected,
    ...t,
    kind: shareKind(i, c.row ?? i.client_snapshot),
    paymentRefs: refsFor(mine),
    collectedThisPeriod: t.total,
    taxThisPeriod: t.tax,
  };
}

/** Build one FY of GST packs. Output tax follows payment received, not invoice date. */
export function buildGstPacks(opts: {
  invoices: Invoice[];
  expenses: Expense[];
  payments: Payment[];
  clients: Client[];
  fyStart: string;
  fyEnd: string;
  periodType: PeriodType;
}): MonthPack[] {
  const { invoices, expenses, payments, clients, fyStart, fyEnd, periodType } = opts;
  const keys = fyPeriodKeys(fyStart, fyEnd, periodType);
  const map = new Map(keys.map((k) => [k, emptyPack(k, labelForKey(k, periodType))]));
  const live = invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled');
  const inFy = (d: string) => d >= fyStart && d <= fyEnd;
  const payByInv = new Map<string, Payment[]>();
  payments.forEach((p) => {
    const list = payByInv.get(p.invoice_id) ?? [];
    list.push(p);
    payByInv.set(p.invoice_id, list);
  });

  live.forEach((i) => {
    const mine = payByInv.get(i.id) ?? [];
    const paidOn = collectedOn(i, mine);
    const packFor = (iso: string) => map.get(periodKeyOf(iso, periodType));

    if (isFullyPaid(i) && paidOn && inFy(paidOn)) {
      const pack = packFor(paidOn);
      if (pack) {
        const line = toLine(i, clients, mine, paidOn);
        if (isZeroRated(i) || line.tax <= 0.004) pack.zeroRated.push(line);
        else pack.share.push(line);
      }
      return;
    }

    const periodPays = new Map<string, Payment[]>();
    mine.forEach((p) => {
      if (!inFy(p.payment_date)) return;
      const k = periodKeyOf(p.payment_date, periodType);
      const list = periodPays.get(k) ?? [];
      list.push(p);
      periodPays.set(k, list);
    });
    periodPays.forEach((list, k) => {
      const pack = map.get(k);
      if (!pack) return;
      const collectedAmt = list.reduce((a, p) => a + fxInr(p.amount, p.exchange_rate ?? i.exchange_rate), 0);
      const t = invoiceTaxInr(i);
      const ratio = t.total > 0 ? Math.min(1, collectedAmt / t.total) : 0;
      const lastPay = [...list].map((p) => p.payment_date).sort().slice(-1)[0];
      const line = toLine(i, clients, list, isoDate(lastPay ?? null));
      line.collectedThisPeriod = +collectedAmt.toFixed(2);
      line.taxThisPeriod = +(t.tax * ratio).toFixed(2);
      pack.partial.push(line);
    });

    if (!inFy(i.invoice_date) || isFullyPaid(i)) return;
    const issued = packFor(i.invoice_date);
    if (!issued) return;
    const line = toLine(i, clients, mine, null);
    if (!issued.partial.some((l) => l.invoice.id === i.id)) issued.issuedUnpaid.push(line);
    keys.forEach((k) => {
      if (k <= issued.key) return;
      const later = map.get(k);
      if (!later || later.partial.some((l) => l.invoice.id === i.id)) return;
      later.earlierUnpaid.push(line);
    });
  });

  expenses.filter((e) => e.itc_eligible && inFy(e.expense_date)).forEach((e) => {
    const pack = map.get(periodKeyOf(e.expense_date, periodType));
    if (pack) pack.itcExpenses.push(e);
  });

  map.forEach((pack) => {
    const t = emptyTotals();
    pack.share.forEach((l) => {
      t.shareCount += 1;
      t.taxable += l.taxable;
      t.cgst += l.cgst;
      t.sgst += l.sgst;
      t.igst += l.igst;
      t.output += l.tax;
    });
    pack.zeroRated.forEach((l) => { t.zeroRated += l.taxable; });
    pack.partial.forEach((l) => { t.partialGst += l.taxThisPeriod; });
    pack.issuedUnpaid.concat(pack.earlierUnpaid).forEach((l) => { t.outstandingGst += l.tax; });
    pack.itcExpenses.forEach((e) => {
      const fx = Number(e.exchange_rate) || 1;
      t.itcCgst += fxInr(e.cgst_amount, fx);
      t.itcSgst += fxInr(e.sgst_amount, fx);
      t.itcIgst += fxInr(e.igst_amount, fx);
    });
    t.itc = +(t.itcCgst + t.itcSgst + t.itcIgst).toFixed(2);
    t.output = +t.output.toFixed(2);
    t.taxable = +t.taxable.toFixed(2);
    t.cgst = +t.cgst.toFixed(2);
    t.sgst = +t.sgst.toFixed(2);
    t.igst = +t.igst.toFixed(2);
    t.zeroRated = +t.zeroRated.toFixed(2);
    t.partialGst = +t.partialGst.toFixed(2);
    t.outstandingGst = +t.outstandingGst.toFixed(2);
    t.netLlp = +Math.max(0, t.output - t.itc).toFixed(2);
    pack.totals = t;
  });

  return keys.map((k) => map.get(k)!);
}

export function llpAccountLabel(profile?: CompanyProfile | null) {
  if (!profile) return 'the LLP current account';
  const bits = [
    profile.bank_name,
    profile.bank_account_name,
    profile.bank_account_no ? `A/c ${profile.bank_account_no}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'the LLP current account';
}

export function packSummaryText(pack: MonthPack, profile?: CompanyProfile | null) {
  const llp = llpAccountLabel(profile);
  const lines: string[] = [
    `GST compliance pack — ${pack.label} (${pack.key})`,
    profile?.legal_name ? `Entity: ${profile.legal_name}${profile.gstin ? ` · GSTIN ${profile.gstin}` : ''}` : '',
    'House rule: only GST on invoices whose payment has been received is remitted to the Government, from the LLP account. Unpaid invoices stay off this filing.',
    '',
    `SHARE WITH GST TEAM (payment received — file, then pay from ${llp})`,
  ];
  if (!pack.share.length) lines.push('  None this period.');
  pack.share.forEach((l) => {
    lines.push(
      `  ${l.invoice.invoice_number}  ${l.clientName}  ${l.gstin || '—'}  invoiced ${l.invoiceDate}  paid ${l.collectedOn}  taxable ${money(l.taxable)}  GST ${money(l.tax)}  ${SHARE_KIND_LABEL[l.kind]}`,
    );
  });
  lines.push('');
  lines.push('ZERO-RATED / LUT (share copies — no cash GST)');
  if (!pack.zeroRated.length) lines.push('  None this period.');
  pack.zeroRated.forEach((l) => {
    lines.push(`  ${l.invoice.invoice_number}  ${l.clientName}  paid ${l.collectedOn}  taxable ${money(l.taxable)}`);
  });
  lines.push('');
  lines.push('PART-PAID (money landed, invoice not closed — flag with the GST team; do not treat as full GST)');
  if (!pack.partial.length) lines.push('  None this period.');
  pack.partial.forEach((l) => {
    lines.push(`  ${l.invoice.invoice_number}  ${l.clientName}  collected ${money(l.collectedThisPeriod)} of ${money(l.total)}  GST in this receipt ~ ${money(l.taxThisPeriod)}`);
  });
  lines.push('');
  lines.push('DO NOT INCLUDE IN THIS GOVERNMENT PAYMENT (payment not received)');
  const hold = [...pack.issuedUnpaid, ...pack.earlierUnpaid];
  if (!hold.length) lines.push('  None.');
  hold.forEach((l) => {
    lines.push(`  ${l.invoice.invoice_number}  ${l.clientName}  invoiced ${l.invoiceDate}  GST still on wing ${money(l.tax)}`);
  });
  lines.push('');
  lines.push('ITC this period (offset on GSTR-3B)');
  if (!pack.itcExpenses.length) lines.push('  None.');
  pack.itcExpenses.forEach((e) => {
    const tax = fxInr(Number(e.cgst_amount) + Number(e.sgst_amount) + Number(e.igst_amount), e.exchange_rate);
    lines.push(`  ${e.expense_date}  ${e.vendor_name}  ${e.bill_number || '—'}  ITC ${money(tax)}`);
  });
  lines.push('');
  lines.push(`Output GST (payment received): ${money(pack.totals.output)}`);
  lines.push(`ITC: ${money(pack.totals.itc)}`);
  lines.push(`Net to pay from ${llp}: ${money(pack.totals.netLlp)}`);
  return lines.filter((s, i) => s !== '' || lines[i - 1] !== '').join('\n');
}

export function packCsvRows(pack: MonthPack): (string | number | null)[][] {
  const header = [
    'Action', 'Invoice', 'Invoice date', 'Payment received', 'Client', 'GSTIN',
    'Place of supply', 'Treatment', 'Taxable', 'CGST', 'SGST', 'IGST', 'GST', 'Invoice total',
    'Collected this period', 'Payment refs', 'Notes',
  ];
  const rows: (string | number | null)[][] = [header];
  const push = (action: string, l: PackLine, notes: string, collected?: number) => {
    rows.push([
      action, l.invoice.invoice_number, l.invoiceDate, l.collectedOn,
      l.clientName, l.gstin,
      `${l.invoice.place_of_supply_code ?? ''}-${l.invoice.place_of_supply ?? ''}`,
      SHARE_KIND_LABEL[l.kind],
      l.taxable.toFixed(2), l.cgst.toFixed(2), l.sgst.toFixed(2), l.igst.toFixed(2),
      l.tax.toFixed(2), l.total.toFixed(2),
      (collected ?? l.collectedThisPeriod).toFixed(2),
      l.paymentRefs.join(' | '),
      notes,
    ]);
  };
  pack.share.forEach((l) => push('SHARE_AND_PAY', l, 'Payment received. Share with GST team. Remit GST from LLP account.'));
  pack.zeroRated.forEach((l) => push('SHARE_ZERO_RATED', l, 'Payment received. Share copies. No cash GST (LUT / exempt).'));
  pack.partial.forEach((l) => push('FLAG_PARTIAL', l, 'Part payment only. Confirm with GST team before remitting.', l.collectedThisPeriod));
  pack.issuedUnpaid.forEach((l) => push('HOLD_UNPAID', l, 'Issued this period. Payment not received. Do not remit GST yet.', 0));
  pack.earlierUnpaid.forEach((l) => push('HOLD_EARLIER', l, 'Still unpaid from an earlier period. Not this filing.', 0));
  return rows;
}

export function gstr1CsvRows(pack: MonthPack, clients: Client[]): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [[
    'GSTIN of recipient', 'Receiver name', 'Invoice number', 'Invoice date', 'Invoice value',
    'Place of supply', 'Reverse charge', 'Invoice type', 'Rate', 'Taxable value',
    'CGST', 'SGST', 'IGST', 'Cess', 'Payment received',
  ]];
  [...pack.share, ...pack.zeroRated].forEach((l) => {
    const i = l.invoice;
    const c = clients.find((x) => x.id === i.client_id);
    rows.push([
      c?.gstin ?? l.gstin, l.clientName, i.invoice_number, i.invoice_date,
      l.total.toFixed(2),
      `${i.place_of_supply_code}-${i.place_of_supply}`,
      i.reverse_charge ? 'Y' : 'N',
      i.tax_mode === 'export_lut' ? 'Export without payment'
        : i.tax_mode === 'export_paid' ? 'Export with payment'
        : c?.gstin || l.gstin ? 'Regular B2B' : 'B2C',
      (i.invoice_items?.[0]?.gst_rate ?? 18),
      l.taxable.toFixed(2),
      l.cgst.toFixed(2), l.sgst.toFixed(2), l.igst.toFixed(2), '0.00',
      l.collectedOn,
    ]);
  });
  return rows;
}
