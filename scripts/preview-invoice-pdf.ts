/**
 * Render a dummy invoice PDF and check that ₹ is a real glyph, not Helvetica's ghost "1".
 * Usage: npx tsx scripts/preview-invoice-pdf.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import InvoicePdfDoc from '../src/lib/pdf/InvoicePdfDoc';
import type { Invoice, InvoiceLine } from '../src/lib/types';

const invoice = {
  id: 'test',
  doc_type: 'invoice',
  invoice_number: 'INV-C13-04',
  client_id: null,
  client_snapshot: null,
  invoice_date: '2026-08-01',
  due_date: '2026-08-08',
  terms_label: 'Net 7',
  subject: 'Font check',
  place_of_supply: 'Telangana',
  place_of_supply_code: '36',
  tax_mode: 'intra',
  reverse_charge: false,
  lut_number: null,
  currency: 'INR',
  exchange_rate: 1,
  status: 'sent',
  subtotal: 170000,
  discount_total: 0,
  cgst_total: 15300,
  sgst_total: 15300,
  igst_total: 0,
  cess_total: 0,
  tax_total: 30600,
  round_off: 0,
  total: 200600,
  amount_paid: 0,
  balance_due: 200600,
  tds_applicable: false,
  tds_section: null,
  tds_rate: null,
  tds_amount: 0,
  notes: null,
  terms: null,
  internal_notes: null,
  po_number: null,
  public_token: null,
  sent_at: null,
  viewed_at: null,
  paid_at: null,
  recurring_id: null,
  converted_from: null,
  created_at: '',
  updated_at: '',
} as Invoice;

const lines: InvoiceLine[] = [{
  position: 0, name: 'Advisory', description: null, code_type: 'SAC', code: '998314',
  unit: 'month', quantity: 1, rate: 170000, discount_pct: 0, taxable_value: 170000,
  gst_rate: 18, cgst_amount: 15300, sgst_amount: 15300, igst_amount: 0, cess_rate: 0, cess_amount: 0, line_total: 200600,
}];

async function main() {
  const buf = await renderToBuffer(
    React.createElement(InvoicePdfDoc, {
      invoice,
      lines,
      client: { company_name: 'Test Client', gstin: '36AAAAA0000A1Z5' },
      profile: { legal_name: 'BuildableLabs LLP', gstin: '36ABHFB0187F1ZL', trade_name: 'Buildable Labs' },
    }) as React.ReactElement,
  );
  const out = join('/tmp', 'invoice-font-check.pdf');
  writeFileSync(out, buf);
  const text = buf.toString('latin1');
  const hasManrope = text.includes('Manrope');
  const hasHelvetica = /Helvetica/.test(text);
  console.log(JSON.stringify({ bytes: buf.length, file: out, hasManrope, hasHelvetica }, null, 2));
  if (!hasManrope) throw new Error('Manrope was not embedded');
  if (hasHelvetica) throw new Error('Helvetica still in the PDF');
}

main().catch((e) => { console.error(e); process.exit(1); });
