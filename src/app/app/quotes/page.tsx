'use client';
import { Suspense } from 'react';
import DocumentList from '@/components/DocumentList';
import { Loading } from '@/components/ui';

export default function QuotesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentList docType="quote" />
    </Suspense>
  );
}
