import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { AssistantUnavailable, runAssistant } from '@/lib/ai/assistant';
import { assistantAllowed, invoicesLeftThisMonth } from '@/lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const allowance = await invoicesLeftThisMonth(supabase);
    if (!assistantAllowed(allowance.plan)) {
      return NextResponse.json({
        error: 'The assistant is a Pro feature. Upgrade, or add your own DeepSeek / Claude key on the Integrations page.',
        upgrade: true,
      }, { status: 402 });
    }

    const body = await req.json() as {
      message?: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
      conversation_id?: string | null;
      images?: { media_type?: string; data?: string }[];
    };

    const message = String(body.message ?? '').trim();
    const images = (body.images ?? [])
      .filter((i): i is { media_type: typeof ALLOWED_IMAGE_TYPES[number]; data: string } =>
        !!i?.data && ALLOWED_IMAGE_TYPES.includes((i.media_type as typeof ALLOWED_IMAGE_TYPES[number]) ?? 'image/jpeg'))
      .slice(0, 4)
      .map((i) => ({
        media_type: ALLOWED_IMAGE_TYPES.includes(i.media_type) ? i.media_type : 'image/jpeg' as const,
        data: i.data,
      }));

    if (!message && images.length === 0) {
      return NextResponse.json({ error: 'Say something, or attach an image.' }, { status: 400 });
    }

    // The assistant reads integration_settings (service-role only) and writes
    // conversation rows on the user's behalf, so it runs as the service role —
    // scoped to this user's id, which it received after the session check above.
    const result = await runAssistant({
      supabase: createAdminSupabase(),
      userId: user.id,
      userEmail: user.email,
      message,
      images,
      conversationId: body.conversation_id ?? null,
      history: body.history,
      allowance,
    });

    return NextResponse.json({
      reply: result.reply,
      draft: result.created.find((c) => c.kind === 'invoice') ?? result.draft,
      created: result.created,
      conversation_id: result.conversationId,
      engine: result.engine,
      notice: result.notice,
      allowance: {
        plan: allowance.plan, used: allowance.used, limit: allowance.limit, left: allowance.left,
      },
    });
  } catch (e) {
    if (e instanceof AssistantUnavailable) {
      return NextResponse.json({ error: e.message, integrations: true }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Assistant failed' }, { status: 500 });
  }
}
