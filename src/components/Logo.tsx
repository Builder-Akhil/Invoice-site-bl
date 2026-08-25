'use client';
import { BRAND_LOGO } from '@/lib/brand';

/** Official mark on a white roundel — readable on the dark cockpit chrome. */
export function LogoMark({ size = 28 }: { size?: number; chrome?: boolean }) {
  const inner = Math.round(size * 0.78);
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BRAND_LOGO} alt="" width={inner} height={inner} style={{ width: inner, height: inner, objectFit: 'contain' }} />
    </span>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 24 : 28} />
      {!compact && (
        <div className="leading-none">
          <div className="text-[14.5px] font-extrabold tracking-tight text-white">BuildableLabs</div>
          <div className="label-mono mt-1 text-[9px]">BILLING · LLP</div>
        </div>
      )}
    </div>
  );
}
