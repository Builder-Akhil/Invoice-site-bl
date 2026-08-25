'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase/client';
import { GST_TREATMENTS, type Client, type GstTreatment } from '@/lib/types';
import { STATE_CODES, isValidGstin, isValidPan, stateCodeFromGstin, stateNameByCode } from '@/lib/gst';
import { CURRENCIES } from '@/lib/format';
import { Field, Input, Select, Textarea, Toggle, Modal, toast, Spinner } from './ui';

const blank = (): Partial<Client> => ({
  company_name: '', contact_person: '', email: '', cc_emails: '', work_phone: '', mobile: '',
  gst_treatment: 'registered_business', gstin: '', pan: '',
  place_of_supply_state: 'Telangana', place_of_supply_code: '36',
  is_overseas: false, currency: 'INR', bill_country: 'India',
  payment_terms_days: 7, default_gst_rate: 18, tds_applicable: false,
  tds_section: '194J', tds_rate: 10, status: 'active', ship_same_as_bill: true, opening_balance: 0,
});

export default function ClientForm({ open, onClose, client, onSaved }: {
  open: boolean; onClose: () => void; client?: Client | null; onSaved: (c: Client) => void;
}) {
  const [f, setF] = useState<Partial<Client>>(blank());
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'basic' | 'address' | 'terms'>('basic');

  useEffect(() => { if (open) { setF(client ? { ...client } : blank()); setTab('basic'); } }, [open, client]);

  const set = <K extends keyof Client>(k: K, v: Client[K]) => setF((s) => ({ ...s, [k]: v }));

  function onTreatment(t: GstTreatment) {
    const overseas = t === 'overseas';
    setF((s) => ({
      ...s,
      gst_treatment: t,
      is_overseas: overseas,
      currency: overseas ? (s.currency === 'INR' ? 'USD' : s.currency) : 'INR',
      place_of_supply_code: overseas ? '96' : s.place_of_supply_code === '96' ? '36' : s.place_of_supply_code,
      place_of_supply_state: overseas ? 'Outside India' : s.place_of_supply_state === 'Outside India' ? 'Telangana' : s.place_of_supply_state,
      bill_country: overseas && s.bill_country === 'India' ? '' : s.bill_country,
    }));
  }

  function onGstin(v: string) {
    const g = v.toUpperCase();
    const code = stateCodeFromGstin(g);
    setF((s) => ({
      ...s, gstin: g,
      pan: g.length === 15 ? g.slice(2, 12) : s.pan,
      ...(code && stateNameByCode(code)
        ? { place_of_supply_code: code, place_of_supply_state: stateNameByCode(code) }
        : {}),
    }));
  }

  async function save() {
    if (!f.company_name?.trim()) return toast('Company name is required', 'error');
    if (f.gstin && !isValidGstin(f.gstin)) return toast('That GSTIN does not look valid (15 chars, e.g. 36ABHFB0187F1ZL)', 'error');
    if (f.pan && !isValidPan(f.pan)) return toast('That PAN does not look valid (e.g. ABHFB0187F)', 'error');
    setBusy(true);
    const payload = { ...f, updated_at: new Date().toISOString() };
    delete (payload as Record<string, unknown>).created_at;
    const q = client?.id
      ? sb().from('clients').update(payload).eq('id', client.id).select().single()
      : sb().from('clients').insert(payload).select().single();
    const { data, error } = await q;
    setBusy(false);
    if (error) return toast(error.message, 'error');
    toast(client?.id ? 'Client updated' : 'Client added');
    onSaved(data as Client);
    onClose();
  }

  const overseas = f.gst_treatment === 'overseas';

  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl"
      title={client?.id ? 'Edit client' : 'New client'}
      subtitle="Everything here flows straight onto the invoice."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : client?.id ? 'Save changes' : 'Add client'}
        </button>
      </>}>

      <div className="mb-5 flex gap-1 rounded-lg border border-line bg-ink-800/60 p-1">
        {([['basic', 'Contact & GST'], ['address', 'Addresses'], ['terms', 'Commercial terms']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition ${tab === k ? 'bg-ink-500 text-white' : 'text-chrome hover:text-white'}`}>{l}</button>
        ))}
      </div>

      {tab === 'basic' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company / organisation" required className="sm:col-span-2">
            <Input value={f.company_name ?? ''} onChange={(e) => set('company_name', e.target.value)} placeholder="AAFM India" />
          </Field>
          <Field label="Contact person" hint="The person representing the company">
            <Input value={f.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Designation">
            <Input value={f.contact_designation ?? ''} onChange={(e) => set('contact_designation', e.target.value)} placeholder="Finance Head" />
          </Field>
          <Field label="Email" hint="Invoices are sent here">
            <Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="accounts@company.com" />
          </Field>
          <Field label="CC emails" hint="Comma separated">
            <Input value={f.cc_emails ?? ''} onChange={(e) => set('cc_emails', e.target.value)} placeholder="cfo@company.com, ap@company.com" />
          </Field>
          <Field label="Work phone">
            <Input value={f.work_phone ?? ''} onChange={(e) => set('work_phone', e.target.value)} placeholder="+91 40 0000 0000" />
          </Field>
          <Field label="Mobile">
            <Input value={f.mobile ?? ''} onChange={(e) => set('mobile', e.target.value)} placeholder="+91 90000 00000" />
          </Field>

          <div className="sm:col-span-2 mt-1 border-t border-line pt-4">
            <p className="label-mono mb-3">GST treatment</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Treatment" className="sm:col-span-2"
                hint={GST_TREATMENTS.find((t) => t.value === f.gst_treatment)?.hint}>
                <Select value={f.gst_treatment} onChange={(e) => onTreatment(e.target.value as GstTreatment)}>
                  {GST_TREATMENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
              {!overseas && (
                <>
                  <Field label="GSTIN" hint="Auto-fills PAN and place of supply">
                    <Input className="input-mono uppercase" maxLength={15} value={f.gstin ?? ''}
                      onChange={(e) => onGstin(e.target.value)} placeholder="09AAYCA1840R1ZR" />
                  </Field>
                  <Field label="PAN">
                    <Input className="input-mono uppercase" maxLength={10} value={f.pan ?? ''}
                      onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="AAYCA1840R" />
                  </Field>
                </>
              )}
              <Field label="Place of supply" hint={overseas ? 'Export of service — outside India' : 'Decides IGST vs CGST + SGST'}>
                <Select value={f.place_of_supply_code ?? ''} disabled={overseas}
                  onChange={(e) => { set('place_of_supply_code', e.target.value); set('place_of_supply_state', stateNameByCode(e.target.value)); }}>
                  {STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                </Select>
              </Field>
              <Field label="Billing currency">
                <Select value={f.currency ?? 'INR'} onChange={(e) => set('currency', e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                </Select>
              </Field>
            </div>
          </div>
        </div>
      )}

      {tab === 'address' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Attention" className="sm:col-span-2">
            <Input value={f.bill_attention ?? ''} onChange={(e) => set('bill_attention', e.target.value)} placeholder="Accounts Payable" />
          </Field>
          <Field label="Address line 1" className="sm:col-span-2">
            <Input value={f.bill_line1 ?? ''} onChange={(e) => set('bill_line1', e.target.value)} placeholder="Plot No. 30, 3rd Floor, Grover Tower-1" />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <Input value={f.bill_line2 ?? ''} onChange={(e) => set('bill_line2', e.target.value)} placeholder="Main Najafgarh Road, Shivaji Marg, Moti Nagar" />
          </Field>
          <Field label="City"><Input value={f.bill_city ?? ''} onChange={(e) => set('bill_city', e.target.value)} /></Field>
          <Field label="State / region"><Input value={f.bill_state ?? ''} onChange={(e) => set('bill_state', e.target.value)} /></Field>
          <Field label="Postal code"><Input value={f.bill_pincode ?? ''} onChange={(e) => set('bill_pincode', e.target.value)} /></Field>
          <Field label="Country"><Input value={f.bill_country ?? ''} onChange={(e) => set('bill_country', e.target.value)} /></Field>

          <div className="sm:col-span-2 border-t border-line pt-4">
            <Toggle checked={!!f.ship_same_as_bill} onChange={(v) => set('ship_same_as_bill', v)}
              label="Shipping address same as billing" />
          </div>
          {!f.ship_same_as_bill && (
            <>
              <Field label="Ship line 1" className="sm:col-span-2"><Input value={f.ship_line1 ?? ''} onChange={(e) => set('ship_line1', e.target.value)} /></Field>
              <Field label="Ship city"><Input value={f.ship_city ?? ''} onChange={(e) => set('ship_city', e.target.value)} /></Field>
              <Field label="Ship state"><Input value={f.ship_state ?? ''} onChange={(e) => set('ship_state', e.target.value)} /></Field>
              <Field label="Ship pincode"><Input value={f.ship_pincode ?? ''} onChange={(e) => set('ship_pincode', e.target.value)} /></Field>
              <Field label="Ship country"><Input value={f.ship_country ?? ''} onChange={(e) => set('ship_country', e.target.value)} /></Field>
            </>
          )}
        </div>
      )}

      {tab === 'terms' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment terms (days)" hint="Due date = invoice date + this">
            <Input type="number" min={0} value={f.payment_terms_days ?? 7}
              onChange={(e) => set('payment_terms_days', Number(e.target.value))} />
          </Field>
          <Field label="Default GST rate %">
            <Input type="number" min={0} max={28} value={f.default_gst_rate ?? 18}
              onChange={(e) => set('default_gst_rate', Number(e.target.value))} />
          </Field>
          <Field label="Default SAC / HSN">
            <Input className="input-mono" value={f.default_sac ?? ''} onChange={(e) => set('default_sac', e.target.value)} placeholder="998314" />
          </Field>
          <Field label="Opening balance">
            <Input type="number" step="0.01" value={f.opening_balance ?? 0}
              onChange={(e) => set('opening_balance', Number(e.target.value))} />
          </Field>

          <div className="sm:col-span-2 rounded-lg border border-line bg-ink-800/50 p-4">
            <Toggle checked={!!f.tds_applicable} onChange={(v) => set('tds_applicable', v)}
              label="This client deducts TDS at source" />
            <p className="mt-1.5 text-[11px] text-chrome-dark">
              Tracked for your reconciliation only — the invoice total is never reduced.
            </p>
            {f.tds_applicable && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Section">
                  <Select value={f.tds_section ?? '194J'} onChange={(e) => set('tds_section', e.target.value)}>
                    <option value="194J">194J — Professional / technical fees</option>
                    <option value="194C">194C — Contract</option>
                    <option value="194H">194H — Commission</option>
                    <option value="194Q">194Q — Purchase of goods</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Rate %">
                  <Input type="number" step="0.01" value={f.tds_rate ?? 10} onChange={(e) => set('tds_rate', Number(e.target.value))} />
                </Field>
              </div>
            )}
          </div>

          <Field label="Status">
            <Select value={f.status ?? 'active'} onChange={(e) => set('status', e.target.value)}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </Select>
          </Field>
          <Field label="Website">
            <Input value={f.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Internal notes" className="sm:col-span-2">
            <Textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Anything worth remembering about this account" />
          </Field>
        </div>
      )}
    </Modal>
  );
}
