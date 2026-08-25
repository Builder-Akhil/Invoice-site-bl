import type { SupabaseClient } from '@supabase/supabase-js';
import type { Invoice } from './types';

/** Flip an invoice to Paid or Unpaid. Used from the invoices list and the assistant. */
export async function setInvoicePaidStatus(
  supabase: SupabaseClient,
  invoice: Pick<Invoice, 'id' | 'doc_type' | 'status' | 'total' | 'amount_paid' | 'client_id' | 'currency' | 'exchange_rate' | 'sent_at' | 'invoice_number'>,
  paid: boolean,
  actor?: string | null,
) {
  if (invoice.doc_type !== 'invoice') throw new Error('Quotes do not take payments');
  if (invoice.status === 'cancelled') throw new Error('Cancelled invoices cannot be marked paid or unpaid');

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const total = Number(invoice.total) || 0;

  if (paid) {
    if (invoice.status === 'draft') {
      const { error } = await supabase.from('invoices').update({
        status: 'sent', sent_at: invoice.sent_at ?? now, updated_at: now,
      }).eq('id', invoice.id);
      if (error) throw error;
    }
    const remaining = Math.round((total - Number(invoice.amount_paid || 0)) * 100) / 100;
    if (remaining > 0.5) {
      const { error } = await supabase.from('payments').insert({
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        payment_date: today,
        amount: remaining,
        currency: invoice.currency ?? 'INR',
        exchange_rate: Number(invoice.exchange_rate) || 1,
        mode: 'other',
        notes: 'Marked paid manually',
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('invoices').update({
        status: 'paid', amount_paid: total, balance_due: 0, paid_at: now, updated_at: now,
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
