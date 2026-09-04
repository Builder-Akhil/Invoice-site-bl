import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { resolveProviders } from '@/lib/ai/resolve';
import { PRODUCT } from '@/lib/product';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Test connection" — a real round trip, not a regex on the key.
 *
 * Cheapest possible probe: no tools, tiny prompt, tiny max_tokens. A saved key
 * that has run out of credit fails here, which is exactly what the user wants
 * to find out before their first invoice depends on it.
 */
export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { target } = await req.json().catch(() => ({ target: null })) as { target?: 'deepseek' | 'claude' | null };

  const { chain, problem } = await resolveProviders(createAdminSupabase());
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const provider = target ? chain.find((p) => p.id === target) : chain[0];
  if (!provider) {
    return NextResponse.json({ error: `No key is configured for ${target ?? 'any provider'}.` }, { status: 400 });
  }

  const started = Date.now();
  try {
    const turn = await provider.complete({
      system: `You are a connection test for ${PRODUCT.name}. Reply with the single word OK.`,
      messages: [{ role: 'user', text: 'Reply with the single word OK.' }],
      tools: [],
      maxTokens: 8,
    });
    return NextResponse.json({
      ok: true,
      provider: provider.id,
      label: provider.label,
      model: provider.model,
      key: provider.keySource,
      ms: Date.now() - started,
      sample: turn.text.slice(0, 40),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      provider: provider.id,
      label: provider.label,
      model: provider.model,
      error: e instanceof Error ? e.message : 'Request failed',
    }, { status: 502 });
  }
}
