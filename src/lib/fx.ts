/** Closest INR quote for a foreign amount, as of a bill / next-run date. */

export type FxQuote = {
  from: string;
  to: 'INR';
  rate: number;
  asOf: string;
  source: 'parity' | 'frankfurter' | 'er-api' | 'usd-peg' | 'fallback';
};

/** Used only if every live feed is down. Ballpark mid-2026. */
export const FX_FALLBACK_INR: Record<string, number> = {
  USD: 95.5,
  EUR: 111,
  GBP: 130,
  AED: 26,
  SGD: 75,
  AUD: 68,
  CAD: 69,
  SAR: 25.5,
};

/** 1 unit of currency in USD (AED/SAR pegs). Frankfurter does not list these. */
const USD_VALUE: Record<string, number> = {
  AED: 1 / 3.6725,
  SAR: 1 / 3.75,
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const roundRate = (n: number) => +n.toFixed(4);

export function fxLookupDate(onDate?: string | null) {
  const today = todayISO();
  const want = (onDate || today).slice(0, 10);
  return want > today ? today : want;
}

/** True when a USD (etc.) row is still stored as 1:1 rupees — the $125 → ₹125 bug. */
export function rateLooksUnconverted(currency?: string | null, rate?: number | string | null) {
  const c = (currency || 'INR').toUpperCase();
  if (c === 'INR') return false;
  const r = Number(rate);
  return !Number.isFinite(r) || r <= 1;
}

async function readJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function frankfurter(from: string, date: string): Promise<FxQuote | null> {
  const today = todayISO();
  const path = date >= today ? 'latest' : date;
  for (const host of ['https://api.frankfurter.app', 'https://api.frankfurter.dev']) {
    const j = await readJson(`${host}/${path}?from=${encodeURIComponent(from)}&to=INR`);
    const rates = j?.rates as { INR?: number } | undefined;
    const rate = Number(rates?.INR);
    if (rate > 0) {
      return {
        from, to: 'INR', rate: roundRate(rate),
        asOf: String(j?.date || date), source: 'frankfurter',
      };
    }
  }
  return null;
}

async function erApi(from: string, date: string): Promise<FxQuote | null> {
  const j = await readJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
  const rates = j?.rates as Record<string, number> | undefined;
  const rate = Number(rates?.INR);
  if (!(rate > 0)) return null;
  const utc = typeof j?.time_last_update_utc === 'string' ? j.time_last_update_utc : '';
  const asOf = utc ? new Date(utc).toISOString().slice(0, 10) : date;
  return { from, to: 'INR', rate: roundRate(rate), asOf, source: 'er-api' };
}

export async function fetchInrRate(from: string, onDate?: string | null): Promise<FxQuote> {
  const code = (from || 'INR').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'INR';
  const date = fxLookupDate(onDate);
  if (code === 'INR') return { from: 'INR', to: 'INR', rate: 1, asOf: date, source: 'parity' };

  const direct = await frankfurter(code, date);
  if (direct) return direct;

  const peg = USD_VALUE[code];
  if (peg) {
    const usd = await frankfurter('USD', date);
    if (usd) {
      return { from: code, to: 'INR', rate: roundRate(usd.rate * peg), asOf: usd.asOf, source: 'usd-peg' };
    }
  }

  const live = await erApi(code, date);
  if (live) return live;

  return {
    from: code, to: 'INR',
    rate: FX_FALLBACK_INR[code] ?? FX_FALLBACK_INR.USD,
    asOf: date, source: 'fallback',
  };
}

/** Browser talks to /api/fx (auth + cache). Server calls the feeds directly. */
export async function quoteInr(from: string, onDate?: string | null): Promise<FxQuote> {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams({ from: from || 'INR' });
    if (onDate) params.set('date', onDate);
    const res = await fetch(`/api/fx?${params.toString()}`);
    const body = await res.json().catch(() => ({})) as FxQuote & { error?: string };
    if (!res.ok) throw new Error(body.error || 'Could not fetch exchange rate');
    return body;
  }
  return fetchInrRate(from, onDate);
}

export async function patchUnconvertedRates<T extends { id: string; currency?: string | null; exchange_rate?: number | string | null }>(
  rows: T[],
  dateOf: (row: T) => string | null | undefined,
  save: (id: string, rate: number) => Promise<void>,
): Promise<T[]> {
  const stale = rows.filter((r) => rateLooksUnconverted(r.currency, r.exchange_rate));
  if (!stale.length) return rows;
  const rates = new Map<string, number>();
  await Promise.all(stale.map(async (r) => {
    const q = await quoteInr(r.currency || 'USD', dateOf(r));
    await save(r.id, q.rate);
    rates.set(r.id, q.rate);
  }));
  return rows.map((r) => (rates.has(r.id) ? { ...r, exchange_rate: rates.get(r.id)! } : r));
}
