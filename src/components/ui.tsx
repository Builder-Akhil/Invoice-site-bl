'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { X, Check, AlertTriangle, Info, Loader2, ChevronDown, HelpCircle } from 'lucide-react';

/* ------------------------------------------------------------------ toast */
type ToastKind = 'success' | 'error' | 'info';
export function toast(message: string, kind: ToastKind = 'success') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('bl:toast', { detail: { message, kind, id: Math.random() } }));
}

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setItems((s) => [...s, d]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== d.id)), 4200);
    };
    window.addEventListener('bl:toast', h);
    return () => window.removeEventListener('bl:toast', h);
  }, []);
  return (
    <div className="fixed bottom-24 right-5 z-[90] flex flex-col gap-2 no-print">
      {items.map((t) => (
        <div key={t.id}
          className={`animate-in flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-pop backdrop-blur max-w-[360px] ${
            t.kind === 'success' ? 'border-emerald-800/70 bg-emerald-950/85 text-emerald-200'
            : t.kind === 'error' ? 'border-red-900/70 bg-red-950/85 text-red-200'
            : 'border-line bg-ink-600/95 text-[#D6DAE3]'}`}>
          {t.kind === 'success' ? <Check size={15} className="mt-px shrink-0" />
            : t.kind === 'error' ? <AlertTriangle size={15} className="mt-px shrink-0" />
            : <Info size={15} className="mt-px shrink-0" />}
          <span className="leading-snug">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- tooltip */
type TipSide = 'top' | 'bottom' | 'left' | 'right';
const TIP_POS: Record<TipSide, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

/** Hover/focus tooltip. CSS-driven, so it works without a portal or state. */
export function Tooltip({ tip, side = 'top', children, className = '' }: {
  tip: React.ReactNode; side?: TipSide; children: React.ReactNode; className?: string;
}) {
  return (
    <span className={`tip-host relative inline-flex ${className}`} tabIndex={0}>
      {children}
      <span role="tooltip" className={`tip-bubble ${TIP_POS[side]}`}>{tip}</span>
    </span>
  );
}

/**
 * The workhorse for de-cluttering: an ⓘ that holds the explanation a paragraph
 * used to hold. Keyboard-reachable, so the copy is not hover-only.
 */
export function InfoHint({ tip, side = 'top', className = '' }: {
  tip: React.ReactNode; side?: TipSide; className?: string;
}) {
  return (
    <Tooltip tip={tip} side={side} className={className}>
      <HelpCircle
        size={12.5}
        strokeWidth={2}
        className="shrink-0 cursor-help text-chrome-dark transition-colors hover:text-chrome-light"
        aria-label="More information"
      />
    </Tooltip>
  );
}

/* -------------------------------------------------------------- collapse */
/** Native <details> so it works before hydration and prints open if needed. */
export function Collapse({ title, note, children, defaultOpen = false, className = '' }: {
  title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode;
  defaultOpen?: boolean; className?: string;
}) {
  return (
    <details open={defaultOpen} className={`card group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-[13px] font-semibold text-white [&::-webkit-details-marker]:hidden">
        <ChevronDown size={14} className="shrink-0 text-chrome transition-transform group-open:rotate-180" />
        {title}
        {note && <span className="ml-auto text-[11.5px] font-normal text-chrome-dark">{note}</span>}
      </summary>
      <div className="border-t border-line/80 px-5 py-4">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------- stat tile */
/**
 * One number, one label, and the explanation tucked behind an ⓘ instead of
 * sitting underneath as a third line of grey text.
 */
export function StatTile({ label, value, tone = 'text-white', hint, icon, href, foot }: {
  label: string; value: React.ReactNode; tone?: string;
  hint?: React.ReactNode; icon?: React.ReactNode; href?: string; foot?: React.ReactNode;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5">
        <p className="label-mono truncate">{label}</p>
        {hint && <InfoHint tip={hint} />}
        {icon && <span className="ml-auto text-chrome-dark">{icon}</span>}
      </div>
      <p className={`mt-2 font-display text-[27px] leading-none tracking-[-0.015em] ${tone}`}>{value}</p>
      {foot && <p className="mt-1.5 text-[11px] leading-snug text-chrome-dark">{foot}</p>}
    </>
  );
  if (href) {
    const Anchor = 'a' as const;
    return <Anchor href={href} className="tile block transition hover:border-chrome-dark">{inner}</Anchor>;
  }
  return <div className="tile">{inner}</div>;
}

/* ------------------------------------------------------------------ card */
export function Card({ title, subtitle, hint, action, children, className = '', bodyClass = 'card-pad' }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line/80 px-5 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-1.5 text-[13px] font-bold leading-tight text-white">
                {title}
                {hint && <InfoHint tip={hint} />}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-[11.5px] text-chrome">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ field */
export function Field({ label, hint, tip, required, children, className = '' }: {
  label?: string; hint?: React.ReactNode;
  /** Explanation behind an ⓘ next to the label — use this over `hint` for anything longer than a format example. */
  tip?: React.ReactNode;
  required?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      {label && (
        <label className="field-label flex items-center gap-1.5">
          <span>{label}{required && <span className="text-blue-300"> *</span>}</span>
          {tip && <InfoHint tip={tip} />}
        </label>
      )}
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-chrome-dark">{hint}</p>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...p }, ref) {
    return <input ref={ref} {...p} className={`input ${className}`} />;
  });

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...p }, ref) {
    return <select ref={ref} {...p} className={`input ${className}`}>{children}</select>;
  });

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', rows = 3, ...p }, ref) {
    return <textarea ref={ref} rows={rows} {...p} className={`input ${className}`} />;
  });

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-[13px] text-[#C9CEDA]">
      <span className={`relative h-[18px] w-[32px] rounded-full transition ${checked ? 'bg-blue' : 'bg-ink-400'}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
      </span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ modal */
export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm no-print"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`animate-in my-8 w-full ${width} rounded-2xl border border-line bg-ink-700 shadow-pop`}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h3 className="font-display text-[22px] leading-tight text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-chrome">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-subtle btn-xs -mr-1"><X size={16} /></button>
        </header>
        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ msg: string; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback((msg: string) => new Promise<boolean>((resolve) => setState({ msg, resolve })), []);
  const node = state ? (
    <Modal open onClose={() => { state.resolve(false); setState(null); }} title="Are you sure?" width="max-w-md"
      footer={<>
        <button className="btn-ghost" onClick={() => { state.resolve(false); setState(null); }}>Cancel</button>
        <button className="btn-danger" onClick={() => { state.resolve(true); setState(null); }}>Yes, continue</button>
      </>}>
      <p className="text-[13.5px] leading-relaxed text-[#C9CEDA]">{state.msg}</p>
    </Modal>
  ) : null;
  return { confirm, confirmNode: node };
}

/* ------------------------------------------------------------------ misc */
export const Spinner = ({ size = 16 }: { size?: number }) =>
  <Loader2 size={size} className="animate-spin text-chrome" />;

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-[13px] text-chrome">
      <Spinner /> {label}…
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: {
  icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon && <div className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-ink-600 text-chrome">{icon}</div>}
      <div>
        <p className="text-[15px] font-semibold text-white">{title}</p>
        {body && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-chrome">{body}</p>}
      </div>
      {action}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-ink-400 text-chrome-light',
  sent: 'bg-blue/15 text-blue-300 ring-1 ring-inset ring-blue/30',
  viewed: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/30',
  partially_paid: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  paid: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  overdue: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30',
  cancelled: 'bg-ink-400 text-chrome-dark line-through',
  accepted: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  declined: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30',
};
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', viewed: 'Viewed', partially_paid: 'Part paid',
  paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', accepted: 'Accepted', declined: 'Declined',
};
export const StatusPill = ({ status }: { status: string }) => (
  <span className={`pill ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>{STATUS_LABEL[status] ?? status}</span>
);

export function Tabs({ tabs, active, onChange }: {
  tabs: { key: string; label: string; count?: number; icon?: React.ReactNode }[];
  active: string; onChange: (k: string) => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-[8px] border border-line bg-ink-800/60 p-[3px]">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 rounded-[5px] px-2.5 py-[5px] text-[12px] font-semibold transition ${
            active === t.key
              ? 'bg-ink-500 text-white shadow-[0_1px_0_0_rgba(255,255,255,.08)_inset]'
              : 'text-chrome hover:text-white'}`}>
          {t.icon}{t.label}
          {t.count !== undefined && <span className="text-[11px] font-normal text-chrome-dark">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, hint, meta, children }: {
  title: string; subtitle?: string;
  /** Long explanation — goes behind an ⓘ so the header stays one line. */
  hint?: React.ReactNode;
  /** Short factual chips (entity, FY, GSTIN) instead of a run-on subtitle. */
  meta?: React.ReactNode[];
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-[29px] leading-none tracking-[-0.015em] text-white">
          {title}
          {hint && <InfoHint tip={hint} side="bottom" />}
        </h1>
        {subtitle && <p className="mt-1.5 text-[12.5px] text-chrome">{subtitle}</p>}
        {meta && meta.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            {meta.filter(Boolean).map((m, i) => <span key={i} className="chip">{m}</span>)}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
