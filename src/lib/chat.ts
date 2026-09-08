'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAttachment, ChatCreated, ChatDraft, ChatMsg, ConversationMessage } from './types';

export function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'New chat';
  return t.length > 72 ? `${t.slice(0, 69)}…` : t;
}

export function previewOf(att: ChatAttachment) {
  return att.preview || `data:${att.media_type};base64,${att.data}`;
}

export function normalizeCreated(raw: unknown): ChatCreated[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: ChatCreated[] = [];
  for (const item of list) {
    const d = item as Partial<ChatCreated & ChatDraft>;
    if (d.kind && d.href) {
      out.push(d as ChatCreated);
      continue;
    }
    if (d.invoice_number && d.id) {
      out.push({
        kind: 'invoice',
        id: d.id,
        href: `/app/invoices/${d.id}`,
        title: d.invoice_number,
        subtitle: d.client_name,
        invoice_number: d.invoice_number,
        total: d.total,
        currency: d.currency,
        client_name: d.client_name,
      });
    }
  }
  return out;
}

export function dbMessagesToChat(rows: ConversationMessage[]): ChatMsg[] {
  return rows.map((r) => {
    const created = normalizeCreated(r.draft);
    const invoice = created.find((c) => c.kind === 'invoice');
    return {
      role: r.role,
      content: r.content,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      created,
      draft: invoice ? {
        id: invoice.id ?? '',
        invoice_number: invoice.invoice_number ?? invoice.title,
        total: invoice.total ?? 0,
        currency: invoice.currency ?? 'INR',
        client_name: invoice.client_name ?? invoice.subtitle ?? '',
      } : null,
    };
  });
}

export type ChatEngine = { provider: string; label: string; model: string; key: 'byo' | 'platform' };

/**
 * A refusal the user can act on: a plan limit or a missing key, as opposed to
 * something going wrong. The chat UI offers the matching link instead of just
 * printing red text.
 */
export class ChatActionable extends Error {
  constructor(message: string, public action: 'upgrade' | 'integrations') {
    super(message);
    this.name = 'ChatActionable';
  }
}

export async function sendChat(args: {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  conversationId?: string | null;
  images?: ChatAttachment[];
}): Promise<{
  reply: string; draft: ChatDraft | null; created: ChatCreated[]; conversation_id: string;
  engine: ChatEngine | null; notice: string | null;
}> {
  const images = (args.images ?? []).map(({ media_type, data }) => ({ media_type, data }));
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: args.message,
      history: args.history,
      conversation_id: args.conversationId ?? null,
      images,
    }),
  });
  const j = await res.json();
  if (!res.ok) {
    const msg = j.error ?? 'Assistant failed';
    if (j.upgrade) throw new ChatActionable(msg, 'upgrade');
    if (j.integrations) throw new ChatActionable(msg, 'integrations');
    throw new Error(msg);
  }
  return {
    reply: j.reply,
    draft: j.draft ?? null,
    created: normalizeCreated(j.created ?? j.draft),
    conversation_id: j.conversation_id,
    engine: (j.engine ?? null) as ChatEngine | null,
    notice: (j.notice ?? null) as string | null,
  };
}

const ALLOWED: ChatAttachment['media_type'][] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export async function compressImage(file: File): Promise<ChatAttachment> {
  if (!file.type.startsWith('image/')) throw new Error('Please attach an image file');
  const bitmap = await createImageBitmap(file);
  const max = 1568;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read that image');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image'))), 'image/jpeg', 0.82);
  });
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const data = btoa(binary);
  return { media_type: 'image/jpeg', data, preview: `data:image/jpeg;base64,${data}` };
}

export function isAllowedImage(file: File) {
  return ALLOWED.includes(file.type as ChatAttachment['media_type']) || file.type.startsWith('image/');
}

type Recog = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onspeechend: (() => void) | null;
  onspeechstart: (() => void) | null;
};

function getSpeechRecognition(): (new () => Recog) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function dictationSupported() {
  return !!getSpeechRecognition();
}

function joinSpeech(...parts: string[]) {
  return parts.filter((s) => s.trim()).join(' ').replace(/\s+/g, ' ').trim();
}

/** Speak, pause or walk away — the transcript lands in the composer, it does not send. */
export function useDictation(onCommit: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [draft, setDraft] = useState('');
  const recRef = useRef<Recog | null>(null);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const skipCommitRef = useRef(false);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);

  const stop = useCallback((opts?: { commit?: boolean }) => {
    skipCommitRef.current = opts?.commit === false;
    if (silenceRef.current) clearTimeout(silenceRef.current);
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return false;
    skipCommitRef.current = false;
    recRef.current?.abort();
    finalRef.current = '';
    interimRef.current = '';
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-IN';
    rec.onresult = (e) => {
      let nextInterim = '';
      let nextFinal = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) nextFinal += t;
        else nextInterim += t;
      }
      if (nextFinal) finalRef.current = joinSpeech(finalRef.current, nextFinal);
      interimRef.current = nextInterim;
      setInterim(nextInterim);
      setDraft(joinSpeech(finalRef.current, nextInterim));
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => rec.stop(), 1400);
    };
    rec.onspeechstart = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
    };
    rec.onspeechend = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => rec.stop(), 1400);
    };
    rec.onerror = (ev) => {
      if (ev.error === 'aborted' || ev.error === 'no-speech') return;
      rec.stop();
    };
    rec.onend = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      const text = joinSpeech(finalRef.current, interimRef.current);
      const skip = skipCommitRef.current;
      skipCommitRef.current = false;
      finalRef.current = '';
      interimRef.current = '';
      setInterim('');
      setDraft('');
      setListening(false);
      recRef.current = null;
      if (text && !skip) onCommitRef.current(text);
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
    setInterim('');
    setDraft('');
    return true;
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else if (!start()) return false;
    return true;
  }, [listening, start, stop]);

  useEffect(() => () => {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    skipCommitRef.current = true;
    recRef.current?.abort();
  }, []);

  return { listening, interim, draft, toggle, stop, supported: dictationSupported() };
}
