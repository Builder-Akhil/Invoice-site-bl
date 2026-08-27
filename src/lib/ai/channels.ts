import { createAdminSupabase } from '../supabase/server';
import { decryptSecret } from '../crypto';
import { assistantAllowed, invoicesLeftThisMonth } from '../plan';
import { AssistantUnavailable, runAssistant } from './assistant';

/**
 * Shared plumbing for the WhatsApp and Telegram webhooks.
 *
 * Webhooks arrive unauthenticated from the public internet, so every one of
 * these steps matters:
 *   1. the channel must be switched on
 *   2. the sender must be on the allow-list — an empty list allows nobody
 *   3. an owner must exist, so the conversation has somewhere to live
 *
 * Failing any of them returns 200 with no action. Telegram and Meta both retry
 * non-2xx responses, and retrying a message from a stranger is pointless.
 */

export type ChannelKind = 'whatsapp' | 'telegram';

export type ChannelConfig = {
  enabled: boolean;
  token: string | null;
  allowed: string[];
  ownerUserId: string | null;
  verifyToken: string | null;
  phoneNumberId: string | null;
};

export async function loadChannel(kind: ChannelKind): Promise<ChannelConfig> {
  const { data } = await createAdminSupabase()
    .from('integration_settings')
    .select('whatsapp_enabled, whatsapp_token_enc, whatsapp_allowed_numbers, whatsapp_verify_token, whatsapp_phone_number_id, telegram_enabled, telegram_token_enc, telegram_allowed_chats, channel_owner_user_id')
    .eq('id', 1)
    .maybeSingle();

  const row = (data ?? {}) as Record<string, unknown>;
  const encrypted = (kind === 'whatsapp' ? row.whatsapp_token_enc : row.telegram_token_enc) as string | null;

  let token: string | null = null;
  if (encrypted) {
    try { token = decryptSecret(encrypted); } catch { token = null; }
  }

  return {
    enabled: Boolean(kind === 'whatsapp' ? row.whatsapp_enabled : row.telegram_enabled),
    token,
    allowed: ((kind === 'whatsapp' ? row.whatsapp_allowed_numbers : row.telegram_allowed_chats) as string[] | null) ?? [],
    ownerUserId: (row.channel_owner_user_id as string | null) ?? null,
    verifyToken: (row.whatsapp_verify_token as string | null) ?? null,
    phoneNumberId: (row.whatsapp_phone_number_id as string | null) ?? null,
  };
}

/** Digits only, so "+91 98123 45678" and "919812345678" are the same sender. */
const normalise = (v: string) => v.replace(/\D/g, '');

export function senderAllowed(cfg: ChannelConfig, sender: string): boolean {
  if (cfg.allowed.length === 0) return false;
  const s = normalise(sender);
  return cfg.allowed.some((a) => normalise(a) === s);
}

/**
 * Run one channel message through the assistant and return the text to send
 * back. Never throws — a webhook that 500s gets retried, and a retried invoice
 * request is how you end up billing a client twice.
 */
export async function answerChannelMessage(opts: {
  kind: ChannelKind;
  cfg: ChannelConfig;
  text: string;
  images?: { media_type: string; data: string }[];
}): Promise<string> {
  const { kind, cfg, text } = opts;
  if (!cfg.ownerUserId) {
    return 'This workspace has no owner assigned for channel messages. Open Integrations in the dashboard and re-save.';
  }

  const supabase = createAdminSupabase();

  try {
    const allowance = await invoicesLeftThisMonth(supabase);
    if (!assistantAllowed(allowance.plan)) {
      return 'The assistant is a Pro feature. Upgrade in the dashboard, or add your own DeepSeek or Claude key under Integrations.';
    }

    const result = await runAssistant({
      supabase,
      userId: cfg.ownerUserId,
      message: text,
      images: opts.images,
      allowance,
      channelLabel: kind === 'whatsapp' ? 'WhatsApp' : 'Telegram',
    });

    const created = result.created.length
      ? `\n\n${result.created.map((c) => `• ${c.title}`).join('\n')}`
      : '';
    return `${result.reply}${created}`.slice(0, 3500);
  } catch (e) {
    if (e instanceof AssistantUnavailable) return e.message;
    return `Could not do that: ${e instanceof Error ? e.message : 'unknown error'}`;
  }
}

/* ----------------------------------------------------------- outbound send */

export async function sendTelegram(token: string, chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  }).catch(() => { /* the record is already saved; a failed reply is not worth a retry storm */ });
}

export async function sendWhatsApp(token: string, phoneNumberId: string, to: string, text: string) {
  await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  }).catch(() => { /* same reasoning as Telegram */ });
}
