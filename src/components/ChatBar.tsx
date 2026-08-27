'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import { sendChat } from '@/lib/chat';
import type { ChatAttachment, ChatMsg } from '@/lib/types';
import { ChatBubbles, ChatComposer, type ChatLive } from './chat-ui';

const SUGGESTIONS = [
  'Invoice AAFM India 2.5L for Consulting CTO, Aug 15 – Sept 15',
  'Quote for 40 hours of AI advisory at 12,000/hour',
  'Log Anthropic API ₹8,400 as an AI expense with ITC',
];

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const DURATION = 560;

function isChatHotkey(e: KeyboardEvent) {
  return e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyZ';
}

function shortcutLabel() {
  if (typeof navigator === 'undefined') return 'Alt+Z';
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌥Z' : 'Alt+Z';
}

export default function ChatBar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [hint, setHint] = useState('Alt+Z');
  const [live, setLive] = useState<ChatLive | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabBox = useRef<DOMRect | null>(null);
  const closing = useRef(false);

  useEffect(() => { setHint(shortcutLabel()); }, []);
  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, live]);

  const fly = useCallback((el: HTMLElement, from: DOMRect, reverse: boolean) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return el.animate([{ opacity: reverse ? 1 : 0 }, { opacity: reverse ? 0 : 1 }], { duration: 180, easing: 'ease' });
    }
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const sx = Math.max(0.08, from.width / to.width);
    const sy = Math.max(0.08, from.height / to.height);
    const start = { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4, borderRadius: '999px' };
    const end = { transform: 'translate(0, 0) scale(1)', opacity: 1, borderRadius: '1.25rem' };
    return el.animate(reverse ? [end, start] : [start, { ...end, transform: 'translate(0, 0) scale(1.03)', offset: 0.72 }, end], {
      duration: DURATION, easing: EASE, fill: 'forwards',
    });
  }, []);

  const openChat = useCallback(() => {
    if (open || closing.current) return;
    fabBox.current = fabRef.current?.getBoundingClientRect() ?? null;
    setOpen(true);
  }, [open]);

  const closeChat = useCallback(() => {
    if (!open || closing.current) return;
    const panel = panelRef.current;
    const from = fabBox.current ?? fabRef.current?.getBoundingClientRect();
    if (!panel || !from) { setOpen(false); return; }
    closing.current = true;
    const anim = fly(panel, from, true);
    anim.finished.then(() => {
      setOpen(false);
      closing.current = false;
    }).catch(() => {
      setOpen(false);
      closing.current = false;
    });
  }, [open, fly]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !fabBox.current) return;
    fly(panelRef.current, fabBox.current, false);
  }, [open, fly]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) { e.preventDefault(); closeChat(); return; }
      if (!isChatHotkey(e)) return;
      e.preventDefault();
      if (open) closeChat();
      else openChat();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, openChat, closeChat]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function send(text: string, images: ChatAttachment[] = []) {
    const content = text.trim();
    if ((!content && images.length === 0) || busy) return;
    const next: ChatMsg[] = [...msgs, { role: 'user', content, attachments: images }];
    setMsgs(next); setBusy(true);
    try {
      const j = await sendChat({
        message: content,
        history: msgs.map(({ role, content: c }) => ({ role, content: c })),
        conversationId,
        images,
      });
      setConversationId(j.conversation_id);
      setMsgs([...next, { role: 'assistant', content: j.reply, draft: j.draft, created: j.created }]);
      if (j.draft || j.created?.length) router.refresh();
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="no-print">
      {!open && (
        <button
          ref={fabRef}
          type="button"
          onClick={openChat}
          title={`Billing assistant · ${hint}`}
          aria-label={`Open billing assistant (${hint})`}
          className="chat-fab fixed bottom-5 right-5 z-[70] grid h-14 w-14 place-items-center rounded-full bg-blue text-white shadow-[0_12px_40px_-8px_rgba(11,63,222,.95)] ring-1 ring-white/15 transition hover:bg-blue-400 hover:scale-105">
          <span className="chat-fab-ring" aria-hidden />
          <Sparkles size={22} strokeWidth={1.8} />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8">
          <button type="button" aria-label="Close assistant"
            className="chat-backdrop absolute inset-0 bg-ink/70 backdrop-blur-md"
            onClick={closeChat} />
          <div
            ref={panelRef}
            className="relative flex h-[min(82vh,720px)] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-blue/25 bg-ink-700/95 shadow-pop ring-1 ring-white/10">
            <div className="pointer-events-none absolute -left-24 -top-28 h-56 w-56 rounded-full bg-blue/25 blur-3xl" />
            <div className="pointer-events-none absolute -right-16 top-20 h-40 w-40 rounded-full bg-blue/10 blur-3xl" />

            <header className="relative flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-white">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue/20 text-blue-300">
                  <Sparkles size={15} />
                </span>
                Billing assistant
                <kbd className="ml-1 hidden rounded-md border border-line bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-chrome sm:inline">{hint}</kbd>
              </p>
              <div className="flex items-center gap-1">
                <Link href="/app/chats" className="btn-subtle btn-xs" onClick={closeChat}>History</Link>
                {msgs.length > 0 && (
                  <button className="btn-subtle btn-xs" onClick={() => { setMsgs([]); setConversationId(null); }}>Clear</button>
                )}
                <button className="btn-subtle btn-xs" onClick={closeChat}><X size={15} /></button>
              </div>
            </header>

            <div ref={boxRef} className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {msgs.length === 0 && !live && (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed text-chrome">
                    Invoices, quotes, expenses, GST, payroll, runway — say it in plain English.
                    Attach a screenshot or talk. Pause, then send when you are ready.
                  </p>
                  <div className="space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)}
                        className="block w-full rounded-lg border border-line bg-ink-800/60 px-3 py-2 text-left text-[12px] text-[#C9CEDA] transition hover:border-blue/40 hover:text-white">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <ChatBubbles msgs={msgs} busy={busy} live={live} onOpenDraft={closeChat} />
            </div>

            <div className="relative shrink-0 border-t border-line px-3 py-3">
              <ChatComposer
                input={input}
                setInput={setInput}
                onSend={send}
                busy={busy}
                autoFocus
                onLiveChange={setLive}
                placeholder="Describe an invoice, attach a screenshot, or talk…"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
