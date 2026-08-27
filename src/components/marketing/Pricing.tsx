'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Minus } from 'lucide-react';
import { PLANS, PRODUCT, yearlySavingMonths } from '@/lib/product';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <>
      <div className="mb-8 flex items-center justify-center gap-3">
        <span className={`text-[13px] font-semibold transition ${yearly ? 'text-chrome' : 'text-white'}`}>Monthly</span>
        <button
          role="switch"
          aria-checked={yearly}
          aria-label="Bill yearly"
          onClick={() => setYearly((v) => !v)}
          className={`relative h-[22px] w-[40px] rounded-full border border-line transition ${yearly ? 'bg-blue' : 'bg-ink-500'}`}>
          <span className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-all ${yearly ? 'left-[21px]' : 'left-[2px]'}`} />
        </button>
        <span className={`text-[13px] font-semibold transition ${yearly ? 'text-white' : 'text-chrome'}`}>
          Yearly
          <span className="ml-1.5 rounded-[4px] bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-bold text-emerald-300">
            2 months free
          </span>
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((p) => {
          const custom = p.monthly == null;
          const free = p.monthly === 0;
          const saved = yearlySavingMonths(p);
          return (
            <section
              key={p.id}
              className={`card relative flex flex-col p-6 ${
                p.featured ? 'ring-1 ring-inset ring-blue/40' : ''}`}>
              {p.featured && (
                <span className="absolute -top-2.5 left-6 rounded-[5px] bg-blue px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                  Most founders pick this
                </span>
              )}

              <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-chrome-light">{p.name}</h3>

              <div className="mt-3 flex items-baseline gap-1.5">
                {custom ? (
                  <span className="font-display text-[36px] leading-none text-white">Let&apos;s talk</span>
                ) : (
                  <>
                    <span className="font-display text-[40px] leading-none tracking-[-0.02em] text-white">
                      {free ? '₹0' : inr(yearly ? Math.round((p.yearly as number) / 12) : (p.monthly as number))}
                    </span>
                    {!free && <span className="text-[12.5px] text-chrome">/month</span>}
                  </>
                )}
              </div>

              <p className="mt-1.5 min-h-[18px] text-[12px] text-chrome">
                {custom ? 'One-time setup, then it is yours'
                  : free ? 'Free forever. No card, no trial clock.'
                    : yearly ? `${inr(p.yearly as number)} billed once · ${saved} months free`
                      : `or ${inr(p.yearly as number)}/year`}
              </p>

              <p className="mt-4 border-t border-line/80 pt-4 text-[13px] leading-relaxed text-chrome-light">{p.pitch}</p>

              <ul className="mt-4 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[12.5px] leading-snug text-[#C9CEDA]">
                    <Check size={13} className="mt-[3px] shrink-0 text-emerald-400" strokeWidth={2.6} />
                    {f}
                  </li>
                ))}
                {p.id === 'free' && (
                  <li className="flex gap-2.5 text-[12.5px] leading-snug text-chrome-dark">
                    <Minus size={13} className="mt-[3px] shrink-0" />
                    No assistant, WhatsApp or Telegram
                  </li>
                )}
              </ul>

              <div className="mt-6">
                {custom ? (
                  <a href={`mailto:${PRODUCT.supportEmail}?subject=${encodeURIComponent(`${p.name} — self-hosted setup`)}`}
                    className="btn-ghost w-full">
                    {p.cta} <ArrowRight size={14} />
                  </a>
                ) : (
                  <Link href="/login" className={`${p.featured ? 'btn-primary' : 'btn-ghost'} w-full`}>
                    {p.cta} <ArrowRight size={14} />
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
