'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Banknote, CreditCard, FileText, Fuel, ImagePlus, Landmark, Loader2, Mic, Receipt, Square, UserPlus, UsersRound, X } from 'lucide-react';
import { money } from '@/lib/format';
import { compressImage, isAllowedImage, previewOf, useDictation } from '@/lib/chat';
import { toast } from '@/components/ui';
import type { ChatAttachment, ChatCreated, ChatMsg } from '@/lib/types';

export type ChatLive = { text: string; locked: string; live: string };

function CreatedCards({ items, onOpenDraft }: { items: ChatCreated[]; onOpenDraft?: (id: string) => void }) {
  const router = useRouter();
  return (
    <div className="mt-2.5 space-y-1.5">
      {items.map((item, i) => {
        const Icon = item.kind === 'expense' ? Receipt
          : item.kind === 'client' ? UserPlus
            : item.kind === 'gst' ? Landmark
              : item.kind === 'team' ? UsersRound
                : item.kind === 'payroll' ? Banknote
                  : item.kind === 'subscription' ? CreditCard
                    : item.kind === 'cash' ? Fuel
                      : item.kind === 'retainer' ? FileText
                        : FileText;
        return (
          <button key={`${item.kind}-${item.id ?? i}`} type="button" onClick={() => {
            if (item.kind === 'invoice' && item.id) onOpenDraft?.(item.id);
            router.push(item.href);
          }}
            className="flex w-full items-center gap-2.5 rounded-lg border border-blue/35 bg-blue/12 px-3 py-2 text-left transition hover:bg-blue/20">
            <Icon size={15} className="shrink-0 text-blue-300" />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[12.5px] text-white">{item.title}</span>
              {item.subtitle && <span className="block truncate text-[11px] text-chrome">{item.subtitle}</span>}
            </span>
            {item.amount && <span className="shrink-0 font-mono text-[12.5px] text-white">{item.amount}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ChatBubbles({ msgs, busy, onOpenDraft, live }: {
  msgs: ChatMsg[]; busy: boolean; onOpenDraft?: (id: string) => void; live?: ChatLive | null;
}) {
  return (
    <>
      {msgs.map((m, i) => (
        <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
          <div className={`max-w-[86%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
            m.role === 'user' ? 'bg-blue text-white' : 'border border-line bg-ink-600/70 text-[#D6DAE3]'}`}>
            {!!m.attachments?.length && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {m.attachments.map((a, ai) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={ai} src={previewOf(a)} alt=""
                    className="h-20 w-20 rounded-lg object-cover ring-1 ring-white/15" />
                ))}
              </div>
            )}
            {m.content && <p className="whitespace-pre-line">{m.content}</p>}
            {!!m.created?.length && <CreatedCards items={m.created} onOpenDraft={onOpenDraft} />}
            {!m.created?.length && m.draft && (
              <CreatedCards items={[{
                kind: 'invoice',
                id: m.draft.id,
                href: `/invoices/${m.draft.id}`,
                title: m.draft.invoice_number,
                subtitle: m.draft.client_name,
                amount: money(m.draft.total, m.draft.currency),
              }]} onOpenDraft={onOpenDraft} />
            )}
          </div>
        </div>
      ))}
      {live && (
        <div className="flex justify-end">
          <div className="chat-live-bubble max-w-[86%] rounded-xl bg-blue px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
            <p className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/70">
              <span className="chat-eq" aria-hidden><i /><i /><i /></span>
              Live
            </p>
            <p className="whitespace-pre-wrap break-words">
              {live.locked && <span>{live.locked}{live.live ? ' ' : ''}</span>}
              {live.live
                ? <span className="text-white/80">{live.live}</span>
                : !live.locked && <span className="text-white/65">Listening…</span>}
              <span className="chat-caret" aria-hidden />
            </p>
          </div>
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-2 text-[12.5px] text-chrome">
          <Loader2 size={14} className="animate-spin" /> Working…
        </div>
      )}
    </>
  );
}

export function ChatComposer({
  input, setInput, onSend, busy, placeholder, onFocus, autoFocus, leading, onLiveChange,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: (text: string, images: ChatAttachment[]) => void;
  busy: boolean;
  placeholder?: string;
  onFocus?: () => void;
  autoFocus?: boolean;
  leading?: ReactNode;
  onLiveChange?: (live: ChatLive | null) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ChatAttachment[]>([]);

  const commitSpeech = (text: string) => {
    const next = [input, text].filter((s) => s.trim()).join(' ').replace(/\s+/g, ' ').trim();
    setInput(next);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(120, el.scrollHeight)}px`;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  };

  const { listening, draft, toggle, stop, supported } = useDictation(commitSpeech);

  useEffect(() => {
    if (!onLiveChange) return;
    if (!listening) { onLiveChange(null); return; }
    onLiveChange({
      text: [input, draft].filter((s) => s.trim()).join(' ').replace(/\s+/g, ' ').trim(),
      locked: input.trim(),
      live: draft,
    });
  }, [listening, draft, input, onLiveChange]);

  async function addFiles(list: FileList | File[]) {
    const files = [...list].filter(isAllowedImage).slice(0, 4 - images.length);
    if (!files.length) return;
    try {
      const next = [...images];
      for (const f of files) next.push(await compressImage(f));
      setImages(next.slice(0, 4));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not attach that image', 'error');
    }
  }

  function send() {
    const text = [input, listening ? draft : ''].filter((s) => s.trim()).join(' ').replace(/\s+/g, ' ').trim();
    if ((!text && images.length === 0) || busy) return;
    if (listening) stop({ commit: false });
    onSend(text, images);
    setInput('');
    setImages([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }

  const canSend = (!!input.trim() || !!draft.trim() || images.length > 0) && !busy;

  return (
    <div>
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {images.map((img, i) => (
            <span key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewOf(img)} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-line" />
              <button type="button" onClick={() => setImages(images.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink-500 text-white ring-1 ring-line">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(); }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (!files.length) return;
          e.preventDefault();
          addFiles(files);
        }}
        className={`rounded-2xl border bg-ink-700/95 p-2 shadow-pop backdrop-blur-xl transition ${
          listening ? 'border-blue/50 ring-2 ring-blue/25' : 'border-line'}`}>
        {listening && (
          <p className="flex items-center gap-2 px-2 pb-1.5 pt-0.5 text-[11.5px] text-blue-200">
            <span className="chat-eq" aria-hidden><i /><i /><i /></span>
            Words appear in the chat — pause when you are done
          </p>
        )}
        <div className="flex items-end gap-1.5">
          {leading}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/*"
            className="hidden" multiple onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" title="Attach image"
            onClick={() => fileRef.current?.click()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-chrome transition hover:bg-ink-500 hover:text-white">
            <ImagePlus size={16} />
          </button>
          <textarea ref={inputRef} rows={1} value={input} autoFocus={autoFocus}
            onFocus={onFocus}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={listening ? 'Listening…' : (placeholder ?? 'Describe an invoice')}
            className="max-h-[120px] flex-1 resize-none bg-transparent py-2 text-[13.5px] text-white outline-none placeholder:text-chrome-dark" />
          <button type="button"
            title={supported ? (listening ? 'Stop dictation' : 'Talk — words appear in the chat') : 'Voice needs Chrome or Safari'}
            onClick={() => {
              if (!supported) {
                toast('Voice dictation needs Chrome or Safari — Firefox does not carry this instrument.', 'info');
                return;
              }
              toggle();
            }}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${
              listening ? 'bg-red-500/90 text-white' : 'text-chrome hover:bg-ink-500 hover:text-white'}`}>
            {listening ? <Square size={13} /> : <Mic size={16} />}
          </button>
          <button type="submit" disabled={!canSend}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue text-white transition hover:bg-blue-400 disabled:opacity-35">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </form>
    </div>
  );
}
