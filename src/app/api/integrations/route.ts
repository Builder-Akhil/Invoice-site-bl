import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { encryptSecret, encryptionReady, maskSecret } from '@/lib/crypto';
import { DEFAULT_MODELS, PROVIDER_META, type ProviderId } from '@/lib/ai/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Integration settings.
 *
 * GET  returns a redacted view — masks and booleans only. A saved secret never
 *      leaves the server, not even to the account that stored it.
 * POST accepts a patch. Secrets arrive in plaintext over TLS, are encrypted
 *      here, and the plaintext is dropped. Sending null clears a key.
 */

type SecretField = 'deepseek_key' | 'claude_key' | 'whatsapp_token' | 'telegram_token';

const SECRETS: SecretField[] = ['deepseek_key', 'claude_key', 'whatsapp_token', 'telegram_token'];

const PLAIN_FIELDS = [
  'ai_primary', 'ai_fallback_enabled',
  'deepseek_model', 'claude_model',
  'whatsapp_enabled', 'whatsapp_phone_number_id', 'whatsapp_verify_token', 'whatsapp_allowed_numbers',
  'telegram_enabled', 'telegram_bot_username', 'telegram_allowed_chats',
] as const;

/** Cheap shape check so a typo in a key does not silently disable the assistant. */
function keyLooksWrong(field: SecretField, value: string): string | null {
  const map: Partial<Record<SecretField, ProviderId>> = { deepseek_key: 'deepseek', claude_key: 'claude' };
  const provider = map[field];
  if (provider) {
    const { keyPrefix, label } = PROVIDER_META[provider];
    if (!value.startsWith(keyPrefix)) return `A ${label} key normally starts with "${keyPrefix}".`;
    if (value.length < 20) return `That ${label} key looks too short.`;
    return null;
  }
  if (field === 'telegram_token' && !/^\d+:[\w-]{30,}$/.test(value)) {
    return 'A Telegram bot token looks like 123456789:AA… — copy the whole line from BotFather.';
  }
  if (field === 'whatsapp_token' && value.length < 30) {
    return 'That WhatsApp access token looks too short.';
  }
  return null;
}

export async function GET() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // RLS denies this table to the browser, so the read runs as the service role
  // *after* the session check above. Only masks make it into the response.
  const { data, error } = await createAdminSupabase()
    .from('integration_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = (data ?? {}) as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  for (const f of PLAIN_FIELDS) redacted[f] = row[f] ?? null;
  for (const s of SECRETS) {
    redacted[`${s}_mask`] = row[`${s}_mask`] ?? null;
    redacted[`${s}_set`] = Boolean(row[`${s}_enc`]);
  }

  return NextResponse.json({
    settings: redacted,
    /** What the platform provides for free, so the UI can say "included". */
    platform: {
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      claude: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    defaultModels: DEFAULT_MODELS,
    /** False means BYO keys cannot be stored yet — APP_ENCRYPTION_KEY is missing. */
    encryptionReady: encryptionReady(),
  });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });

  const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };

  for (const f of PLAIN_FIELDS) {
    if (f in body) patch[f] = body[f];
  }

  // Channel messages have no session, so they need an owner for their chat
  // history. Whoever switches a channel on becomes that owner.
  if (body.whatsapp_enabled === true || body.telegram_enabled === true) {
    patch.channel_owner_user_id = user.id;
  }

  for (const s of SECRETS) {
    if (!(s in body)) continue;
    const raw = body[s];

    if (raw === null || raw === '') {
      patch[`${s}_enc`] = null;
      patch[`${s}_mask`] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      return NextResponse.json({ error: `${s} must be a string` }, { status: 400 });
    }
    const value = raw.trim();
    // The browser echoes the mask back for untouched fields — ignore those.
    if (value.includes('…')) continue;

    const complaint = keyLooksWrong(s, value);
    if (complaint) return NextResponse.json({ error: complaint }, { status: 400 });

    if (!encryptionReady()) {
      return NextResponse.json({
        error: 'APP_ENCRYPTION_KEY is not set, so keys cannot be stored safely. '
          + 'Generate one with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` '
          + 'and add it to .env.local and Vercel.',
      }, { status: 400 });
    }
    patch[`${s}_enc`] = encryptSecret(value);
    patch[`${s}_mask`] = maskSecret(value);
  }

  const { error } = await createAdminSupabase().from('integration_settings').upsert(patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
