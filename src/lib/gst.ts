import type { Client, CompanyProfile, InvoiceLine, TaxMode, GstTreatment } from './types';

/** GST state codes — first two digits of a GSTIN. */
export const STATE_CODES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' }, { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' }, { code: '97', name: 'Other Territory' },
  { code: '96', name: 'Outside India' },
];

export const stateNameByCode = (code?: string | null) =>
  STATE_CODES.find((s) => s.code === code)?.name ?? '';
export const stateCodeByName = (name?: string | null) =>
  STATE_CODES.find((s) => s.name.toLowerCase() === (name ?? '').toLowerCase())?.code ?? '';

export const GST_RATES = [0, 0.1, 0.25, 3, 5, 12, 18, 28];

/** GSTIN format: 22AAAAA0000A1Z5 */
export function isValidGstin(g?: string | null): boolean {
  if (!g) return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g.trim().toUpperCase());
}
export function isValidPan(p?: string | null): boolean {
  if (!p) return false;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p.trim().toUpperCase());
}
export const stateCodeFromGstin = (g?: string | null) =>
  g && g.length >= 2 ? g.slice(0, 2) : '';

export const TAX_MODE_LABEL: Record<TaxMode, string> = {
  intra: 'Intra-state — CGST + SGST',
  inter: 'Inter-state — IGST',
  export_lut: 'Export / SEZ under LUT — 0% (zero-rated)',
  export_paid: 'Export / SEZ with payment of IGST',
  exempt: 'Exempt / Nil-rated',
};

/**
 * Decide CGST+SGST vs IGST vs zero-rated.
 * Place of supply == supplier state  ->  intra-state (CGST+SGST)
 * Otherwise                          ->  inter-state (IGST)
 * Overseas / SEZ                     ->  zero-rated under LUT, or IGST if "with payment"
 */
export function resolveTaxMode(
  supplierStateCode: string | null | undefined,
  treatment: GstTreatment,
  placeOfSupplyCode: string | null | undefined,
): TaxMode {
  if (treatment === 'overseas' || treatment === 'sez_without_payment' || treatment === 'deemed_export')
    return 'export_lut';
  if (treatment === 'sez_with_payment') return 'export_paid';
  if (!supplierStateCode || !placeOfSupplyCode) return 'inter';
  return supplierStateCode === placeOfSupplyCode ? 'intra' : 'inter';
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Recompute one line's taxable value and tax split. */
export function computeLine(line: InvoiceLine, mode: TaxMode): InvoiceLine {
  const gross = (Number(line.quantity) || 0) * (Number(line.rate) || 0);
  const discount = gross * ((Number(line.discount_pct) || 0) / 100);
  const taxable = r2(gross - discount);
  const rate = mode === 'export_lut' || mode === 'exempt' ? 0 : Number(line.gst_rate) || 0;

  let cgst = 0, sgst = 0, igst = 0;
  if (mode === 'intra') {
    cgst = r2((taxable * rate) / 200);
    sgst = r2((taxable * rate) / 200);
  } else if (mode === 'inter' || mode === 'export_paid') {
    igst = r2((taxable * rate) / 100);
  }
  const cess = r2((taxable * (Number(line.cess_rate) || 0)) / 100);

  return {
    ...line,
    quantity: Number(line.quantity) || 0,
    rate: Number(line.rate) || 0,
    discount_pct: Number(line.discount_pct) || 0,
    gst_rate: Number(line.gst_rate) || 0,
    taxable_value: taxable,
    cgst_amount: cgst,
    sgst_amount: sgst,
    igst_amount: igst,
    cess_amount: cess,
    line_total: r2(taxable + cgst + sgst + igst + cess),
  };
}

export interface Totals {
  subtotal: number; discount_total: number;
  cgst_total: number; sgst_total: number; igst_total: number; cess_total: number;
  tax_total: number; round_off: number; total: number; tds_amount: number;
  net_receivable: number;
  rateGroups: { rate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
}

/** Totals for a whole document. TDS never reduces the invoice total — it is shown for information. */
export function computeTotals(
  lines: InvoiceLine[],
  mode: TaxMode,
  opts: { roundOff?: boolean; tdsApplicable?: boolean; tdsRate?: number } = {},
): Totals {
  const computed = lines.map((l) => computeLine(l, mode));
  const sum = (f: (l: InvoiceLine) => number) => r2(computed.reduce((a, l) => a + f(l), 0));

  const subtotal = sum((l) => l.taxable_value);
  const discount_total = r2(
    computed.reduce((a, l) => a + l.quantity * l.rate * (l.discount_pct / 100), 0),
  );
  const cgst_total = sum((l) => l.cgst_amount);
  const sgst_total = sum((l) => l.sgst_amount);
  const igst_total = sum((l) => l.igst_amount);
  const cess_total = sum((l) => l.cess_amount);
  const tax_total = r2(cgst_total + sgst_total + igst_total + cess_total);

  const raw = r2(subtotal + tax_total);
  const rounded = opts.roundOff === false ? raw : Math.round(raw);
  const round_off = r2(rounded - raw);

  const tds_amount = opts.tdsApplicable ? r2((subtotal * (opts.tdsRate ?? 10)) / 100) : 0;

  const groups = new Map<number, { rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  computed.forEach((l) => {
    const g = groups.get(l.gst_rate) ?? { rate: l.gst_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable = r2(g.taxable + l.taxable_value);
    g.cgst = r2(g.cgst + l.cgst_amount);
    g.sgst = r2(g.sgst + l.sgst_amount);
    g.igst = r2(g.igst + l.igst_amount);
    groups.set(l.gst_rate, g);
  });

  return {
    subtotal, discount_total, cgst_total, sgst_total, igst_total, cess_total,
    tax_total, round_off, total: rounded, tds_amount,
    net_receivable: r2(rounded - tds_amount),
    rateGroups: [...groups.values()].sort((a, b) => a.rate - b.rate),
  };
}

/** Place of supply defaults from the client record. */
export function defaultPlaceOfSupply(client: Pick<Client, 'gst_treatment' | 'gstin' | 'place_of_supply_code' | 'bill_state'>) {
  if (client.gst_treatment === 'overseas') return { code: '96', name: 'Outside India' };
  const fromGstin = stateCodeFromGstin(client.gstin);
  const code = client.place_of_supply_code || fromGstin || stateCodeByName(client.bill_state);
  return { code, name: stateNameByCode(code) };
}

export function supplierState(profile?: Partial<CompanyProfile> | null) {
  return {
    code: profile?.state_code || stateCodeFromGstin(profile?.gstin) || '36',
    name: profile?.state || 'Telangana',
  };
}
