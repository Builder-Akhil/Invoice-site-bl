'use client';
import { Suspense } from 'react';
import DocumentList from '@/components/DocumentList';
import { Loading } from '@/components/ui';

export default function InvoicesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentList docType="invoice" />
    </Suspense>
  );
}
