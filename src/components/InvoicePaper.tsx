'use client';
import type { Client, CompanyProfile, Invoice, InvoiceLine } from '@/lib/types';
import { amountInWords, fmtDate, money, num, qtyFmt } from '@/lib/format';
import { displayLogo } from '@/lib/brand';

export interface PaperProps {
  invoice: Partial<Invoice>;
  lines: InvoiceLine[];
  client: Partial<Client> | null;
  profile: Partial<CompanyProfile> | null;
  className?: string;
}

const BLUE = '#0B3FDE';
const HEAD = '#12235E';

export default function InvoicePaper({ invoice, lines, client, profile, className = '' }: PaperProps) {
  const cur = invoice.currency ?? 'INR';
  const mode = invoice.tax_mode ?? 'inter';
  const isQuote = invoice.doc_type === 'quote';
  const showCgst = mode === 'intra';
  const showIgst = mode === 'inter' || mode === 'export_paid';
  const zeroRated = mode === 'export_lut' || mode === 'exempt';
  const taxCols = showCgst ? 2 : showIgst ? 1 : 0;

  const balance = Number(invoice.balance_due ?? invoice.total ?? 0);
  const paid = Number(invoice.amount_paid ?? 0);

  const addr = [
    client?.bill_attention, client?.bill_line1, client?.bill_line2,
    client?.bill_city, [client?.bill_state, client?.bill_pincode].filter(Boolean).join(' '),
    client?.bill_country,
  ].filter(Boolean);

  const supplierAddr = [
    profile?.address_line1, profile?.address_line2,
    [profile?.city, profile?.pincode].filter(Boolean).join(' '),
    profile?.state, profile?.country,
  ].filter(Boolean);

  const Row = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) => (
    <tr>
      <td style={{ padding: '5px 12px', textAlign: 'right', fontSize: 11.5, color: color ?? '#4A5162', fontWeight: bold ? 700 : 500 }}>{label}</td>
      <td style={{ padding: '5px 0 5px 12px', textAlign: 'right', fontSize: 11.5, fontWeight: bold ? 700 : 600, color: color ?? '#1A1D24', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</td>
    </tr>
  );

  return (
    <div className={`paper mx-auto w-full max-w-[820px] px-9 py-10 shadow-[0_20px_60px_-30px_rgba(0,0,0,.6)] ${className}`}>
      {/* ---------------- header ---------------- */}
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0">
          <h1 style={{ color: BLUE, fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {isQuote ? 'QUOTATION' : 'TAX INVOICE'}
          </h1>
          <p style={{ fontSize: 12, fontWeight: 700, marginTop: 8, color: '#1A1D24' }}>
            {isQuote ? 'Quote#' : 'Invoice#'} {invoice.invoice_number || '—'}
          </p>
          {!isQuote && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#4A5162' }}>Balance Due</p>
              <p style={{ fontSize: 19, fontWeight: 800, marginTop: 3, color: '#1A1D24' }}>{money(balance, cur)}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 text-right">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={displayLogo(profile?.logo_url)} alt="Buildable Labs"
            style={{ height: 62, marginLeft: 'auto', objectFit: 'contain' }} />
          <p style={{ fontSize: 11.5, fontWeight: 800, marginTop: 10, color: '#1A1D24' }}>{profile?.legal_name ?? 'BuildableLabs LLP'}</p>
          {supplierAddr.map((l, i) => <p key={i} style={{ fontSize: 10.5, color: '#4A5162', lineHeight: 1.55 }}>{l}</p>)}
          {profile?.email && <p style={{ fontSize: 10.5, color: '#4A5162', lineHeight: 1.55 }}>{profile.email}</p>}
          {profile?.gstin && <p style={{ fontSize: 10.5, fontWeight: 700, color: '#1A1D24', marginTop: 3 }}>GSTIN: {profile.gstin}</p>}
        </div>
      </div>

      {/* ---------------- meta ---------------- */}
      <div className="mt-9 flex flex-wrap justify-between gap-8">
        <table style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ color: '#4A5162', paddingRight: 44, paddingBottom: 7 }}>{isQuote ? 'Quote Date' : 'Invoice Date'} :</td>
              <td style={{ color: '#1A1D24', fontWeight: 600, paddingBottom: 7 }}>{fmtDate(invoice.invoice_date)}</td>
            </tr>
            <tr>
              <td style={{ color: '#4A5162', paddingBottom: 7 }}>Terms :</td>
              <td style={{ color: '#1A1D24', fontWeight: 600, paddingBottom: 7 }}>{invoice.terms_label || 'Custom'}</td>
            </tr>
            <tr>
              <td style={{ color: '#4A5162' }}>{isQuote ? 'Valid Till' : 'Due Date'} :</td>
              <td style={{ color: '#1A1D24', fontWeight: 600 }}>{fmtDate(invoice.due_date)}</td>
            </tr>
            {invoice.po_number && (
              <tr><td style={{ color: '#4A5162', paddingTop: 7 }}>PO # :</td>
                <td style={{ color: '#1A1D24', fontWeight: 600, paddingTop: 7 }}>{invoice.po_number}</td></tr>
            )}
          </tbody>
        </table>

        <div style={{ maxWidth: 280 }}>
          <p style={{ fontSize: 11, color: '#4A5162', marginBottom: 5 }}>Bill To</p>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: BLUE }}>{client?.company_name ?? '—'}</p>
          {client?.contact_person && <p style={{ fontSize: 10.5, color: '#1A1D24', lineHeight: 1.6 }}>{client.contact_person}</p>}
          {addr.map((l, i) => <p key={i} style={{ fontSize: 10.5, color: '#4A5162', lineHeight: 1.6 }}>{l}</p>)}
          {client?.gstin && <p style={{ fontSize: 10.5, color: '#1A1D24', fontWeight: 600, marginTop: 3 }}>GSTIN {client.gstin}</p>}
          {client?.email && <p style={{ fontSize: 10.5, color: '#4A5162' }}>{client.email}</p>}
        </div>
      </div>

      {invoice.place_of_supply && (
        <p style={{ marginTop: 26, fontSize: 11, color: '#1A1D24' }}>
          Place Of Supply: {invoice.place_of_supply} ({invoice.place_of_supply_code})
        </p>
      )}
      {invoice.subject && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 11, color: '#4A5162' }}>Subject :</p>
          <p style={{ fontSize: 11.5, color: '#1A1D24', marginTop: 4 }}>{invoice.subject}</p>
        </div>
      )}

      {/* ---------------- items ---------------- */}
      <table style={{ width: '100%', marginTop: 22, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: HEAD, color: '#fff' }}>
            <th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'left', width: 26 }}>#</th>
            <th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'left' }}>Item &amp; Description</th>
            <th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'right', width: 62 }}>Qty</th>
            <th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'right', width: 80 }}>Rate</th>
            {showCgst && <><th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'right', width: 74 }}>CGST</th>
              <th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'right', width: 74 }}>SGST</th></>}
            {showIgst && <th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'right', width: 84 }}>IGST</th>}
            <th style={{ padding: '9px 8px', fontSize: 10, fontWeight: 600, textAlign: 'right', width: 92 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #E6E8EE', verticalAlign: 'top' }}>
              <td style={{ padding: '10px 8px', fontSize: 10.5, color: '#4A5162' }}>{i + 1}</td>
              <td style={{ padding: '10px 8px' }}>
                <p style={{ fontSize: 11, color: '#1A1D24', fontWeight: 600 }}>{l.name}</p>
                {l.description && <p style={{ fontSize: 10, color: '#4A5162', marginTop: 2, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{l.description}</p>}
                {l.code && <p style={{ fontSize: 9.5, color: '#7A8296', marginTop: 3 }}>{l.code_type || 'SAC'}: {l.code}</p>}
              </td>
              <td style={{ padding: '10px 8px', fontSize: 10.5, textAlign: 'right', color: '#1A1D24', fontVariantNumeric: 'tabular-nums' }}>
                {qtyFmt(l.quantity)}
                {l.unit && l.unit !== 'qty' && <span style={{ display: 'block', fontSize: 9, color: '#7A8296' }}>{l.unit}</span>}
              </td>
              <td style={{ padding: '10px 8px', fontSize: 10.5, textAlign: 'right', color: '#1A1D24', fontVariantNumeric: 'tabular-nums' }}>
                {num(l.rate)}
                {Number(l.discount_pct) > 0 && <span style={{ display: 'block', fontSize: 9, color: '#7A8296' }}>-{l.discount_pct}%</span>}
              </td>
              {showCgst && <>
                <td style={{ padding: '10px 8px', fontSize: 10.5, textAlign: 'right', color: '#1A1D24', fontVariantNumeric: 'tabular-nums' }}>
                  {num(l.cgst_amount)}<span style={{ display: 'block', fontSize: 9, color: '#7A8296' }}>{l.gst_rate / 2}%</span></td>
                <td style={{ padding: '10px 8px', fontSize: 10.5, textAlign: 'right', color: '#1A1D24', fontVariantNumeric: 'tabular-nums' }}>
                  {num(l.sgst_amount)}<span style={{ display: 'block', fontSize: 9, color: '#7A8296' }}>{l.gst_rate / 2}%</span></td>
              </>}
              {showIgst && (
                <td style={{ padding: '10px 8px', fontSize: 10.5, textAlign: 'right', color: '#1A1D24', fontVariantNumeric: 'tabular-nums' }}>
                  {num(l.igst_amount)}<span style={{ display: 'block', fontSize: 9, color: '#7A8296' }}>{l.gst_rate}%</span></td>
              )}
              <td style={{ padding: '10px 8px', fontSize: 10.5, textAlign: 'right', color: '#1A1D24', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {num(l.taxable_value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------------- totals ---------------- */}
      <div className="mt-5 flex justify-end">
        <table style={{ minWidth: 320 }}>
          <tbody>
            <Row label="Sub Total" value={num(invoice.subtotal ?? 0)} />
            {Number(invoice.discount_total) > 0 && <Row label="Discount" value={`(-) ${num(invoice.discount_total)}`} />}
            {showCgst && <>
              <Row label="CGST" value={num(invoice.cgst_total ?? 0)} />
              <Row label="SGST" value={num(invoice.sgst_total ?? 0)} />
            </>}
            {showIgst && <Row label="IGST" value={num(invoice.igst_total ?? 0)} />}
            {Number(invoice.cess_total) > 0 && <Row label="Cess" value={num(invoice.cess_total)} />}
            {zeroRated && <Row label="GST (zero-rated)" value="0.00" />}
            {Math.abs(Number(invoice.round_off ?? 0)) > 0.001 && <Row label="Round Off" value={num(invoice.round_off)} />}
            <tr><td colSpan={2} style={{ borderTop: '1px solid #D9DDE6', height: 6 }} /></tr>
            <Row label="Total" value={money(invoice.total ?? 0, cur)} bold />
            {paid > 0.004 && <Row label="Payment Made" value={`(-) ${num(paid)}`} color="#C0392B" />}
            {!isQuote && (
              <tr>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11.5, fontWeight: 700, background: '#EFF1F5' }}>Balance Due</td>
                <td style={{ padding: '9px 0 9px 12px', textAlign: 'right', fontSize: 12.5, fontWeight: 800, background: '#EFF1F5', whiteSpace: 'nowrap' }}>{money(balance, cur)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex justify-end">
        <p style={{ fontSize: 11, textAlign: 'right', maxWidth: 340 }}>
          <span style={{ color: '#4A5162' }}>Total In Words: </span>
          <span style={{ fontStyle: 'italic', fontWeight: 700, color: '#1A1D24' }}>{amountInWords(Number(invoice.total ?? 0), cur)}</span>
        </p>
      </div>

      {invoice.tds_applicable && Number(invoice.tds_amount) > 0 && (
        <p style={{ marginTop: 14, fontSize: 10, color: '#7A8296', textAlign: 'right' }}>
          TDS u/s {invoice.tds_section} @ {invoice.tds_rate}% ({money(invoice.tds_amount ?? 0, cur)}) to be deducted by the recipient.
          Net remittance {money(Number(invoice.total ?? 0) - Number(invoice.tds_amount ?? 0), cur)}.
        </p>
      )}

      {zeroRated && (
        <p style={{ marginTop: 18, fontSize: 10.5, fontWeight: 600, color: '#1A1D24' }}>
          Supply meant for export of services without payment of Integrated Tax under Letter of Undertaking
          {invoice.lut_number ? ` (LUT ARN: ${invoice.lut_number})` : ''}.
        </p>
      )}
      {invoice.reverse_charge && (
        <p style={{ marginTop: 8, fontSize: 10.5, fontWeight: 600, color: '#1A1D24' }}>Tax payable on reverse charge basis.</p>
      )}

      {/* ---------------- notes ---------------- */}
      <div style={{ marginTop: 34, display: 'flex', flexWrap: 'wrap', gap: 40, justifyContent: 'space-between' }}>
        <div style={{ maxWidth: 380 }}>
          {(invoice.notes || profile?.bank_account_no) && <p style={{ fontSize: 11, color: '#4A5162', marginBottom: 6 }}>Notes</p>}
          {invoice.notes && <p style={{ fontSize: 10, color: '#1A1D24', lineHeight: 1.65, whiteSpace: 'pre-line' }}>{invoice.notes}</p>}
          {profile?.bank_account_no && (
            <div style={{ marginTop: 12, fontSize: 10, color: '#1A1D24', lineHeight: 1.7 }}>
              <p style={{ fontWeight: 700 }}>BILL TO —</p>
              <p>Account Name: {profile.bank_account_name}</p>
              <p>Account No: {profile.bank_account_no}</p>
              {profile.bank_ifsc && <p>IFSC: {profile.bank_ifsc}</p>}
              {profile.bank_swift && <p>SWIFT CODE: {profile.bank_swift}</p>}
              {profile.bank_name && <p>Bank: {profile.bank_name}</p>}
              {profile.beneficiary_name && <p>Beneficiary : {profile.beneficiary_name}</p>}
              {profile.legal_name && <p>(On Behalf of {profile.legal_name})</p>}
              {profile.upi_id && <p>UPI: {profile.upi_id}</p>}
            </div>
          )}
          {invoice.terms && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 11, color: '#4A5162', marginBottom: 4 }}>Terms &amp; Conditions</p>
              <p style={{ fontSize: 10, color: '#4A5162', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{invoice.terms}</p>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'left' }}>
          {profile?.signature_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={profile.signature_url} alt="" style={{ height: 74, objectFit: 'contain' }} />
            : <div style={{ height: 74 }} />}
          <div style={{ borderTop: '1px solid #C9CEDA', paddingTop: 6, marginTop: 4, minWidth: 190 }}>
            <p style={{ fontSize: 10.5, color: '#1A1D24', fontWeight: 600 }}>{profile?.signatory_name ?? profile?.contact_person}</p>
            <p style={{ fontSize: 10, color: '#7A8296' }}>Authorized Signature</p>
          </div>
        </div>
      </div>

      <p style={{ marginTop: 30, paddingTop: 12, borderTop: '1px solid #E6E8EE', fontSize: 9, color: '#9AA2B3', textAlign: 'center', letterSpacing: '0.06em' }}>
        {(profile?.trade_name ?? 'BUILDABLE LABS').toUpperCase()} · {profile?.website?.replace(/^https?:\/\//, '') ?? 'buildablelabs.com'} · ANYTHING IS BUILDABLE
      </p>
    </div>
  );
}
