import type { Invoice, Payment } from './types';

export function r2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** What should land in the LLP bank after the client withholds TDS. */
export function netExpected(inv: Pick<Invoice, 'total' | 'tds_amount'>) {
  return r2(Number(inv.total) - Number(inv.tds_amount || 0));
}

export function paymentSettles(p: Pick<Payment, 'amount' | 'tds_deducted' | 'bank_charges'>) {
  return r2(Number(p.amount || 0) + Number(p.tds_deducted || 0) + Number(p.bank_charges || 0));
}

export function invoiceSettlement(
  inv: Pick<Invoice, 'total' | 'tds_amount'>,
  payments: Pick<Payment, 'amount' | 'tds_deducted' | 'bank_charges'>[],
) {
  const total = Number(inv.total) || 0;
  const tdsDue = Number(inv.tds_amount || 0);
  const bank = r2(payments.reduce((a, p) => a + Number(p.amount || 0), 0));
  const tdsRecorded = r2(payments.reduce((a, p) => a + Number(p.tds_deducted || 0), 0));
  const charges = r2(payments.reduce((a, p) => a + Number(p.bank_charges || 0), 0));
  const settled = r2(bank + tdsRecorded + charges);
  return {
    total,
    tdsDue,
    netExpected: r2(total - tdsDue),
    bank,
    tdsRecorded,
    charges,
    settled,
    remaining: r2(Math.max(0, total - settled)),
    remainingBank: r2(Math.max(0, total - tdsDue - bank)),
    remainingTds: r2(Math.max(0, tdsDue - tdsRecorded)),
    isPaid: settled >= total - 0.5,
  };
}
