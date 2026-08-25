import { addDays, daysBetween } from './format';

/** Same options as the invoice Terms dropdown. */
export const TERM_PRESETS = [
  { label: 'Due on Receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Net 60', days: 60 },
  { label: 'Custom', days: -1 },
] as const;

export type TermLabel = (typeof TERM_PRESETS)[number]['label'];

/** Map a day count onto a dropdown preset. Unknown counts (Net 20) become Custom. */
export function presetForDays(days: number): { label: string; days: number } {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 0) return { label: 'Custom', days: -1 };
  const hit = TERM_PRESETS.find((t) => t.days === n);
  if (hit) return { label: hit.label, days: hit.days };
  return { label: 'Custom', days: n };
}

/** Parse "Net 15", "net15", "Due on Receipt", or a preset label. */
export function parseTermsLabel(raw?: string | null): { label: string; days: number } | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const lower = s.toLowerCase().replace(/[_-]+/g, ' ');
  if (lower === 'custom') return { label: 'Custom', days: -1 };
  if (/due on receipt|on receipt|immediate|due immediately/.test(lower)) {
    return { label: 'Due on Receipt', days: 0 };
  }
  const net = lower.match(/net\s*(\d+)/);
  if (net) return presetForDays(Number(net[1]));
  const exact = TERM_PRESETS.find((t) => t.label.toLowerCase() === lower);
  if (exact) return { label: exact.label, days: exact.days };
  return { label: 'Custom', days: -1 };
}

/**
 * Terms + due date for a new invoice.
 * - "Net 15" → Net 15, due = invoice date + 15 (ignores a stuffed due_date).
 * - A calendar due date → Custom (unless it lands exactly on a Net preset and terms were omitted).
 * - Otherwise client / company payment days, mapped onto the dropdown.
 */
export function resolveInvoiceTerms(input: {
  invoiceDate: string;
  dueDate?: string | null;
  termsLabel?: string | null;
  paymentTermsDays?: number | null;
  defaultDueDays?: number | null;
}): { terms_label: string; due_date: string } {
  const invoiceDate = input.invoiceDate;
  const due = (input.dueDate ?? '').trim() || null;
  const parsed = parseTermsLabel(input.termsLabel);

  if (parsed && parsed.label !== 'Custom' && parsed.days >= 0) {
    return { terms_label: parsed.label, due_date: addDays(invoiceDate, parsed.days) };
  }

  if (parsed?.label === 'Custom' && parsed.days >= 0 && !due) {
    return { terms_label: 'Custom', due_date: addDays(invoiceDate, parsed.days) };
  }

  if (due) {
    if (parsed?.label === 'Custom') return { terms_label: 'Custom', due_date: due };
    const gap = daysBetween(invoiceDate, due);
    const preset = TERM_PRESETS.find((t) => t.days === gap);
    if (preset && preset.days >= 0) return { terms_label: preset.label, due_date: due };
    return { terms_label: 'Custom', due_date: due };
  }

  const days = input.paymentTermsDays != null && Number.isFinite(Number(input.paymentTermsDays))
    ? Number(input.paymentTermsDays)
    : Number(input.defaultDueDays ?? 7);
  const preset = presetForDays(days);
  return {
    terms_label: preset.label,
    due_date: addDays(invoiceDate, Math.max(0, Number.isFinite(days) ? days : 7)),
  };
}
