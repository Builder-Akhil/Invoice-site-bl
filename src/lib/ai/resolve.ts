import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret } from '../crypto';
import {
  claudeProvider, deepseekProvider, DEFAULT_MODELS, PROVIDER_META,
  type AiProvider, type ProviderId,
} from './provider';

/** Server-only. Never import this from a client component. */

export type IntegrationRow = {
  ai_primary: string | null;
  ai_fallback_enabled: boolean | null;
  deepseek_key_enc: string | null;
  deepseek_key_mask: string | null;
  deepseek_model: string | null;
  claude_key_enc: string | null;
  claude_key_mask: string | null;
  claude_model: string | null;
};

const envKey = (id: ProviderId) =>
  (id === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.ANTHROPIC_API_KEY)?.trim() || null;

const envModel = (id: ProviderId) =>
  (id === 'deepseek' ? process.env.DEEPSEEK_MODEL : process.env.ANTHROPIC_MODEL)?.trim() || null;

function byoKey(row: IntegrationRow | null, id: ProviderId): string | null {
  const blob = id === 'deepseek' ? row?.deepseek_key_enc : row?.claude_key_enc;
  if (!blob) return null;
  try {
    return decryptSecret(blob).trim() || null;
  } catch {
    // A rotated or missing APP_ENCRYPTION_KEY must not take the assistant down —
    // fall through to the platform key and let the UI report the stale secret.
    return null;
  }
}

function build(row: IntegrationRow | null, id: ProviderId): AiProvider | null {
  const byo = byoKey(row, id);
  const key = byo ?? envKey(id);
  if (!key) return null;
  const source = byo ? 'byo' : 'platform';
  const model = (id === 'deepseek' ? row?.deepseek_model : row?.claude_model)?.trim()
    || envModel(id)
    || DEFAULT_MODELS[id];
  return id === 'deepseek'
    ? deepseekProvider(key, source, model)
    : claudeProvider(key, source, model);
}

export type ProviderChain = {
  /** Tried in order. Empty means nothing is configured. */
  chain: AiProvider[];
  /** Why the chain is empty, or null when it is usable. */
  problem: string | null;
};

/**
 * Order of preference:
 *   1. attached images force a vision-capable provider (Claude only today)
 *   2. otherwise the configured primary, then the other one as fallback
 *
 * A bring-your-own key always beats the platform key for the same provider.
 */
export async function resolveProviders(
  supabase: SupabaseClient,
  opts: { needsVision?: boolean } = {},
): Promise<ProviderChain> {
  const { data } = await supabase
    .from('integration_settings')
    .select('ai_primary, ai_fallback_enabled, deepseek_key_enc, deepseek_key_mask, deepseek_model, claude_key_enc, claude_key_mask, claude_model')
    .eq('id', 1)
    .maybeSingle();
  const row = (data ?? null) as IntegrationRow | null;

  const primary: ProviderId = row?.ai_primary === 'claude' ? 'claude' : 'deepseek';
  const secondary: ProviderId = primary === 'deepseek' ? 'claude' : 'deepseek';
  const fallbackOn = row?.ai_fallback_enabled !== false;

  const built = new Map<ProviderId, AiProvider | null>([
    ['deepseek', build(row, 'deepseek')],
    ['claude', build(row, 'claude')],
  ]);

  let order: ProviderId[] = fallbackOn ? [primary, secondary] : [primary];
  if (opts.needsVision) {
    // Put every vision-capable provider first rather than dropping the rest —
    // a text-only model still answers "what do I owe" if Claude is unavailable.
    order = [...order].sort((a, b) => Number(built.get(b)?.vision ?? false) - Number(built.get(a)?.vision ?? false));
  }

  const chain = order.map((id) => built.get(id)).filter((p): p is AiProvider => !!p);

  if (chain.length === 0) {
    const names = [PROVIDER_META.deepseek.label, PROVIDER_META.claude.label].join(' or ');
    return {
      chain,
      problem: `No AI key is configured. Add a ${names} key on the Integrations page, `
        + 'or set DEEPSEEK_API_KEY / ANTHROPIC_API_KEY in the environment.',
    };
  }
  if (opts.needsVision && !chain.some((p) => p.vision)) {
    return {
      chain,
      problem: 'Reading receipt images needs a Claude key — DeepSeek is text-only. '
        + 'Add one on the Integrations page, or type the amount and vendor instead.',
    };
  }
  return { chain, problem: null };
}
