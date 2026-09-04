import { NextRequest, NextResponse } from 'next/server';
import { answerChannelMessage, loadChannel, senderAllowed, sendWhatsApp } from '@/lib/ai/channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type WhatsAppPayload = {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          from?: string;
          type?: string;
          text?: { body?: string };
          image?: { caption?: string };
        }[];
      };
    }[];
  }[];
};

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * GET  — the one-time subscription handshake. Meta sends the verify token you
 *        typed on the Integrations page and expects the challenge echoed back.
 * POST — inbound messages.
 *
 * Text only for now: reading a photographed bill over WhatsApp needs a second
 * authenticated call to the Graph media endpoint, which is not built yet. Image
 * messages get a clear reply instead of silence.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge') ?? '';

  const cfg = await loadChannel('whatsapp');
  if (mode === 'subscribe' && cfg.verifyToken && token === cfg.verifyToken) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('Verification failed', { status: 403 });
}

export async function POST(req: NextRequest) {
  // Meta retries on any non-2xx, and a retried invoice request bills twice.
  const ok = () => NextResponse.json({ ok: true });

  try {
    const payload = await req.json().catch(() => null) as WhatsAppPayload | null;
    const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    if (!from) return ok();

    const cfg = await loadChannel('whatsapp');
    if (!cfg.enabled || !cfg.token || !cfg.phoneNumberId) return ok();
    if (!senderAllowed(cfg, from)) return ok();

    if (msg.type && msg.type !== 'text') {
      await sendWhatsApp(cfg.token, cfg.phoneNumberId, from,
        'I can only read text over WhatsApp right now. Send the amount and vendor as a message, '
        + 'or drop the photo into the dashboard chat where receipts are read automatically.');
      return ok();
    }

    const text = (msg.text?.body ?? msg.image?.caption ?? '').trim();
    if (!text) return ok();

    const reply = await answerChannelMessage({ kind: 'whatsapp', cfg, text });
    await sendWhatsApp(cfg.token, cfg.phoneNumberId, from, reply);
    return ok();
  } catch {
    return ok();
  }
}
