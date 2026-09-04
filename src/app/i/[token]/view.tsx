'use client';
import { Download, Printer } from 'lucide-react';
import InvoicePaper from '@/components/InvoicePaper';
import { LogoMark } from '@/components/Logo';
import type { Client, CompanyProfile, Invoice, InvoiceLine } from '@/lib/types';
import { money } from '@/lib/format';

export default function PublicInvoiceView({ invoice, lines, client, profile, token }: {
  invoice: Invoice; lines: InvoiceLine[]; client: Partial<Client> | null;
  profile: CompanyProfile | null; token: string;
}) {
  const isQuote = invoice.doc_type === 'quote';
  const balance = Number(invoice.balance_due);
  const paid = balance <= 0.5 && !isQuote;

  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-line bg-ink-800/70 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <LogoMark size={26} />
            <div className="leading-tight">
              <p className="text-[13.5px] font-bold text-white">{profile?.trade_name ?? profile?.legal_name ?? ''}</p>
              <p className="label-mono mt-0.5 text-[9px]">{isQuote ? 'QUOTATION' : 'TAX INVOICE'} · {invoice.invoice_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isQuote && (
              <span className={`pill ${paid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                {paid ? 'Paid in full' : `${money(balance, invoice.currency)} due`}
              </span>
            )}
            <button className="btn-ghost btn-sm" onClick={() => window.print()}><Printer size={14} /> Print</button>
            <a className="btn-primary btn-sm" href={`/api/invoices/${invoice.id}/pdf?token=${token}`} target="_blank" rel="noreferrer">
              <Download size={14} /> PDF
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-3 py-8 sm:px-5">
        <div className="print-full rounded-xl border border-line bg-ink-800/40 p-3 sm:p-6">
          <InvoicePaper invoice={invoice} lines={lines} client={client} profile={profile} />
        </div>
        <p className="no-print mt-6 text-center text-[11px] text-chrome-dark">
          Questions about this {isQuote ? 'quote' : 'invoice'}? Reply to {profile?.email ?? 'akhil@buildablelabs.com'}.
        </p>
      </main>
    </div>
  );
}
