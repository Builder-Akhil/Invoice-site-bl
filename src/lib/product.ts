/**
 * Product identity + commercial constants.
 *
 * Everything the marketing site, SEO payloads and plan gates read comes from
 * here. Renaming the product is one edit to PRODUCT.name; repricing is one edit
 * to PLANS. Nothing else in the codebase hardcodes either.
 */

export const PRODUCT = {
  /** A munshi is the clerk who keeps the books. This one listens. */
  name: 'Munshi',
  legalOwner: 'Buildable Labs LLP',
  domain: 'munshi.app',
  url: 'https://munshi.app',
  tagline: 'The invoicing clerk that listens.',
  /** One sentence. Used in <meta description>, JSON-LD and llms.txt. */
  blurb:
    'Munshi is an AI invoicing and GST desk for Indian founders and SMEs. Type a sentence — "bill Acme 2.5L for the API build, Net 15" — and it raises a compliant tax invoice, tracks the payment and hands your CA a filing-ready GST pack.',
  supportEmail: 'akhil@buildablelabs.com',
  founder: 'Akhil Kumar Alampally',
  twitter: '@buildablelabs',
} as const;

/** Where the signed-in product lives. The marketing site owns '/'. */
export const APP_BASE = '/app';

export type PlanId = 'free' | 'pro' | 'byo';

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in INR. null = talk to us. */
  monthly: number | null;
  /** Annual price in INR, billed once. null = n/a. */
  yearly: number | null;
  pitch: string;
  /** Hard cap on invoices issued per calendar month. null = unlimited. */
  invoicesPerMonth: number | null;
  /** Whether the natural-language assistant is available at all. */
  ai: boolean;
  features: string[];
  /** Shown with a muted treatment; only one plan may be featured. */
  featured?: boolean;
  cta: string;
};

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    yearly: 0,
    pitch: 'Enough to run a side practice. No card, no trial clock.',
    invoicesPerMonth: 3,
    ai: false,
    cta: 'Start free',
    features: [
      '3 invoices a month',
      'GST-compliant tax invoices + PDF',
      'CGST / SGST / IGST worked out for you',
      'Public payment link per invoice',
      'Clients, services and expense log',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 999,
    yearly: 9990,
    pitch: 'For the founder who would rather type one sentence than fill a form.',
    invoicesPerMonth: null,
    ai: true,
    featured: true,
    cta: 'Go Pro',
    features: [
      'Unlimited invoices, quotes and retainers',
      'The assistant — invoice, expense and GST by sentence',
      'Receipt photos read and filed automatically',
      'WhatsApp and Telegram — bill from your phone',
      'Filing-ready GSTR-1 and GSTR-3B packs',
      'Team payroll, subscriptions, runway',
      'Bring your own Claude or DeepSeek key — pay us less',
    ],
  },
  {
    id: 'byo',
    name: 'Own It',
    monthly: null,
    yearly: null,
    pitch: 'Your Supabase, your API keys, your Vercel. We hand over the keys.',
    invoicesPerMonth: null,
    ai: true,
    cta: 'Talk to Akhil',
    features: [
      'Deployed on infrastructure you own',
      'Setup runbook — an AI agent does it in ~30 minutes',
      'No per-seat pricing, ever',
      'Your data never touches our servers',
      'Optional maintenance retainer',
    ],
  },
];

export const planById = (id: PlanId) => PLANS.find((p) => p.id === id) ?? PLANS[0];

/** Cheapest paid monthly price — for "Pro from ₹999" style copy. */
export const PAID_FROM = Math.min(
  ...PLANS.filter((p) => p.monthly != null && p.monthly > 0).map((p) => p.monthly as number),
);

/** Months free when paying yearly, for the annual toggle badge. */
export function yearlySavingMonths(plan: Plan) {
  if (!plan.monthly || !plan.yearly) return 0;
  return Math.round((plan.monthly * 12 - plan.yearly) / plan.monthly);
}
