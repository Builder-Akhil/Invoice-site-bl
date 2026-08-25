'use client';
import InvoiceEditor from '@/components/InvoiceEditor';

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  return <InvoiceEditor docType="invoice" invoiceId={params.id} />;
}
