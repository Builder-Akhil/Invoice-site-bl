import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { renderInvoicePdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      const supabase = createServerSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const result = await renderInvoicePdf(params.id);
    if (!result) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    if (token && token !== result.invoice.public_token)
      return NextResponse.json({ error: 'Invalid link' }, { status: 403 });

    const name = `${result.invoice.invoice_number}.pdf`.replace(/[^\w.-]/g, '_');
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'PDF failed' }, { status: 500 });
  }
}
