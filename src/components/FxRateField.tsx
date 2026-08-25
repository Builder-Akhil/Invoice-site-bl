'use client';
import { useEffect, useRef, useState } from 'react';
import { Field, Input, Spinner } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { quoteInr, rateLooksUnconverted, type FxQuote } from '@/lib/fx';

export function FxRateField({
  currency,
  onDate,
  amount,
  rate,
  onRate,
}: {
  currency?: string | null;
  onDate?: string | null;
  amount?: number;
  rate: number;
  onRate: (n: number) => void;
}) {
  const code = (currency || 'INR').toUpperCase();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<FxQuote | null>(null);
  const primed = useRef(false);

  async function refresh(apply: boolean) {
    if (code === 'INR') {
      setHint(null);
      return;
    }
    setBusy(true);
    try {
      const q = await quoteInr(code, onDate);
      setHint(q);
      if (apply) onRate(q.rate);
    } catch {
      setHint(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // First paint: only overwrite the $1=₹1 bug. Later currency/date changes take the live quote.
    const apply = !primed.current ? rateLooksUnconverted(code, rate) : true;
    primed.current = true;
    void refresh(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, onDate]);

  if (code === 'INR') return null;

  const inr = (Number(amount) || 0) * (Number(rate) || 0);

  return (
    <Field
      label={`INR per 1 ${code}`}
      hint={hint
        ? `Closest published rate on ${fmtDate(hint.asOf)}. The logged expense stamps the rate on that bill date — it is not a 1:1 copy of the ${code} figure.`
        : `Fetch the market rate to INR as of the bill / next-run date.`}
    >
      <div className="flex gap-2">
        <Input type="number" step="0.0001" className="input-mono" value={rate || ''}
          onChange={(e) => onRate(Number(e.target.value))} />
        <button type="button" className="btn-ghost btn-xs shrink-0" disabled={busy} onClick={() => void refresh(true)}>
          {busy ? <Spinner size={13} /> : 'Fetch rate'}
        </button>
      </div>
      {amount ? (
        <p className="mt-1.5 font-mono text-[12.5px] text-amber-300">
          ≈ {money(inr)}
          <span className="ml-1.5 text-[11px] text-chrome-dark">
            {money(amount, code)} × {Number(rate || 0).toFixed(2)}
          </span>
        </p>
      ) : null}
    </Field>
  );
}
