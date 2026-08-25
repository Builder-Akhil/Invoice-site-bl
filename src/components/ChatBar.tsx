'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';
import { sendChat } from '@/lib/chat';
import type { ChatAttachment, ChatMsg } from '@/lib/types';
import { ChatBubbles, ChatComposer } from './chat-ui';

const SUGGESTIONS = [
  'Invoice AAFM India 2.5L for Consulting CTO, Aug 15 – Sept 15',
  'Quote for 40 hours of AI advisory at 12,000/hour',
  'Log Anthropic API ₹8,400 as an AI expense with ITC',
];

export default function ChatBar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(true); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  async function send(text: string, images: ChatAttachment[] = []) {
    const content = text.trim();
    if ((!content && images.length === 0) || busy) return;
    setOpen(true);
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
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-5">
      <div className="pointer-events-auto w-full max-w-[680px]">
        {open && (
          <div className="animate-in mb-2 overflow-hidden rounded-2xl border border-line bg-ink-700/95 shadow-pop backdrop-blur-xl">
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
                <Sparkles size={14} className="text-blue-300" /> Billing assistant
              </p>
              <div className="flex items-center gap-1">
                <Link href="/chats" className="btn-subtle btn-xs">History</Link>
                {msgs.length > 0 && (
                  <button className="btn-subtle btn-xs" onClick={() => { setMsgs([]); setConversationId(null); }}>Clear</button>
                )}
                <button className="btn-subtle btn-xs" onClick={() => setOpen(false)}><X size={15} /></button>
              </div>
            </header>

            <div ref={boxRef} className="max-h-[46vh] space-y-3 overflow-y-auto px-4 py-4">
              {msgs.length === 0 && (
                <div className="space-y-3">
                  <p className="text-[12.5px] leading-relaxed text-chrome">
                    Invoices, quotes, new clients, expenses, GST payments or ITC credits, retainers —
                    describe it in plain English. Attach a screenshot or talk; pause when you are done
                    and the words land in the box, like Claude. You send when you are ready.
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
              <ChatBubbles msgs={msgs} busy={busy} onOpenDraft={() => setOpen(false)} />
            </div>
          </div>
        )}

        <ChatComposer
          input={input}
          setInput={setInput}
          onSend={send}
          busy={busy}
          onFocus={() => setOpen(true)}
          placeholder="Describe an invoice — “Invoice AAFM 2.5L for August consulting”  ⌘K"
          leading={
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue/15 text-blue-300">
              <Sparkles size={16} />
            </span>
          }
        />
      </div>
    </div>
  );
}
