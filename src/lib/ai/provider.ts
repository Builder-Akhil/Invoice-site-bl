import Anthropic from '@anthropic-ai/sdk';

/**
 * One tool-calling shape, two wire protocols.
 *
 * The assistant used to talk to Anthropic directly. It now runs on DeepSeek by
 * default (far cheaper per invoice) and falls back to Claude, so the loop in
 * /api/chat needs a provider-neutral message shape. Everything below is that
 * shape plus one adapter per protocol.
 */

export type AiImage = { media_type: string; data: string };

export type AiToolCall = { id: string; name: string; input: Record<string, unknown> };

export type AiToolResult = { id: string; name: string; content: string; isError?: boolean };

export type AiMessage =
  | { role: 'user'; text: string; images?: AiImage[] }
  | { role: 'assistant'; text: string; toolCalls?: AiToolCall[] }
  | { role: 'tool'; results: AiToolResult[] };

/**
 * The Anthropic tool shape is the canonical one — it is JSON Schema in a thin
 * wrapper, and the DeepSeek adapter re-wraps it rather than us maintaining two
 * parallel definitions of every tool.
 */
export type AiTool = Anthropic.Tool;

export type AiTurn = { text: string; toolCalls: AiToolCall[] };

export type ProviderId = 'deepseek' | 'claude';

export type AiProvider = {
  id: ProviderId;
  label: string;
  model: string;
  /** Whether this provider can read attached receipt images. */
  vision: boolean;
  /** Where the key came from — surfaced in the UI so the user knows who is paying. */
  keySource: 'byo' | 'platform';
  complete(opts: {
    system: string;
    messages: AiMessage[];
    tools: AiTool[];
    /** Push the model to call a tool when it replied with prose but should have acted. */
    forceTool?: boolean;
    maxTokens?: number;
  }): Promise<AiTurn>;
};

export const PROVIDER_META: Record<ProviderId, { label: string; logo: string; site: string; keyPrefix: string; keyHint: string }> = {
  deepseek: {
    label: 'DeepSeek',
    logo: '/logos/deepseek.svg',
    site: 'https://platform.deepseek.com/api_keys',
    keyPrefix: 'sk-',
    keyHint: 'platform.deepseek.com → API keys',
  },
  claude: {
    label: 'Claude',
    logo: '/logos/claude.svg',
    site: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
    keyHint: 'console.anthropic.com → API keys',
  },
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  deepseek: 'deepseek-chat',
  claude: 'claude-sonnet-5',
};

/** A provider refused the request in a way a different provider might survive. */
export class ProviderError extends Error {
  constructor(public provider: ProviderId, message: string, public status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

/* ------------------------------------------------------------------ claude */

const VISION_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type VisionType = typeof VISION_TYPES[number];
const visionType = (t?: string): VisionType =>
  (VISION_TYPES as readonly string[]).includes(t ?? '') ? (t as VisionType) : 'image/jpeg';
const rawImage = (data: string) => data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');

export function claudeProvider(apiKey: string, keySource: 'byo' | 'platform', model = DEFAULT_MODELS.claude): AiProvider {
  const client = new Anthropic({ apiKey });
  return {
    id: 'claude',
    label: PROVIDER_META.claude.label,
    model,
    vision: true,
    keySource,
    async complete({ system, messages, tools, forceTool, maxTokens = 1600 }) {
      const mapped: Anthropic.MessageParam[] = [];
      for (const m of messages) {
        if (m.role === 'user') {
          const imgs = (m.images ?? []).filter((i) => rawImage(i.data).length > 20);
          mapped.push(imgs.length
            ? {
              role: 'user',
              content: [
                ...imgs.map((i) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: visionType(i.media_type), data: rawImage(i.data) },
                })),
                { type: 'text' as const, text: m.text || 'Please look at the attached image and help me with billing.' },
              ],
            }
            : { role: 'user', content: m.text || '.' });
        } else if (m.role === 'assistant') {
          const blocks: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam)[] = [];
          if (m.text) blocks.push({ type: 'text', text: m.text });
          for (const c of m.toolCalls ?? []) {
            blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
          }
          mapped.push({ role: 'assistant', content: blocks.length ? blocks : '.' });
        } else {
          mapped.push({
            role: 'user',
            content: m.results.map((r) => ({
              type: 'tool_result' as const,
              tool_use_id: r.id,
              content: r.content,
              ...(r.isError ? { is_error: true } : {}),
            })),
          });
        }
      }

      let res: Anthropic.Message;
      try {
        res = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          tools,
          messages: mapped,
          ...(forceTool ? { tool_choice: { type: 'any' as const } } : {}),
        });
      } catch (e) {
        const status = (e as { status?: number }).status;
        throw new ProviderError('claude', e instanceof Error ? e.message : 'Claude request failed', status);
      }

      return {
        text: res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim(),
        toolCalls: res.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> })),
      };
    },
  };
}

/* ---------------------------------------------------------------- deepseek */

type OaiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type OaiResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  error?: { message?: string };
};

/**
 * DeepSeek speaks the OpenAI chat-completions dialect, so this adapter is a
 * plain fetch — no extra dependency for a shape we already know.
 *
 * deepseek-chat is text-only. Attached receipts are routed to Claude upstream;
 * any image that reaches here is dropped with a note rather than silently lost.
 */
export function deepseekProvider(
  apiKey: string,
  keySource: 'byo' | 'platform',
  model = DEFAULT_MODELS.deepseek,
  baseUrl = 'https://api.deepseek.com',
): AiProvider {
  return {
    id: 'deepseek',
    label: PROVIDER_META.deepseek.label,
    model,
    vision: false,
    keySource,
    async complete({ system, messages, tools, forceTool, maxTokens = 1600 }) {
      const body: OaiMessage[] = [{ role: 'system', content: system }];
      for (const m of messages) {
        if (m.role === 'user') {
          const note = (m.images?.length ?? 0) > 0
            ? '\n[An image was attached. This model cannot read images — ask the user to re-send with the Claude fallback enabled, or ask for the figures in text.]'
            : '';
          body.push({ role: 'user', content: (m.text || '.') + note });
        } else if (m.role === 'assistant') {
          const calls = m.toolCalls ?? [];
          body.push({
            role: 'assistant',
            content: m.text || null,
            ...(calls.length
              ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
                })),
              }
              : {}),
          });
        } else {
          for (const r of m.results) {
            body.push({ role: 'tool', tool_call_id: r.id, content: r.content });
          }
        }
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: body,
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
            })),
            tool_choice: forceTool ? 'required' : 'auto',
          }),
        });
      } catch (e) {
        throw new ProviderError('deepseek', e instanceof Error ? e.message : 'DeepSeek unreachable');
      }

      const json = await res.json().catch(() => ({} as OaiResponse)) as OaiResponse;
      if (!res.ok) {
        throw new ProviderError('deepseek', json.error?.message ?? `DeepSeek returned ${res.status}`, res.status);
      }

      const msg = json.choices?.[0]?.message;
      return {
        text: (msg?.content ?? '').trim(),
        toolCalls: (msg?.tool_calls ?? []).map((c, i) => {
          let input: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(c.function?.arguments || '{}') as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              input = parsed as Record<string, unknown>;
            }
          } catch { /* a malformed argument blob becomes an empty call the tool will reject clearly */ }
          return { id: c.id || `call_${i}`, name: c.function?.name ?? '', input };
        }).filter((c) => c.name),
      };
    },
  };
}
