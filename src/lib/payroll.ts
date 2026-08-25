import type { PayComponent, PayrollItem, PayrollLine, TeamMember } from './types';

export const PAY_KINDS: { value: string; label: string; hint: string }[] = [
  { value: 'fixed_monthly', label: 'Fixed monthly', hint: 'Rupees every month (basic, housing, …)' },
  { value: 'percent_of_base', label: '% of basic × score', hint: 'Band of basic, then 0–100% for the month' },
  { value: 'capped_amount', label: 'Capped amount', hint: 'You type rupees; never above the cap' },
  { value: 'note', label: 'Note only', hint: 'Shown on the contract, not paid' },
];

/** Default kit — a template, not frozen columns. Edit / add / remove per person. */
export function defaultPayComponents(basic = 50000): PayComponent[] {
  return [
    {
      key: 'base',
      kind: 'fixed_monthly',
      label: 'Fixed Basic Pay',
      amount: basic,
      enabled: true,
      conditions: 'Monthly basic salary',
    },
    {
      key: 'skill_gap',
      kind: 'capped_amount',
      label: 'Skill Gap Development Pay',
      cap: 5000,
      enabled: true,
      conditions: 'Up to ₹5,000 / month with proof of a post or article. Type the amount.',
    },
    {
      key: 'performance',
      kind: 'percent_of_base',
      label: 'Skill & Performance Assessment Add-on',
      pct: 15,
      enabled: true,
      conditions: '15% of basic × score 0–100%',
    },
    {
      key: 'client_bonus',
      kind: 'percent_of_base',
      label: 'Client Deliverable Bonus',
      pct: 10,
      enabled: true,
      conditions: '10% of basic × score 0–100% per project; 0 if nothing delivered',
    },
  ];
}

export function newPayLineKey() {
  return `custom_${Math.random().toString(36).slice(2, 10)}`;
}

export function asComponents(raw: unknown): PayComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      ...r,
      key: String(r.key ?? newPayLineKey()),
      kind: String(r.kind ?? 'fixed_monthly'),
      label: String(r.label ?? 'Pay line'),
      enabled: r.enabled !== false,
    } as PayComponent;
  });
}

export function asPayrollLines(raw: unknown): PayrollLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      ...r,
      key: String(r.key ?? newPayLineKey()),
      kind: String(r.kind ?? 'fixed_monthly'),
      label: String(r.label ?? 'Pay line'),
      enabled: r.enabled !== false,
      computed: Number(r.computed ?? 0),
    } as PayrollLine;
  });
}

/** The member’s basic: the `base` line, else the first enabled fixed_monthly. */
export function baseAmount(components: PayComponent[]): number {
  const enabled = components.filter((c) => c.enabled);
  const named = enabled.find((c) => c.key === 'base');
  const fixed = enabled.find((c) => c.kind === 'fixed_monthly');
  return Number((named ?? fixed)?.amount ?? 0);
}

function clampScore(score: number | undefined) {
  const n = Number(score ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * `full_kit` = every line at its maximum (100% bands, full cap) — used for typical burn.
 * `entered` = this month’s score / rupees. Unknown kinds pay 0 until you teach the calculator.
 */
export function computeLine(
  line: PayComponent & { score?: number; value?: number },
  base: number,
  mode: 'full_kit' | 'entered',
): number {
  if (!line.enabled) return 0;
  switch (line.kind) {
    case 'fixed_monthly':
      return +Number(line.amount ?? 0).toFixed(2);
    case 'percent_of_base': {
      const band = Number(line.pct ?? 0) / 100;
      const score = mode === 'full_kit' ? 1 : clampScore(line.score) / 100;
      return +(base * band * score).toFixed(2);
    }
    case 'capped_amount': {
      const cap = Number(line.cap ?? line.amount ?? 0);
      const raw = mode === 'full_kit' ? cap : Number(line.value ?? 0);
      return +Math.min(cap, Math.max(0, raw)).toFixed(2);
    }
    case 'note':
    default:
      return 0;
  }
}

export function computeLines(
  components: Array<PayComponent & { score?: number; value?: number }>,
  mode: 'full_kit' | 'entered',
): { lines: PayrollLine[]; total: number; base: number } {
  const base = baseAmount(components);
  const lines = components.map((c) => {
    const computed = computeLine(c, base, mode);
    return { ...c, computed } as PayrollLine;
  });
  const total = +lines.reduce((a, l) => a + Number(l.computed), 0).toFixed(2);
  return { lines, total, base };
}

export function snapshotPayroll(
  components: PayComponent[],
  mode: 'full_kit' | 'zero' = 'full_kit',
): { lines: PayrollLine[]; total: number } {
  const seeded = asComponents(components).map((c) => {
    if (c.kind === 'percent_of_base') return { ...c, score: mode === 'full_kit' ? 100 : 0 };
    if (c.kind === 'capped_amount') return { ...c, value: mode === 'full_kit' ? Number(c.cap ?? c.amount ?? 0) : 0 };
    return { ...c };
  });
  return computeLines(seeded, mode === 'full_kit' ? 'full_kit' : 'entered');
}

export function applyPayrollEdits(
  lines: PayrollLine[],
  edits: Array<{ key: string; score?: number; value?: number }>,
): { lines: PayrollLine[]; total: number } {
  const patched = asPayrollLines(lines).map((l) => {
    const e = edits.find((x) => x.key === l.key);
    if (!e) return l;
    return {
      ...l,
      score: e.score !== undefined ? e.score : l.score,
      value: e.value !== undefined ? e.value : l.value,
    };
  });
  return computeLines(patched, 'entered');
}

export function typicalMemberBurn(member: Pick<TeamMember, 'components' | 'is_active' | 'exchange_rate'>): number {
  if (!member.is_active) return 0;
  const { total } = snapshotPayroll(asComponents(member.components), 'full_kit');
  return total * (Number(member.exchange_rate) || 1);
}

export function typicalTeamBurn(members: Array<Pick<TeamMember, 'components' | 'is_active' | 'exchange_rate'>>): number {
  return +members.reduce((a, m) => a + typicalMemberBurn(m), 0).toFixed(2);
}

export function inrOf(amount: number, exchangeRate?: number | null) {
  return Number(amount) * (Number(exchangeRate) || 1);
}

export function salaryExpensePayload(member: TeamMember, item: Pick<PayrollItem, 'period' | 'total'>, paidOn: string) {
  const total = inrOf(Number(item.total), member.exchange_rate);
  return {
    expense_date: paidOn,
    vendor_name: member.name,
    category: 'Salaries & Wages',
    description: `Payroll ${item.period} — ${member.name} (work month; paid first week of the next month)`,
    taxable_amount: +total.toFixed(2),
    gst_rate: 0,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    total_amount: +total.toFixed(2),
    itc_eligible: false,
    currency: 'INR',
    exchange_rate: 1,
    payment_mode: 'bank_transfer',
    notes: `Team payroll · ${item.period}`,
  };
}

export function periodLabel(period: string) {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** Work month → the calendar month when that pay is typically released (first week). */
export function payReleaseMonth(workPeriod: string) {
  const [y, m] = workPeriod.split('-').map(Number);
  const d = new Date(y, m, 1);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function previousPeriod(iso = new Date().toISOString().slice(0, 10)) {
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentPeriod(iso = new Date().toISOString().slice(0, 10)) {
  return iso.slice(0, 7);
}
