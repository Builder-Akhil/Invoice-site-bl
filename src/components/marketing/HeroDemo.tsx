'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, FileText, Landmark, Receipt, Sparkles } from 'lucide-react';

/**
 * The hero's proof-of-product: types a real sentence, then shows the record it
 * would create. Three scenes on a loop, because "what can it actually do" is
 * the only question a visitor has in the first five seconds.
 *
 * Deliberately fake — no network, no keys. The figures match what the GST
 * engine in /lib/gst.ts would compute for these inputs, so the demo is not
 * lying about the arithmetic.
 */

type Scene = {
  prompt: string;
  icon: React.ReactNode;
  kicker: string;
  title: string;
  rows: [string, string][];
  foot: string;
};

const SCENES: Scene[] = [
  {
    prompt: 'bill Acme 2.5L for the API build, Net 15',
    icon: <FileText size={13} />,
    kicker: 'Tax invoice drafted',
    title: 'BL-000017 · Acme Technologies',
    rows: [
      ['API build — SAC 998314', '₹2,50,000'],
      ['IGST @ 18%', '₹45,000'],
      ['Total', '₹2,95,000'],
      ['Due', 'Net 15 · 11 Sep'],
    ],
    foot: 'Place of supply read from their GSTIN — inter-state, so IGST, not CGST + SGST.',
  },
  {
    prompt: 'cursor renewed, $20',
    icon: <Receipt size={13} />,
    kicker: 'Expense logged',
    title: 'Cursor · Software subscription',
    rows: [
      ['USD 20 @ ₹87.40', '₹1,748'],
      ['IGST @ 18% (reverse charge)', '₹315'],
      ['Input tax credit', 'Claimable'],
    ],
    foot: 'Converted at the published rate on the bill date. Never ₹20.',
  },
  {
    prompt: 'what do I owe the government this month?',
    icon: <Landmark size={13} />,
    kicker: 'GST position · August',
    title: '₹1,12,400 payable from the LLP account',
    rows: [
      ['Tax collected on payments received', '₹1,38,600'],
      ['Input credit on company bills', '−₹26,200'],
      ['Net to pay', '₹1,12,400'],
    ],
    foot: 'Unpaid invoices are excluded — that GST is not due until the client pays.',
  },
];

const TYPE_MS = 34;
const HOLD_MS = 2600;

export default function HeroDemo() {
  const [scene, setScene] = useState(0);
  const [typed, setTyped] = useState('');
  const [showCard, setShowCard] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = SCENES[scene];

    if (reduce) {
      setTyped(s.prompt);
      setShowCard(true);
      return;
    }

    const after = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

    setTyped('');
    setShowCard(false);
    for (let i = 1; i <= s.prompt.length; i++) {
      after(i * TYPE_MS, () => setTyped(s.prompt.slice(0, i)));
    }
    const typingDone = s.prompt.length * TYPE_MS;
    after(typingDone + 380, () => setShowCard(true));
    after(typingDone + 380 + HOLD_MS, () => setScene((n) => (n + 1) % SCENES.length));

    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [scene]);

  const s = SCENES[scene];

  return (
    <div className="card overflow-hidden">
      {/* chrome */}
      <div className="flex items-center gap-2 border-b border-line/80 bg-ink-800/50 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <i className="h-2 w-2 rounded-full bg-ink-400" />
          <i className="h-2 w-2 rounded-full bg-ink-400" />
          <i className="h-2 w-2 rounded-full bg-ink-400" />
        </span>
        <span className="label-mono ml-1">Assistant</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-chrome-dark">
          <i className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> DeepSeek
        </span>
      </div>

      <div className="min-h-[318px] p-4 sm:min-h-[300px]">
        {/* the sentence */}
        <div className="flex items-start gap-2.5">
          <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-blue/15 text-blue-300">
            <Sparkles size={12} />
          </span>
          <p className="min-h-[38px] pt-0.5 text-[14.5px] leading-snug text-white">
            {typed}
            {!showCard && <span className="chat-caret" />}
          </p>
        </div>

        {/* Working indicator, so the panel is never a blank rectangle mid-type. */}
        {!showCard && (
          <div className="mt-4 flex items-center gap-2.5 pl-[34px] text-chrome">
            <span className="chat-eq" aria-hidden><i /><i /><i /></span>
            <span className="text-[12.5px]">Reading the sentence…</span>
          </div>
        )}

        {/* the record */}
        {/* A keyframe entrance, not a transition — the card is display:none until
            its scene resolves, and transitions do not run off display changes. */}
        <div className={showCard ? 'animate-in mt-3.5' : 'hidden'} aria-hidden={!showCard}>
          <div className="rounded-[9px] border border-line bg-ink-800/60 p-3.5">
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-emerald-500/15 text-emerald-300">
                <Check size={11} strokeWidth={3} />
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-emerald-300">
                {s.icon} {s.kicker}
              </span>
            </div>
            <p className="mt-2.5 font-display text-[19px] leading-tight text-white">{s.title}</p>

            <dl className="mt-3 space-y-1.5 border-t border-line/70 pt-3">
              {s.rows.map(([k, v], i) => (
                <div key={k} className="flex items-baseline justify-between gap-4">
                  <dt className={`text-[12.5px] ${i === s.rows.length - 1 ? 'text-chrome-light' : 'text-chrome'}`}>{k}</dt>
                  <dd className={`shrink-0 font-mono tabular-nums ${
                    i === s.rows.length - 1 ? 'text-[13px] font-semibold text-white' : 'text-[12.5px] text-[#C9CEDA]'}`}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-line/70 pt-2.5 text-[11.5px] leading-snug text-chrome-dark">{s.foot}</p>
          </div>
        </div>
      </div>

      {/* input rail */}
      <div className="flex items-center gap-2 border-t border-line/80 bg-ink-800/40 px-3 py-2.5">
        <span className="flex-1 truncate text-[12.5px] text-chrome-dark">Ask for an invoice, an expense, or your GST position…</span>
        <span className="grid h-[26px] w-[26px] place-items-center rounded-[6px] bg-blue text-white"><ArrowUp size={13} /></span>
      </div>

      {/* scene dots */}
      <div className="flex items-center justify-center gap-1.5 border-t border-line/80 py-2.5">
        {SCENES.map((sc, i) => (
          <button
            key={sc.prompt}
            aria-label={`Show example ${i + 1}`}
            onClick={() => setScene(i)}
            className={`h-1 rounded-full transition-all ${i === scene ? 'w-5 bg-blue' : 'w-1.5 bg-ink-400 hover:bg-chrome-dark'}`}
          />
        ))}
      </div>
    </div>
  );
}
