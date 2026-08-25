import type { SupabaseClient } from '@supabase/supabase-js';
import type { Invoice, InvoiceStatus, Payment } from './types';
import { invoiceSettlement } from './payments';

/** Where a cancelled document should land when you undo the cancel. */
export function statusAfterUncancel(
  invoice: Pick<Invoice, 'doc_type' | 'amount_paid' | 'total' | 'sent_at' | 'viewed_at'>,
): InvoiceStatus {
  if (invoice.doc_type === 'quote') {
    if (invoice.viewed_at) return 'viewed';
    if (invoice.sent_at) return 'sent';
    return 'draft';
  }
  const paid = Number(invoice.amount_paid);
  const total = Number(invoice.total);
  if (total > 0 && paid >= total - 0.5) return 'paid';
  if (paid > 0.5) return 'partially_paid';
  if (invoice.viewed_at) return 'viewed';
  if (invoice.sent_at) return 'sent';
  return 'draft';
}

export async function uncancelInvoice(
  supabase: SupabaseClient,
  invoice: Pick<Invoice, 'id' | 'status' | 'doc_type' | 'amount_paid' | 'total' | 'sent_at' | 'viewed_at' | 'invoice_number'>,
  actor?: string | null,
) {
  if (invoice.status !== 'cancelled') throw new Error('This document is not cancelled');
  const status = statusAfterUncancel(invoice);
  const now = new Date().toISOString();
  const { error } = await supabase.from('invoices').update({ status, updated_at: now }).eq('id', invoice.id);
  if (error) throw error;
  await supabase.from('activity_log').insert({
    entity: 'invoice', entity_id: invoice.id,
    action: 'uncancelled',
    detail: `${invoice.invoice_number} restored to ${status}`,
    actor: actor ?? null,
  });
  const { data, error: readErr } = await supabase.from('invoices').select('*').eq('id', invoice.id).single();
  if (readErr) throw readErr;
  return data as Invoice;
}

/** Flip an invoice to Unpaid, or (for the assistant) record a settling payment. The UI prompts Record payment instead. */
export async function setInvoicePaidStatus(
  supabase: SupabaseClient,
  invoice: Pick<Invoice, 'id' | 'doc_type' | 'status' | 'total' | 'amount_paid' | 'client_id' | 'currency' | 'exchange_rate' | 'sent_at' | 'invoice_number' | 'tds_amount'>,
  paid: boolean,
  actor?: string | null,
) {
  if (invoice.doc_type !== 'invoice') throw new Error('Quotes do not take payments');
  if (invoice.status === 'cancelled') throw new Error('Cancelled invoices cannot be marked paid or unpaid');

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const total = Number(invoice.total) || 0;

  if (paid) {
    const { data: existing } = await supabase.from('payments').select('amount, tds_deducted, bank_charges').eq('invoice_id', invoice.id);
    const s = invoiceSettlement(invoice, (existing ?? []) as Pick<Payment, 'amount' | 'tds_deducted' | 'bank_charges'>[]);
    if (invoice.status === 'draft') {
      const { error } = await supabase.from('invoices').update({
        status: 'sent', sent_at: invoice.sent_at ?? now, updated_at: now,
      }).eq('id', invoice.id);
      if (error) throw error;
    }
    if (s.remaining > 0.5) {
      const { error } = await supabase.from('payments').insert({
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        payment_date: today,
        amount: s.remainingBank,
        tds_deducted: s.remainingTds,
        currency: invoice.currency ?? 'INR',
        exchange_rate: Number(invoice.exchange_rate) || 1,
        mode: 'other',
        notes: 'Marked paid (assistant)',
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('invoices').update({
        status: 'paid', balance_due: 0, paid_at: now, updated_at: now,
      }).eq('id', invoice.id);
      if (error) throw error;
    }
  } else {
    const { error: delErr } = await supabase.from('payments').delete().eq('invoice_id', invoice.id);
    if (delErr) throw delErr;
    const nextStatus = invoice.status === 'draft' ? 'draft' : 'sent';
    const { error } = await supabase.from('invoices').update({
      amount_paid: 0, balance_due: total, paid_at: null, status: nextStatus, updated_at: now,
    }).eq('id', invoice.id);
    if (error) throw error;
  }

  await supabase.from('activity_log').insert({
    entity: 'invoice', entity_id: invoice.id,
    action: paid ? 'marked_paid' : 'marked_unpaid',
    detail: `${invoice.invoice_number} → ${paid ? 'paid' : 'unpaid'}`,
    actor: actor ?? null,
  });

  const { data, error } = await supabase.from('invoices').select('*').eq('id', invoice.id).single();
  if (error) throw error;
  return data as Invoice;
}
