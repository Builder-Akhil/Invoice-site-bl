import { NextRequest, NextResponse } from 'next/server';
import { answerChannelMessage, loadChannel, senderAllowed, sendTelegram } from '@/lib/ai/channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    text?: string;
    caption?: string;
  };
};

/**
 * Telegram Bot API webhook.
 *
 * Register once after saving the bot token:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-app/api/channels/telegram"
 *
 * Always answers 200. Telegram retries anything else, and a retried "invoice
 * Acme 2 lakh" would bill the client twice.
 */
export async function POST(req: NextRequest) {
  const ok = () => NextResponse.json({ ok: true });

  try {
    const update = await req.json().catch(() => null) as TelegramUpdate | null;
    const chatId = update?.message?.chat?.id;
    const text = (update?.message?.text ?? update?.message?.caption ?? '').trim();
    if (chatId == null || !text) return ok();

    const cfg = await loadChannel('telegram');
    if (!cfg.enabled || !cfg.token) return ok();

    if (!senderAllowed(cfg, String(chatId))) {
      // Tell them why rather than going silent — the usual cause is the owner
      // not having pasted their own chat id yet, and silence looks like a bug.
      await sendTelegram(cfg.token, chatId,
        `This bot is locked to approved chats. Add ${chatId} to the allowed chat IDs under Integrations in the dashboard.`);
      return ok();
    }

    const reply = await answerChannelMessage({ kind: 'telegram', cfg, text });
    await sendTelegram(cfg.token, chatId, reply);
    return ok();
  } catch {
    return ok();
  }
}
