import { notFound } from 'next/navigation';
import { createAdminSupabase } from '@/lib/supabase/server';
import type { Client, CompanyProfile, Invoice, InvoiceLine } from '@/lib/types';
import PublicInvoiceView from './view';

export const dynamic = 'force-dynamic';

export default async function PublicInvoicePage({ params }: { params: { token: string } }) {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from('invoices').select('*, invoice_items(*), clients(*)')
    .eq('public_token', params.token).single();
  if (!data) notFound();

  const invoice = data as unknown as Invoice;
  const { data: profile } = await admin.from('company_profile').select('*').eq('id', 1).single();

  if (!invoice.viewed_at && invoice.status !== 'draft') {
    await admin.from('invoices').update({
      viewed_at: new Date().toISOString(),
      status: invoice.status === 'sent' ? 'viewed' : invoice.status,
    }).eq('id', invoice.id);
  }

  const lines = ((invoice.invoice_items ?? []) as InvoiceLine[]).sort((a, b) => a.position - b.position);

  return (
    <PublicInvoiceView
      invoice={invoice}
      lines={lines}
      client={(invoice.clients ?? invoice.client_snapshot ?? null) as Partial<Client> | null}
      profile={(profile ?? null) as CompanyProfile | null}
      token={params.token}
    />
  );
}
