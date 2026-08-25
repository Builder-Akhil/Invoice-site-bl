import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import { createAdminSupabase } from '../supabase/server';
import type { Client, CompanyProfile, Invoice, InvoiceLine } from '../types';
import { registerPdfFonts } from './fonts';
import InvoicePdfDoc from './InvoicePdfDoc';

export async function loadInvoiceBundle(id: string) {
  const admin = createAdminSupabase();
  const [{ data: inv }, { data: profile }] = await Promise.all([
    admin.from('invoices').select('*, invoice_items(*), clients(*)').eq('id', id).single(),
    admin.from('company_profile').select('*').eq('id', 1).single(),
  ]);
  if (!inv) return null;
  const invoice = inv as unknown as Invoice;
  const lines = ((invoice.invoice_items ?? []) as InvoiceLine[]).sort((a, b) => a.position - b.position);
  const client = (invoice.clients ?? invoice.client_snapshot ?? null) as Partial<Client> | null;
  return { invoice, lines, client, profile: (profile ?? null) as CompanyProfile | null };
}

export async function renderInvoicePdf(id: string) {
  const bundle = await loadInvoiceBundle(id);
  if (!bundle) return null;
  registerPdfFonts();
  const buffer = await renderToBuffer(
    React.createElement(InvoicePdfDoc, {
      invoice: bundle.invoice, lines: bundle.lines, client: bundle.client, profile: bundle.profile,
    }) as React.ReactElement,
  );
  return { ...bundle, buffer };
}
