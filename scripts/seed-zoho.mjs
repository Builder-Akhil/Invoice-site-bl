/**
 * Import Contacts.csv as clients and Invoice.csv as historical invoices.
 * Idempotent: upserts clients by company_name, skips invoice numbers that already exist.
 *
 *   node --env-file=.env scripts/seed-zoho.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const POS = {
  MH: { name: 'Maharashtra', code: '27' },
  OD: { name: 'Odisha', code: '21' },
  KA: { name: 'Karnataka', code: '29' },
  UP: { name: 'Uttar Pradesh', code: '09' },
  DL: { name: 'Delhi', code: '07' },
  TG: { name: 'Telangana', code: '36' },
  TS: { name: 'Telangana', code: '36' },
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      cell += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (ch === '\n' || (ch === '\r' && src[i + 1] === '\n')) {
      row.push(cell); rows.push(row); row = []; cell = '';
      i += ch === '\r' ? 2 : 1; continue;
    }
    if (ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
    cell += ch; i += 1;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = r[idx] ?? ''; });
    return o;
  });
}

const clean = (v) => {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || s === 'null') return null;
  if (s.startsWith("'")) s = s.slice(1);
  return s || null;
};
const num = (v, d = 0) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : d;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const panFromGstin = (g) => (g && g.length >= 12 ? g.slice(2, 12) : null);

function gstTreatment(raw) {
  const t = String(raw || '').toLowerCase();
  if (t === 'overseas') return 'overseas';
  return 'registered_business';
}

function placeOfSupply(row) {
  if (gstTreatment(row['GST Treatment']) === 'overseas') {
    return { name: 'Outside India', code: '96' };
  }
  const gstin = clean(row['GST Registration Number'] || row['GST Identification Number (GSTIN)']);
  const abbr = clean(row['Place Of Supply']) || (gstin ? null : null);
  if (abbr && POS[abbr]) return POS[abbr];
  if (gstin && gstin.length >= 2) {
    const code = gstin.slice(0, 2);
    const hit = Object.values(POS).find((p) => p.code === code);
    return { name: hit?.name ?? code, code };
  }
  return { name: 'Telangana', code: '36' };
}

function computeLine(qty, rate, discPct, gstRate, mode) {
  const gross = qty * rate;
  const discount = gross * (discPct / 100);
  const taxable = r2(gross - discount);
  const used = mode === 'export_lut' || mode === 'exempt' ? 0 : gstRate;
  let cgst = 0; let sgst = 0; let igst = 0;
  if (mode === 'intra') {
    cgst = r2((taxable * used) / 200);
    sgst = r2((taxable * used) / 200);
  } else if (mode === 'inter' || mode === 'export_paid') {
    igst = r2((taxable * used) / 100);
  }
  return { taxable, cgst, sgst, igst, line_total: r2(taxable + cgst + sgst + igst) };
}

function clientPayload(row) {
  const company = clean(row['Company Name']) || clean(row['Customer Name']);
  const first = clean(row['First Name']);
  const last = clean(row['Last Name']);
  const contact = [first, last].filter(Boolean).join(' ') || null;
  const treatment = gstTreatment(row['GST Treatment']);
  const gstin = clean(row['GST Registration Number']);
  const pos = placeOfSupply(row);
  const shipLine1 = clean(row['Shipping Address']);
  const billLine1 = clean(row['Billing Address']);
  const terms = num(row['Payment Terms'], 7);
  const phone = clean(row.Phone);
  const mobile = clean(row.MobilePhone);
  return {
    company_name: company,
    display_name: clean(row['Display Name']) || company,
    contact_person: contact,
    email: clean(row.EmailID),
    work_phone: phone || mobile,
    mobile,
    website: clean(row.Website),
    gst_treatment: treatment,
    gstin,
    pan: panFromGstin(gstin),
    place_of_supply_state: pos.name,
    place_of_supply_code: pos.code,
    is_overseas: treatment === 'overseas',
    currency: clean(row['Currency Code']) || (treatment === 'overseas' ? 'USD' : 'INR'),
    bill_attention: clean(row['Billing Attention']),
    bill_line1: billLine1,
    bill_line2: clean(row['Billing Street2']),
    bill_city: clean(row['Billing City']),
    bill_state: clean(row['Billing State']),
    bill_pincode: clean(row['Billing Code']),
    bill_country: clean(row['Billing Country']) || (treatment === 'overseas' ? null : 'India'),
    ship_same_as_bill: !shipLine1,
    ship_line1: shipLine1,
    ship_line2: clean(row['Shipping Street2']),
    ship_city: clean(row['Shipping City']),
    ship_state: clean(row['Shipping State']),
    ship_pincode: clean(row['Shipping Code']),
    ship_country: clean(row['Shipping Country']),
    payment_terms_days: terms,
    default_sac: treatment === 'overseas' ? '998314' : '999293',
    default_gst_rate: treatment === 'overseas' ? 0 : 18,
    tds_applicable: treatment !== 'overseas',
    tds_section: treatment === 'overseas' ? null : '194J',
    tds_rate: treatment === 'overseas' ? 0 : 10,
    status: String(row.Status || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active',
    notes: clean(row.Notes),
  };
}

async function seedClients(contacts) {
  const byZoho = new Map();
  for (const row of contacts) {
    const payload = clientPayload(row);
    const zohoId = clean(row['Customer ID']);
    const { data: existing, error: findErr } = await sb
      .from('clients').select('id').eq('company_name', payload.company_name).maybeSingle();
    if (findErr) throw findErr;
    let id;
    if (existing?.id) {
      const { error } = await sb.from('clients').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (error) throw error;
      id = existing.id;
      console.log('  updated client', payload.company_name);
    } else {
      const { data, error } = await sb.from('clients').insert(payload).select('id').single();
      if (error) throw error;
      id = data.id;
      console.log('  inserted client', payload.company_name);
    }
    if (zohoId) byZoho.set(zohoId, id);
    byZoho.set(payload.company_name.toLowerCase(), id);
    const display = (payload.display_name || '').toLowerCase();
    if (display) byZoho.set(display, id);
    const cust = (clean(row['Customer Name']) || '').toLowerCase();
    if (cust) byZoho.set(cust, id);
  }
  return byZoho;
}

function groupInvoices(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = clean(row['Invoice ID']);
    if (!id) continue;
    if (!map.has(id)) map.set(id, { header: row, lines: [] });
    map.get(id).lines.push(row);
  }
  return [...map.values()];
}

async function seedInvoices(groups, clientMap) {
  let inserted = 0; let skipped = 0;
  for (const { header, lines } of groups) {
    const number = clean(header['Invoice Number']);
    if (!number) continue;
    const { data: exists } = await sb.from('invoices').select('id').eq('invoice_number', number).maybeSingle();
    if (exists?.id) { skipped += 1; continue; }

    const zohoClient = clean(header['Customer ID']);
    const custName = (clean(header['Customer Name']) || '').toLowerCase();
    const clientId = (zohoClient && clientMap.get(zohoClient)) || clientMap.get(custName);
    if (!clientId) {
      console.warn('  skip', number, '— no client for', header['Customer Name']);
      continue;
    }
    const { data: client, error: cErr } = await sb.from('clients').select('*').eq('id', clientId).single();
    if (cErr) throw cErr;

    const currency = clean(header['Currency Code']) || client.currency || 'INR';
    const fx = num(header['Exchange Rate'], 1);
    const treatment = client.gst_treatment;
    const posName = treatment === 'overseas'
      ? 'Outside India'
      : (POS[clean(header['Place of Supply']) || '']?.name || client.place_of_supply_state);
    const posCode = treatment === 'overseas'
      ? '96'
      : (POS[clean(header['Place of Supply']) || '']?.code || client.place_of_supply_code);
    const taxMode = treatment === 'overseas' ? 'export_lut' : (posCode === '36' ? 'intra' : 'inter');

    const itemRows = [];
    lines.forEach((row, i) => {
      const name = clean(row['Item Name']) || clean(row['Item Desc']) || 'Service';
      const desc = clean(row['Item Name']) && clean(row['Item Desc']) && clean(row['Item Name']) !== clean(row['Item Desc'])
        ? clean(row['Item Desc']) : null;
      const qty = num(row.Quantity, 1);
      const rate = num(row['Item Price'], 0);
      const disc = num(row['Discount(%)'], 0);
      const gstRate = taxMode === 'export_lut' ? 0 : num(row['Item Tax %'], 18);
      const c = computeLine(qty, rate, disc, gstRate, taxMode);
      itemRows.push({
        position: i,
        name,
        description: desc,
        code_type: 'SAC',
        code: clean(row['HSN/SAC']) || client.default_sac,
        unit: 'qty',
        quantity: qty,
        rate,
        discount_pct: disc,
        taxable_value: c.taxable,
        gst_rate: gstRate,
        cgst_amount: c.cgst,
        sgst_amount: c.sgst,
        igst_amount: c.igst,
        cess_rate: 0,
        cess_amount: 0,
        line_total: c.line_total,
      });
    });

    const adj = r2(num(header.Adjustment, 0));
    if (Math.abs(adj) > 0.001) {
      itemRows.push({
        position: itemRows.length,
        name: clean(header['Adjustment Description']) || 'Adjustment',
        description: null,
        code_type: 'SAC',
        code: null,
        unit: 'qty',
        quantity: 1,
        rate: adj,
        discount_pct: 0,
        taxable_value: adj,
        gst_rate: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        cess_rate: 0,
        cess_amount: 0,
        line_total: adj,
      });
    }

    const subtotal = r2(itemRows.reduce((a, l) => a + l.taxable_value, 0));
    const cgst_total = r2(itemRows.reduce((a, l) => a + l.cgst_amount, 0));
    const sgst_total = r2(itemRows.reduce((a, l) => a + l.sgst_amount, 0));
    const igst_total = r2(itemRows.reduce((a, l) => a + l.igst_amount, 0));
    const tax_total = r2(cgst_total + sgst_total + igst_total);
    const total = r2(subtotal + tax_total);
    const tdsAmount = r2(num(header['TDS Amount'], 0));
    const tdsApplicable = tdsAmount > 0 || (!!client.tds_applicable && taxMode !== 'export_lut');
    const zohoStatus = String(header['Invoice Status'] || 'Draft').toLowerCase();
    const isClosed = zohoStatus === 'closed' || zohoStatus === 'paid';
    const invoiceDate = clean(header['Invoice Date']);
    const dueDate = clean(header['Due Date']);
    const paidOn = clean(header['Last Payment Date']);

    const { data: inv, error: iErr } = await sb.from('invoices').insert({
      doc_type: 'invoice',
      invoice_number: number,
      client_id: client.id,
      client_snapshot: client,
      invoice_date: invoiceDate,
      due_date: dueDate,
      terms_label: clean(header['Payment Terms Label']) || (num(header['Payment Terms'], 0) === 0 ? 'Due on Receipt' : `Net ${header['Payment Terms']}`),
      subject: clean(header.Notes),
      place_of_supply: posName,
      place_of_supply_code: posCode,
      tax_mode: taxMode,
      currency,
      exchange_rate: fx,
      status: isClosed ? 'sent' : 'draft',
      subtotal,
      discount_total: 0,
      cgst_total,
      sgst_total,
      igst_total,
      cess_total: 0,
      tax_total,
      round_off: 0,
      total,
      amount_paid: 0,
      balance_due: total,
      tds_applicable: tdsApplicable && taxMode !== 'export_lut',
      tds_section: tdsApplicable && taxMode !== 'export_lut' ? (client.tds_section || '194J') : null,
      tds_rate: tdsApplicable && taxMode !== 'export_lut' ? num(header['TDS Percentage'] || client.tds_rate, 10) : 0,
      tds_amount: taxMode === 'export_lut' ? 0 : tdsAmount,
      notes: clean(header.Notes),
      terms: clean(header['Terms & Conditions']),
      internal_notes: 'Imported from Zoho Billing',
      created_at: invoiceDate ? `${invoiceDate}T12:00:00.000Z` : undefined,
    }).select('id').single();
    if (iErr) throw iErr;

    const { error: liErr } = await sb.from('invoice_items').insert(itemRows.map((l) => ({ ...l, invoice_id: inv.id })));
    if (liErr) throw liErr;

    if (isClosed) {
      const { error: pErr } = await sb.from('payments').insert({
        invoice_id: inv.id,
        client_id: client.id,
        payment_date: paidOn || dueDate || invoiceDate,
        amount: total,
        currency,
        exchange_rate: fx,
        mode: currency === 'USD' ? 'wire' : 'bank_transfer',
        tds_deducted: taxMode === 'export_lut' ? 0 : tdsAmount,
        notes: 'Imported from Zoho Billing (Closed)',
      });
      if (pErr) throw pErr;
      if (paidOn) {
        await sb.from('invoices').update({ paid_at: `${paidOn}T12:00:00.000Z` }).eq('id', inv.id);
      }
    }

    inserted += 1;
    console.log(`  ${isClosed ? 'paid' : 'draft'} ${number}  ${currency} ${total}  (${itemRows.length} lines)`);
  }
  return { inserted, skipped };
}

const contacts = parseCsv(readFileSync(join(root, 'Contacts.csv'), 'utf8'));
const invoices = parseCsv(readFileSync(join(root, 'Invoice.csv'), 'utf8'));
console.log(`Parsed ${contacts.length} contacts, ${invoices.length} invoice line rows`);

const clientMap = await seedClients(contacts);
const groups = groupInvoices(invoices);
console.log(`Grouped into ${groups.length} invoices`);
const result = await seedInvoices(groups, clientMap);

const { count: clientCount } = await sb.from('clients').select('*', { count: 'exact', head: true });
const { count: invCount } = await sb.from('invoices').select('*', { count: 'exact', head: true });
await sb.from('company_profile').update({ next_invoice_no: 17 }).eq('id', 1);

console.log(`Done. clients=${clientCount} invoices=${invCount} inserted=${result.inserted} skipped=${result.skipped}`);
console.log('Next invoice number kept at BL-000017');
