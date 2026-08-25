export const CURRENCIES = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'GBP', symbol: '£', label: 'Pound Sterling' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'AED', symbol: 'AED ', label: 'UAE Dirham' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar' },
  { code: 'SAR', symbol: 'SAR ', label: 'Saudi Riyal' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar' },
];

export const currencySymbol = (c = 'INR') =>
  CURRENCIES.find((x) => x.code === c)?.symbol ?? c + ' ';

/** ₹2,70,000.00 for INR (Indian grouping), standard grouping elsewhere. */
export function money(amount: number | string | null | undefined, currency = 'INR', decimals = 2) {
  const n = Number(amount ?? 0);
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return (
    currencySymbol(currency) +
    n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  );
}

/** Compact for dashboard tiles: ₹2.7L, ₹1.2Cr, $12.4k */
export function moneyShort(amount: number | null | undefined, currency = 'INR') {
  const n = Number(amount ?? 0);
  const s = currencySymbol(currency);
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (currency === 'INR') {
    if (a >= 1e7) return `${sign}${s}${(a / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `${sign}${s}${(a / 1e5).toFixed(2)}L`;
    if (a >= 1e3) return `${sign}${s}${(a / 1e3).toFixed(1)}K`;
    return `${sign}${s}${a.toFixed(0)}`;
  }
  if (a >= 1e6) return `${sign}${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}${s}${(a / 1e3).toFixed(1)}k`;
  return `${sign}${s}${a.toFixed(0)}`;
}

export const num = (n: number | string | null | undefined, d = 2) =>
  Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

export const qtyFmt = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? v.toFixed(2) : String(v);
};

// ---------------------------------------------------------------- dates
export function fmtDate(d?: string | Date | null) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : d;
  if (isNaN(date.getTime())) return '—';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}
export function fmtDateLong(d?: string | Date | null) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : d;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
/** Calendar today in India — invoices and due dates should not slip a day on UTC servers. */
export const APP_TZ = 'Asia/Kolkata';

export function todayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function utcDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, days: number) {
  const ms = utcDay(iso) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string) {
  return Math.round((utcDay(b) - utcDay(a)) / 86400000);
}
export const monthKey = (iso: string) => iso.slice(0, 7);
export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

/** Indian financial year: 1 Apr – 31 Mar. Returns { label:'FY 2026-27', start, end } */
export function financialYear(iso = todayISO(), startMonth = 4) {
  const d = new Date(iso + 'T00:00:00');
  const y = d.getFullYear();
  const startYear = d.getMonth() + 1 >= startMonth ? y : y - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const endD = new Date(startYear + 1, startMonth - 1, 0);
  const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
  return { label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`, start, end, startYear };
}

export function quarterOf(iso: string) {
  const m = Number(iso.slice(5, 7));
  const y = Number(iso.slice(0, 4));
  // GST quarters follow the financial year: Q1 = Apr-Jun
  const fyQ = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  const fyYear = m >= 4 ? y : y - 1;
  return { key: `${fyYear}-Q${fyQ}`, label: `Q${fyQ} FY${String((fyYear + 1) % 100).padStart(2, '0')}` };
}

// ---------------------------------------------------------------- words
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + under1000(n % 100) : '');
}

/** Indian numbering: Crore / Lakh / Thousand */
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

function intlWords(n: number): string {
  if (n === 0) return 'Zero';
  const units = [
    [1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'],
  ] as [number, string][];
  const parts: string[] = [];
  for (const [v, name] of units) {
    const q = Math.floor(n / v);
    if (q) { parts.push(`${intlWords(q)} ${name}`); n %= v; }
  }
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

const CURRENCY_WORDS: Record<string, [string, string]> = {
  INR: ['Indian Rupee', 'Paise'], USD: ['US Dollar', 'Cents'], GBP: ['Pound Sterling', 'Pence'],
  EUR: ['Euro', 'Cents'], AED: ['UAE Dirham', 'Fils'], SGD: ['Singapore Dollar', 'Cents'],
  SAR: ['Saudi Riyal', 'Halalas'], AUD: ['Australian Dollar', 'Cents'], CAD: ['Canadian Dollar', 'Cents'],
};

/** "Indian Rupee Two Lakh Seventy Thousand Only" */
export function amountInWords(amount: number, currency = 'INR') {
  const [main, sub] = CURRENCY_WORDS[currency] ?? [currency, 'Cents'];
  const abs = Math.abs(Number(amount) || 0);
  const whole = Math.floor(abs);
  const frac = Math.round((abs - whole) * 100);
  const words = currency === 'INR' ? indianWords(whole) : intlWords(whole);
  const fracWords = frac ? ` and ${currency === 'INR' ? indianWords(frac) : intlWords(frac)} ${sub}` : '';
  return `${main} ${words}${fracWords} Only`;
}

export function initials(name?: string | null) {
  if (!name) return '—';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

export function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
