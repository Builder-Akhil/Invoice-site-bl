/* Server-side PDF for invoices & quotes. Uses built-in Helvetica so rendering
   never depends on fetching a remote font at request time. */
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { join } from 'node:path';
import type { Client, CompanyProfile, Invoice, InvoiceLine } from '../types';
import { amountInWords, fmtDate, money, num, qtyFmt } from '../format';
import { BRAND_LOGO } from '../brand';

function pdfLogoSrc(url?: string | null) {
  const v = (url ?? '').trim();
  if (/^https?:\/\//i.test(v)) return v;
  const rel = (v || BRAND_LOGO).replace(/^\//, '');
  return join(process.cwd(), 'public', rel);
}

const BLUE = '#0B3FDE';
const HEAD = '#12235E';
const INK = '#1A1D24';
const MUTED = '#4A5162';
const FAINT = '#7A8296';

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 34, fontSize: 9, fontFamily: 'Helvetica', color: INK },
  row: { flexDirection: 'row' },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  h1: { fontSize: 20, color: BLUE, fontFamily: 'Helvetica-Bold' },
  metaLabel: { color: MUTED, fontSize: 8.5 },
  metaValue: { color: INK, fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  small: { fontSize: 8, color: MUTED, lineHeight: 1.5 },
  th: { color: '#fff', fontSize: 7.6, fontFamily: 'Helvetica-Bold', paddingVertical: 6, paddingHorizontal: 5 },
  td: { fontSize: 8, paddingVertical: 7, paddingHorizontal: 5, color: INK },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 3 },
  totalLabel: { width: 120, textAlign: 'right', fontSize: 8.5, color: MUTED, paddingRight: 10 },
  totalValue: { width: 95, textAlign: 'right', fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: INK },
  footer: { position: 'absolute', bottom: 22, left: 34, right: 34, textAlign: 'center',
    fontSize: 7, color: '#9AA2B3', borderTopWidth: 0.5, borderTopColor: '#E6E8EE', paddingTop: 7 },
});

export interface PdfProps {
  invoice: Invoice; lines: InvoiceLine[];
  client: Partial<Client> | null; profile: Partial<CompanyProfile> | null;
}

export function InvoicePdfDoc({ invoice, lines, client, profile }: PdfProps) {
  const cur = invoice.currency ?? 'INR';
  const mode = invoice.tax_mode ?? 'inter';
  const isQuote = invoice.doc_type === 'quote';
  const showCgst = mode === 'intra';
  const showIgst = mode === 'inter' || mode === 'export_paid';
  const zero = mode === 'export_lut' || mode === 'exempt';

  const wItem = showCgst ? '30%' : showIgst ? '38%' : '48%';
  const wTax = showCgst ? '11%' : '13%';

  const supplierAddr = [profile?.address_line1, profile?.address_line2,
    [profile?.city, profile?.pincode].filter(Boolean).join(' '), profile?.state, profile?.country].filter(Boolean) as string[];
  const billAddr = [client?.bill_attention, client?.bill_line1, client?.bill_line2, client?.bill_city,
    [client?.bill_state, client?.bill_pincode].filter(Boolean).join(' '), client?.bill_country].filter(Boolean) as string[];

  const T = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) => (
    <View style={s.totalRow}>
      <Text style={[s.totalLabel, bold ? { fontFamily: 'Helvetica-Bold', color: INK } : {}, color ? { color } : {}]}>{label}</Text>
      <Text style={[s.totalValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );

  return (
    <Document title={`${invoice.invoice_number}`} author={profile?.legal_name ?? 'BuildableLabs LLP'}>
      <Page size="A4" style={s.page}>
        {/* header */}
        <View style={s.between}>
          <View style={{ width: '55%' }}>
            <Text style={s.h1}>{isQuote ? 'QUOTATION' : 'TAX INVOICE'}</Text>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 6 }}>
              {isQuote ? 'Quote#' : 'Invoice#'} {invoice.invoice_number}
            </Text>
            {!isQuote && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 7.5, color: MUTED, fontFamily: 'Helvetica-Bold' }}>Balance Due</Text>
                <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 3 }}>
                  {money(invoice.balance_due ?? invoice.total, cur)}
                </Text>
              </View>
            )}
          </View>
          <View style={{ width: '42%', alignItems: 'flex-end' }}>
            <Image src={pdfLogoSrc(profile?.logo_url)} style={{ height: 44, objectFit: 'contain', marginBottom: 8 }} />
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', textAlign: 'right' }}>{profile?.legal_name}</Text>
            {supplierAddr.map((l, i) => <Text key={i} style={[s.small, { textAlign: 'right' }]}>{l}</Text>)}
            {profile?.email ? <Text style={[s.small, { textAlign: 'right' }]}>{profile.email}</Text> : null}
            {profile?.gstin ? <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 2 }}>GSTIN: {profile.gstin}</Text> : null}
          </View>
        </View>

        {/* meta */}
        <View style={[s.between, { marginTop: 26 }]}>
          <View style={{ width: '48%' }}>
            {[[isQuote ? 'Quote Date' : 'Invoice Date', fmtDate(invoice.invoice_date)],
              ['Terms', invoice.terms_label ?? 'Custom'],
              [isQuote ? 'Valid Till' : 'Due Date', fmtDate(invoice.due_date)],
              ...(invoice.po_number ? [['PO #', invoice.po_number]] : [])].map(([k, v], i) => (
              <View key={i} style={[s.row, { marginBottom: 5 }]}>
                <Text style={[s.metaLabel, { width: 78 }]}>{k} :</Text>
                <Text style={s.metaValue}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={{ width: '46%' }}>
            <Text style={[s.metaLabel, { marginBottom: 4 }]}>Bill To</Text>
            <Text style={{ fontSize: 9.5, color: BLUE, fontFamily: 'Helvetica-Bold' }}>{client?.company_name ?? '-'}</Text>
            {client?.contact_person ? <Text style={[s.small, { color: INK }]}>{client.contact_person}</Text> : null}
            {billAddr.map((l, i) => <Text key={i} style={s.small}>{l}</Text>)}
            {client?.gstin ? <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 2 }}>GSTIN {client.gstin}</Text> : null}
          </View>
        </View>

        {invoice.place_of_supply ? (
          <Text style={{ fontSize: 8.5, marginTop: 18 }}>
            Place Of Supply: {invoice.place_of_supply} ({invoice.place_of_supply_code})
          </Text>
        ) : null}
        {invoice.subject ? (
          <View style={{ marginTop: 12 }}>
            <Text style={s.metaLabel}>Subject :</Text>
            <Text style={{ fontSize: 8.8, marginTop: 3 }}>{invoice.subject}</Text>
          </View>
        ) : null}

        {/* items */}
        <View style={{ marginTop: 16 }}>
          <View style={[s.row, { backgroundColor: HEAD }]}>
            <Text style={[s.th, { width: '5%' }]}>#</Text>
            <Text style={[s.th, { width: wItem }]}>Item &amp; Description</Text>
            <Text style={[s.th, { width: '10%', textAlign: 'right' }]}>Qty</Text>
            <Text style={[s.th, { width: '13%', textAlign: 'right' }]}>Rate</Text>
            {showCgst ? <><Text style={[s.th, { width: wTax, textAlign: 'right' }]}>CGST</Text>
              <Text style={[s.th, { width: wTax, textAlign: 'right' }]}>SGST</Text></> : null}
            {showIgst ? <Text style={[s.th, { width: wTax, textAlign: 'right' }]}>IGST</Text> : null}
            <Text style={[s.th, { width: '16%', textAlign: 'right' }]}>Amount</Text>
          </View>

          {lines.map((l, i) => (
            <View key={i} style={[s.row, { borderBottomWidth: 0.5, borderBottomColor: '#E6E8EE' }]} wrap={false}>
              <Text style={[s.td, { width: '5%', color: MUTED }]}>{i + 1}</Text>
              <View style={[s.td, { width: wItem }]}>
                <Text style={{ fontSize: 8.4, fontFamily: 'Helvetica-Bold' }}>{l.name}</Text>
                {l.description ? <Text style={{ fontSize: 7.6, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>{l.description}</Text> : null}
                {l.code ? <Text style={{ fontSize: 7, color: FAINT, marginTop: 2 }}>{l.code_type || 'SAC'}: {l.code}</Text> : null}
              </View>
              <View style={[s.td, { width: '10%' }]}>
                <Text style={{ fontSize: 8, textAlign: 'right' }}>{qtyFmt(l.quantity)}</Text>
                {l.unit && l.unit !== 'qty' ? <Text style={{ fontSize: 6.8, color: FAINT, textAlign: 'right' }}>{l.unit}</Text> : null}
              </View>
              <View style={[s.td, { width: '13%' }]}>
                <Text style={{ fontSize: 8, textAlign: 'right' }}>{num(l.rate)}</Text>
                {Number(l.discount_pct) > 0 ? <Text style={{ fontSize: 6.8, color: FAINT, textAlign: 'right' }}>-{l.discount_pct}%</Text> : null}
              </View>
              {showCgst ? <>
                <View style={[s.td, { width: wTax }]}>
                  <Text style={{ fontSize: 8, textAlign: 'right' }}>{num(l.cgst_amount)}</Text>
                  <Text style={{ fontSize: 6.8, color: FAINT, textAlign: 'right' }}>{Number(l.gst_rate) / 2}%</Text>
                </View>
                <View style={[s.td, { width: wTax }]}>
                  <Text style={{ fontSize: 8, textAlign: 'right' }}>{num(l.sgst_amount)}</Text>
                  <Text style={{ fontSize: 6.8, color: FAINT, textAlign: 'right' }}>{Number(l.gst_rate) / 2}%</Text>
                </View>
              </> : null}
              {showIgst ? (
                <View style={[s.td, { width: wTax }]}>
                  <Text style={{ fontSize: 8, textAlign: 'right' }}>{num(l.igst_amount)}</Text>
                  <Text style={{ fontSize: 6.8, color: FAINT, textAlign: 'right' }}>{l.gst_rate}%</Text>
                </View>
              ) : null}
              <Text style={[s.td, { width: '16%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{num(l.taxable_value)}</Text>
            </View>
          ))}
        </View>

        {/* totals */}
        <View style={{ marginTop: 12 }}>
          <T label="Sub Total" value={num(invoice.subtotal)} />
          {Number(invoice.discount_total) > 0 ? <T label="Discount" value={`(-) ${num(invoice.discount_total)}`} /> : null}
          {showCgst ? <><T label="CGST" value={num(invoice.cgst_total)} /><T label="SGST" value={num(invoice.sgst_total)} /></> : null}
          {showIgst ? <T label="IGST" value={num(invoice.igst_total)} /> : null}
          {zero ? <T label="GST (zero-rated)" value="0.00" /> : null}
          {Math.abs(Number(invoice.round_off)) > 0.001 ? <T label="Round Off" value={num(invoice.round_off)} /> : null}
          <T label="Total" value={money(invoice.total, cur)} bold />
          {Number(invoice.amount_paid) > 0.004 ? <T label="Payment Made" value={`(-) ${num(invoice.amount_paid)}`} color="#C0392B" /> : null}
          {!isQuote ? (
            <View style={[s.totalRow, { backgroundColor: '#EFF1F5', paddingVertical: 6 }]}>
              <Text style={[s.totalLabel, { fontFamily: 'Helvetica-Bold', color: INK }]}>Balance Due</Text>
              <Text style={[s.totalValue, { fontSize: 10 }]}>{money(invoice.balance_due ?? invoice.total, cur)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={{ marginTop: 12, fontSize: 8.4, textAlign: 'right' }}>
          <Text style={{ color: MUTED }}>Total In Words: </Text>
          <Text style={{ fontFamily: 'Helvetica-BoldOblique' }}>{amountInWords(Number(invoice.total), cur)}</Text>
        </Text>

        {invoice.tds_applicable && Number(invoice.tds_amount) > 0 ? (
          <Text style={{ marginTop: 8, fontSize: 7.4, color: FAINT, textAlign: 'right' }}>
            TDS u/s {invoice.tds_section} @ {invoice.tds_rate}% ({money(invoice.tds_amount, cur)}) to be deducted by the recipient.
            Net remittance {money(Number(invoice.total) - Number(invoice.tds_amount), cur)}.
          </Text>
        ) : null}

        {zero ? (
          <Text style={{ marginTop: 12, fontSize: 8, fontFamily: 'Helvetica-Bold' }}>
            Supply meant for export of services without payment of Integrated Tax under Letter of Undertaking
            {invoice.lut_number ? ` (LUT ARN: ${invoice.lut_number})` : ''}.
          </Text>
        ) : null}
        {invoice.reverse_charge ? (
          <Text style={{ marginTop: 6, fontSize: 8, fontFamily: 'Helvetica-Bold' }}>Tax payable on reverse charge basis.</Text>
        ) : null}

        {/* notes + signature */}
        <View style={[s.between, { marginTop: 24 }]} wrap={false}>
          <View style={{ width: '58%' }}>
            <Text style={[s.metaLabel, { marginBottom: 4 }]}>Notes</Text>
            {invoice.notes ? <Text style={{ fontSize: 7.8, lineHeight: 1.6 }}>{invoice.notes}</Text> : null}
            {profile?.bank_account_no ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 7.8, fontFamily: 'Helvetica-Bold', lineHeight: 1.7 }}>BILL TO -</Text>
                <Text style={{ fontSize: 7.8, lineHeight: 1.7 }}>Account Name: {profile.bank_account_name}</Text>
                <Text style={{ fontSize: 7.8, lineHeight: 1.7 }}>Account No: {profile.bank_account_no}</Text>
                {profile.bank_ifsc ? <Text style={{ fontSize: 7.8, lineHeight: 1.7 }}>IFSC: {profile.bank_ifsc}</Text> : null}
                {profile.bank_swift ? <Text style={{ fontSize: 7.8, lineHeight: 1.7 }}>SWIFT CODE: {profile.bank_swift}</Text> : null}
                {profile.bank_name ? <Text style={{ fontSize: 7.8, lineHeight: 1.7 }}>Bank: {profile.bank_name}</Text> : null}
                {profile.beneficiary_name ? <Text style={{ fontSize: 7.8, lineHeight: 1.7 }}>Beneficiary : {profile.beneficiary_name}</Text> : null}
                {profile.upi_id ? <Text style={{ fontSize: 7.8, lineHeight: 1.7 }}>UPI: {profile.upi_id}</Text> : null}
              </View>
            ) : null}
            {invoice.terms ? (
              <View style={{ marginTop: 10 }}>
                <Text style={[s.metaLabel, { marginBottom: 3 }]}>Terms &amp; Conditions</Text>
                <Text style={{ fontSize: 7.6, color: MUTED, lineHeight: 1.55 }}>{invoice.terms}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ width: '36%', alignItems: 'flex-start' }}>
            {profile?.signature_url ? <Image src={profile.signature_url} style={{ height: 52, objectFit: 'contain' }} /> : <View style={{ height: 52 }} />}
            <View style={{ borderTopWidth: 0.5, borderTopColor: '#C9CEDA', paddingTop: 5, marginTop: 4, width: '100%' }}>
              <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }}>{profile?.signatory_name ?? profile?.contact_person ?? ''}</Text>
              <Text style={{ fontSize: 7.4, color: FAINT }}>Authorized Signature</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {(profile?.trade_name ?? 'BUILDABLE LABS').toUpperCase()} · {(profile?.website ?? 'buildablelabs.com').replace(/^https?:\/\//, '')} · ANYTHING IS BUILDABLE
        </Text>
      </Page>
    </Document>
  );
}

export default InvoicePdfDoc;
