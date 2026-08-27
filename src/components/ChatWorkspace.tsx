'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageSquare, Plus, Trash2, Sparkles } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { dbMessagesToChat, sendChat } from '@/lib/chat';
import { fmtDate } from '@/lib/format';
import type { ChatAttachment, ChatMsg, Conversation, ConversationMessage } from '@/lib/types';
import { EmptyState, Loading, toast, useConfirm } from '@/components/ui';
import { ChatBubbles, ChatComposer, type ChatLive } from './chat-ui';

const SUGGESTIONS = [
  'Invoice AAFM India 2.5L for Consulting CTO, Aug 15 – Sept 15',
  'Quote for 40 hours of AI advisory at 12,000/hour',
  'Log Anthropic API ₹8,400 as an AI expense with ITC',
];

export default function ChatWorkspace({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const { confirm, confirmNode } = useConfirm();
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(!!conversationId);
  const [live, setLive] = useState<ChatLive | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const { data } = await sb().from('conversations').select('*').order('updated_at', { ascending: false });
    setConvos((data ?? []) as Conversation[]);
    setLoadingList(false);
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    const { data, error } = await sb()
      .from('conversation_messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    setLoadingThread(false);
    if (error) { toast(error.message, 'error'); return; }
    setMsgs(dbMessagesToChat((data ?? []) as ConversationMessage[]));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    if (conversationId) loadThread(conversationId);
    else setMsgs([]);
  }, [conversationId, loadThread]);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [msgs, busy, live]);

  async function send(text: string, images: ChatAttachment[] = []) {
    const content = text.trim();
    if ((!content && images.length === 0) || busy) return;
    const next: ChatMsg[] = [...msgs, { role: 'user', content, attachments: images }];
    setMsgs(next); setBusy(true);
    try {
      const j = await sendChat({
        message: content,
        history: msgs.map(({ role, content: c }) => ({ role, content: c })),
        conversationId: conversationId ?? null,
        images,
      });
      setMsgs([...next, { role: 'assistant', content: j.reply, draft: j.draft, created: j.created }]);
      if (j.draft || j.created?.length) router.refresh();
      if (!conversationId) router.replace(`/app/chats/${j.conversation_id}`);
      else loadList();
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong.' }]);
    } finally { setBusy(false); }
  }

  async function remove(c: Conversation) {
    if (!(await confirm(`Delete “${c.title}”? This cannot be undone.`))) return;
    const { error } = await sb().from('conversations').delete().eq('id', c.id);
    if (error) return toast(error.message, 'error');
    toast('Chat deleted');
    if (conversationId === c.id) router.push('/app/chats');
    loadList();
  }

  const active = convos.find((c) => c.id === conversationId);

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-line bg-ink-800/40 lg:flex-row">
      {confirmNode}
      <aside className="flex max-h-52 w-full shrink-0 flex-col border-b border-line lg:max-h-none lg:w-[260px] lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
          <p className="text-[13px] font-semibold text-white">Chats</p>
          <Link href="/app/chats" onClick={() => { if (!conversationId) { setMsgs([]); setInput(''); } }}
            className="btn-primary btn-xs"><Plus size={13} /> New</Link>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loadingList ? <Loading label="Loading chats" />
            : convos.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-chrome">No chats yet. Start one on the right — it is saved like a flight log.</p>
            ) : convos.map((c) => (
              <div key={c.id} className={`group mb-0.5 flex items-center rounded-lg ${c.id === conversationId ? 'bg-blue/12 ring-1 ring-inset ring-blue/35' : 'hover:bg-ink-600'}`}>
                <Link href={`/app/chats/${c.id}`} className="min-w-0 flex-1 px-3 py-2.5">
                  <span className="block truncate text-[13px] font-medium text-white">{c.title}</span>
                  <span className="block text-[11px] text-chrome-dark">{fmtDate(c.updated_at)}</span>
                </Link>
                <button className="btn-subtle btn-xs mr-1 opacity-0 group-hover:opacity-100" title="Delete"
                  onClick={() => remove(c)}><Trash2 size={13} /></button>
              </div>
            ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Sparkles size={14} className="text-blue-300" />
          <p className="truncate text-[13.5px] font-semibold text-white">{active?.title ?? 'New chat'}</p>
        </header>

        <div ref={boxRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {loadingThread ? <Loading label="Opening chat" />
            : msgs.length === 0 && !live ? (
              <EmptyState icon={<MessageSquare size={18} />} title="Talk, type, or attach a screenshot"
                body="Invoices, quotes, clients, expenses, GST payments or credits, retainers. Type it, drop a screenshot, or tap the mic — when you pause, the words fill the box. You send when you are ready."
                action={
                  <div className="mt-1 w-full max-w-md space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)}
                        className="block w-full rounded-lg border border-line bg-ink-800/60 px-3 py-2 text-left text-[12px] text-[#C9CEDA] transition hover:border-blue/40 hover:text-white">
                        {s}
                      </button>
                    ))}
                  </div>
                } />
            ) : <ChatBubbles msgs={msgs} busy={busy} live={live} />}
        </div>

        <div className="shrink-0 border-t border-line px-4 py-3">
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
      </section>
    </div>
  );
}
