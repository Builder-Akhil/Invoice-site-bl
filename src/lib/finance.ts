import type { Expense, Invoice, RecurringExpense } from './types';
import { typicalTeamBurn } from './payroll';
import type { TeamMember } from './types';

export const FREQ_PER_MONTH: Record<string, number> = {
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
  weekly: 52 / 12,
};

export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function lastNMonthKeys(n: number, ending = ymd(new Date()).slice(0, 7)): string[] {
  const [y, m] = ending.split('-').map(Number);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

export function splitExpenseTax(taxable: number, gstRate: number, taxSplit: string) {
  const rate = taxSplit === 'none' ? 0 : Number(gstRate) || 0;
  const igst = taxSplit === 'igst' ? +(taxable * rate / 100).toFixed(2) : 0;
  const half = taxSplit === 'cgst_sgst' ? +(taxable * rate / 200).toFixed(2) : 0;
  return {
    gst_rate: rate,
    cgst_amount: half,
    sgst_amount: half,
    igst_amount: igst,
    total_amount: +(taxable + igst + half * 2).toFixed(2),
  };
}

export function fxInr(amount: number | string | null | undefined, rate?: number | string | null) {
  return Number(amount ?? 0) * (Number(rate) || 1);
}

export function gstDueByMonth(invoices: Invoice[], expenses: Expense[]): Map<string, number> {
  const buckets = new Map<string, { output: number; itc: number }>();
  const bump = (k: string) => {
    const cur = buckets.get(k) ?? { output: 0, itc: 0 };
    buckets.set(k, cur);
    return cur;
  };
  for (const i of invoices) {
    if (i.status === 'draft' || i.status === 'cancelled') continue;
    const k = i.invoice_date.slice(0, 7);
    bump(k).output += fxInr(
      Number(i.cgst_total) + Number(i.sgst_total) + Number(i.igst_total),
      i.exchange_rate,
    );
  }
  for (const e of expenses) {
    if (!e.itc_eligible) continue;
    const k = e.expense_date.slice(0, 7);
    bump(k).itc += fxInr(
      Number(e.cgst_amount) + Number(e.sgst_amount) + Number(e.igst_amount),
      e.exchange_rate,
    );
  }
  const due = new Map<string, number>();
  for (const [k, v] of buckets) due.set(k, Math.max(0, v.output - v.itc));
  return due;
}

export function trailingGstAverage(due: Map<string, number>, months = 3, ending?: string): number {
  const keys = lastNMonthKeys(months, ending);
  if (!keys.length) return 0;
  const sum = keys.reduce((a, k) => a + (due.get(k) ?? 0), 0);
  return +(sum / keys.length).toFixed(2);
}

export function subscriptionRunRate(rows: RecurringExpense[]): number {
  return +rows
    .filter((r) => r.is_active)
    .reduce((a, r) => {
      const monthly = Number(r.taxable_amount) * (FREQ_PER_MONTH[r.frequency] ?? 1);
      return a + fxInr(monthly, r.exchange_rate);
    }, 0)
    .toFixed(2);
}

export function addFractionalMonths(from: Date, months: number) {
  const whole = Math.floor(months);
  const frac = months - whole;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + Math.round(frac * 30.437));
  return d;
}

export type Runway = {
  missingCash: boolean;
  months: number | null;
  date: string | null;
  monthlyBurn: number;
  recipe: { payroll: number; subscriptions: number; gstAvg: number };
};

export function computeRunway(opts: {
  cashOnHand: number | null | undefined;
  typicalPayroll: number;
  subscriptionRunRate: number;
  gstAvg3m: number;
  from?: Date;
}): Runway {
  const payroll = Number(opts.typicalPayroll) || 0;
  const subscriptions = Number(opts.subscriptionRunRate) || 0;
  const gstAvg = Number(opts.gstAvg3m) || 0;
  const monthlyBurn = +(payroll + subscriptions + gstAvg).toFixed(2);
  const recipe = { payroll, subscriptions, gstAvg };
  const cash = opts.cashOnHand;
  if (cash === null || cash === undefined || Number.isNaN(Number(cash))) {
    return { missingCash: true, months: null, date: null, monthlyBurn, recipe };
  }
  if (monthlyBurn <= 0) {
    return { missingCash: false, months: null, date: null, monthlyBurn, recipe };
  }
  const months = Number(cash) / monthlyBurn;
  const date = ymd(addFractionalMonths(opts.from ?? new Date(), months));
  return { missingCash: false, months, date, monthlyBurn, recipe };
}

export function booksSnapshot(opts: {
  invoices: Invoice[];
  expenses: Expense[];
  members: TeamMember[];
  subscriptions: RecurringExpense[];
  cashOnHand: number | null | undefined;
  fyStart: string;
  fyEnd: string;
  thisMonth?: string;
}) {
  const live = opts.invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled');
  const inFy = (d: string) => d >= opts.fyStart && d <= opts.fyEnd;
  const billed = live.filter((i) => inFy(i.invoice_date)).reduce((a, i) => a + fxInr(i.subtotal, i.exchange_rate), 0);
  const expenseTaxable = opts.expenses
    .filter((e) => inFy(e.expense_date))
    .reduce((a, e) => a + fxInr(e.taxable_amount, e.exchange_rate), 0);
  const due = gstDueByMonth(opts.invoices, opts.expenses);
  const month = opts.thisMonth ?? ymd(new Date()).slice(0, 7);
  const gstThisMonth = due.get(month) ?? 0;
  const gstAvg3m = trailingGstAverage(due, 3, month);
  const payroll = typicalTeamBurn(opts.members);
  const subscriptions = subscriptionRunRate(opts.subscriptions);
  const runway = computeRunway({
    cashOnHand: opts.cashOnHand,
    typicalPayroll: payroll,
    subscriptionRunRate: subscriptions,
    gstAvg3m,
  });
  return {
    billed: +billed.toFixed(2),
    expenseTaxable: +expenseTaxable.toFixed(2),
    netAfterExpenses: +(billed - expenseTaxable).toFixed(2),
    gstThisMonth: +gstThisMonth.toFixed(2),
    gstAvg3m,
    typicalPayroll: payroll,
    subscriptionRunRate: subscriptions,
    runway,
  };
}
