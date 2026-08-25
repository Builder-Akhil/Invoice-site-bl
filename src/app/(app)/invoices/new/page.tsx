'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import InvoiceEditor from '@/components/InvoiceEditor';
import { Loading } from '@/components/ui';

function Inner() {
  const p = useSearchParams();
  const type = p.get('type') === 'quote' ? 'quote' : 'invoice';
  return <InvoiceEditor docType={type} presetClientId={p.get('client')} />;
}
export default function NewInvoicePage() {
  return <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
