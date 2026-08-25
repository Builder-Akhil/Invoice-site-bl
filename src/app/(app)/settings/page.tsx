'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Upload, Save, Building2, Landmark, Hash, Palette, MapPin, Fuel } from 'lucide-react';
import { sb } from '@/lib/supabase/client';
import { useProfile } from '@/lib/hooks';
import type { CompanyProfile } from '@/lib/types';
import { STATE_CODES, isValidGstin, stateNameByCode } from '@/lib/gst';
import { BRAND_LOGO, displayLogo } from '@/lib/brand';
import { Card, Field, Input, Loading, PageHeader, Select, Textarea, toast, Spinner } from '@/components/ui';
import { SacCodesEditor, SacPicker } from '@/components/SacPicker';
import { resolveSacCodes } from '@/lib/sac';

const TABS = [
  { key: 'company', label: 'Company', icon: Building2 },
  { key: 'cash', label: 'Cash & runway', icon: Fuel },
  { key: 'address', label: 'Address & GST', icon: MapPin },
  { key: 'bank', label: 'Banking', icon: Landmark },
  { key: 'docs', label: 'Numbering & defaults', icon: Hash },
  { key: 'brand', label: 'Logo & signature', icon: Palette },
] as const;

export default function SettingsPage() {
  const { profile, loading, reload } = useProfile();
  const [f, setF] = useState<Partial<CompanyProfile>>({});
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('company');
  const [busy, setBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const signRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile) return;
    setF({
      ...profile,
      logo_url: profile.logo_url || BRAND_LOGO,
      sac_codes: resolveSacCodes(profile.sac_codes),
    });
  }, [profile]);
  const set = <K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (f.gstin && !isValidGstin(f.gstin)) return toast('GSTIN does not look valid', 'error');
    setBusy(true);
    const payload = {
      ...f,
      id: 1,
      updated_at: new Date().toISOString(),
      sac_codes: resolveSacCodes(f.sac_codes),
    };
    const { error } = await sb().from('company_profile').upsert(payload);
    setBusy(false);
    if (error) return toast(error.message, 'error');
    toast('Profile saved'); reload();
  }

  async function upload(file: File, kind: 'logo' | 'signature') {
    const path = `${kind}-${Date.now()}-${file.name.replace(/[^\w.-]/g, '')}`;
    const { error } = await sb().storage.from('brand').upload(path, file, { upsert: true });
    if (error) return toast(error.message, 'error');
    const { data } = sb().storage.from('brand').getPublicUrl(path);
    set(kind === 'logo' ? 'logo_url' : 'signature_url', data.publicUrl);
    toast('Uploaded — remember to save');
  }

  if (loading) return <Loading label="Loading profile" />;

  return (
    <>
      <PageHeader title="Profile & Settings" subtitle="Everything printed on your invoices lives here.">
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : <><Save size={15} /> Save changes</>}
        </button>
      </PageHeader>

      <div className="mb-5 flex flex-wrap gap-1 rounded-lg border border-line bg-ink-800/60 p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition ${tab === t.key ? 'bg-ink-500 text-white' : 'text-chrome hover:text-white'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'company' && (
        <Card title="Legal entity" subtitle="Shown as the supplier on every tax invoice.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" required><Input value={f.legal_name ?? ''} onChange={(e) => set('legal_name', e.target.value)} /></Field>
            <Field label="Trade name"><Input value={f.trade_name ?? ''} onChange={(e) => set('trade_name', e.target.value)} /></Field>
            <Field label="Entity type">
              <Select value={f.entity_type ?? 'LLP'} onChange={(e) => set('entity_type', e.target.value)}>
                {['LLP', 'Private Limited', 'Proprietorship', 'Partnership', 'OPC'].map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="LLPIN / CIN"><Input className="input-mono" value={f.cin_llpin ?? ''} onChange={(e) => set('cin_llpin', e.target.value)} placeholder="AAB-1234" /></Field>
            <Field label="Representative" hint="Designated partner / authorised signatory">
              <Input value={f.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} />
            </Field>
            <Field label="Designation"><Input value={f.designation ?? ''} onChange={(e) => set('designation', e.target.value)} /></Field>
            <Field label="Billing email"><Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Phone"><Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Website" className="sm:col-span-2"><Input value={f.website ?? ''} onChange={(e) => set('website', e.target.value)} /></Field>
          </div>
        </Card>
      )}

      {tab === 'cash' && (
        <Card title="Cash on hand" subtitle="Fuel remaining in the tanks. Runway on the dashboard is cash ÷ (typical full-kit payroll + monthly subscriptions + trailing 3-month GST due). Leave blank if you have not counted it — we will not invent a number.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cash on hand (INR)" hint="Bank + wallets you treat as available. Update after each big in or out.">
              <Input type="number" step="0.01" className="input-mono" placeholder="Not set"
                value={f.cash_on_hand ?? ''}
                onChange={(e) => set('cash_on_hand', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
          </div>
          <p className="mt-4 rounded-lg border border-line bg-ink-800/50 px-4 py-3 text-[12.5px] leading-relaxed text-chrome">
            Zero is a real number (empty tanks). Clearing the field means “I have not told you yet.”
            Ask the assistant to quote runway only after this is current — like asking for remaining flight time after you read the fuel gauges.
          </p>
        </Card>
      )}

      {tab === 'address' && (
        <Card title="Registered address & GST" subtitle="Your state decides IGST vs CGST + SGST on every invoice.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GSTIN" required className="sm:col-span-2" hint="Place of supply is compared against the state code below.">
              <Input className="input-mono uppercase" maxLength={15} value={f.gstin ?? ''}
                onChange={(e) => { const g = e.target.value.toUpperCase(); set('gstin', g);
                  if (g.length >= 2 && stateNameByCode(g.slice(0, 2))) { set('state_code', g.slice(0, 2)); set('state', stateNameByCode(g.slice(0, 2))); }
                  if (g.length === 15) set('pan', g.slice(2, 12)); }} />
            </Field>
            <Field label="PAN"><Input className="input-mono uppercase" maxLength={10} value={f.pan ?? ''} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></Field>
            <Field label="Supplier state">
              <Select value={f.state_code ?? '36'} onChange={(e) => { set('state_code', e.target.value); set('state', stateNameByCode(e.target.value)); }}>
                {STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
              </Select>
            </Field>
            <Field label="Address line 1" className="sm:col-span-2"><Input value={f.address_line1 ?? ''} onChange={(e) => set('address_line1', e.target.value)} /></Field>
            <Field label="Address line 2" className="sm:col-span-2"><Input value={f.address_line2 ?? ''} onChange={(e) => set('address_line2', e.target.value)} /></Field>
            <Field label="City"><Input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="Pincode"><Input value={f.pincode ?? ''} onChange={(e) => set('pincode', e.target.value)} /></Field>
            <Field label="Country"><Input value={f.country ?? ''} onChange={(e) => set('country', e.target.value)} /></Field>
            <Field label="LUT / Bond number" hint="Printed on zero-rated export invoices (Letter of Undertaking).">
              <Input className="input-mono" value={f.lut_number ?? ''} onChange={(e) => set('lut_number', e.target.value)} placeholder="AD3612..." />
            </Field>
          </div>
        </Card>
      )}

      {tab === 'bank' && (
        <Card title="Bank details" subtitle="Printed in the notes block so clients can pay without asking.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account name"><Input value={f.bank_account_name ?? ''} onChange={(e) => set('bank_account_name', e.target.value)} /></Field>
            <Field label="Account number"><Input className="input-mono" value={f.bank_account_no ?? ''} onChange={(e) => set('bank_account_no', e.target.value)} /></Field>
            <Field label="IFSC"><Input className="input-mono uppercase" value={f.bank_ifsc ?? ''} onChange={(e) => set('bank_ifsc', e.target.value.toUpperCase())} /></Field>
            <Field label="SWIFT" hint="For overseas wires"><Input className="input-mono uppercase" value={f.bank_swift ?? ''} onChange={(e) => set('bank_swift', e.target.value.toUpperCase())} /></Field>
            <Field label="Bank name"><Input value={f.bank_name ?? ''} onChange={(e) => set('bank_name', e.target.value)} /></Field>
            <Field label="Branch"><Input value={f.bank_branch ?? ''} onChange={(e) => set('bank_branch', e.target.value)} /></Field>
            <Field label="Beneficiary" hint="If different from account name">
              <Input value={f.beneficiary_name ?? ''} onChange={(e) => set('beneficiary_name', e.target.value)} />
            </Field>
            <Field label="UPI ID"><Input className="input-mono" value={f.upi_id ?? ''} onChange={(e) => set('upi_id', e.target.value)} /></Field>
          </div>
        </Card>
      )}

      {tab === 'docs' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Invoice numbering" subtitle="The series continues automatically — you can still override any single invoice.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Prefix"><Input className="input-mono" value={f.invoice_prefix ?? ''} onChange={(e) => set('invoice_prefix', e.target.value)} /></Field>
              <Field label="Digits"><Input type="number" min={1} max={10} value={f.invoice_padding ?? 6} onChange={(e) => set('invoice_padding', Number(e.target.value))} /></Field>
              <Field label="Next number"><Input type="number" min={1} className="input-mono" value={f.next_invoice_no ?? 17} onChange={(e) => set('next_invoice_no', Number(e.target.value))} /></Field>
            </div>
            <p className="mt-3 rounded-lg border border-line bg-ink-800/60 px-3 py-2 font-mono text-[12.5px] text-blue-300">
              Next invoice → {(f.invoice_prefix ?? '') + String(f.next_invoice_no ?? 0).padStart(f.invoice_padding ?? 6, '0')}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Field label="Quote prefix"><Input className="input-mono" value={f.quote_prefix ?? ''} onChange={(e) => set('quote_prefix', e.target.value)} /></Field>
              <Field label="Digits"><Input type="number" min={1} max={10} value={f.quote_padding ?? 4} onChange={(e) => set('quote_padding', Number(e.target.value))} /></Field>
              <Field label="Next number"><Input type="number" min={1} className="input-mono" value={f.next_quote_no ?? 1} onChange={(e) => set('next_quote_no', Number(e.target.value))} /></Field>
            </div>
          </Card>

          <Card title="Document defaults" subtitle="Pre-filled on every new invoice — always editable.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default due days"><Input type="number" min={0} value={f.default_due_days ?? 7} onChange={(e) => set('default_due_days', Number(e.target.value))} /></Field>
              <Field label="Default GST rate %"><Input type="number" value={f.default_gst_rate ?? 18} onChange={(e) => set('default_gst_rate', Number(e.target.value))} /></Field>
              <Field label="SAC list" className="sm:col-span-2"
                hint="These tags appear on every invoice line. Add your own, or reset to Advisory / IT design / Training.">
                <SacCodesEditor value={Array.isArray(f.sac_codes) && f.sac_codes.length ? f.sac_codes : resolveSacCodes(null)}
                  onChange={(next) => {
                    set('sac_codes', next);
                    if (f.default_sac && !next.some((s) => s.code === f.default_sac)) {
                      set('default_sac', next.find((s) => s.code)?.code ?? '');
                    }
                  }} />
              </Field>
              <Field label="Default SAC" className="sm:col-span-2" hint="Used on new invoice lines.">
                <SacPicker compact={false} value={f.default_sac ?? ''} codes={f.sac_codes}
                  onChange={(code) => set('default_sac', code)} />
              </Field>
              <Field label="Default terms" className="sm:col-span-2"><Textarea value={f.default_terms ?? ''} onChange={(e) => set('default_terms', e.target.value)} /></Field>
              <Field label="Default notes" className="sm:col-span-2" hint="Bank details are added automatically below this.">
                <Textarea value={f.default_notes ?? ''} onChange={(e) => set('default_notes', e.target.value)} placeholder="HSN Code: 999293" />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {tab === 'brand' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Logo" subtitle="Top-right of every invoice and PDF. PNG or SVG, transparent background.">
            <div className="flex items-center gap-5">
              <div className="grid h-24 w-24 shrink-0 place-items-center rounded-xl border border-line bg-white p-2">
                <Image src={displayLogo(f.logo_url)} alt="Logo" width={80} height={80} className="max-h-20 w-auto object-contain" unoptimized />
              </div>
              <div className="flex-1 space-y-2">
                <input ref={logoRef} type="file" accept="image/*" hidden
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'logo')} />
                <button className="btn-ghost" onClick={() => logoRef.current?.click()}><Upload size={14} /> Upload logo</button>
                <button className="btn-ghost" onClick={() => set('logo_url', BRAND_LOGO)}>Use brand logo</button>
                <Input placeholder="…or paste an image URL" value={f.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value)} />
              </div>
            </div>
          </Card>

          <Card title="Signature" subtitle="Appears above the authorised signatory line.">
            <div className="flex items-center gap-5">
              <div className="grid h-24 w-40 shrink-0 place-items-center rounded-xl border border-line bg-white p-2">
                {f.signature_url
                  ? <Image src={f.signature_url} alt="Signature" width={140} height={70} className="max-h-20 w-auto object-contain" unoptimized />
                  : <span className="text-[11px] text-chrome-dark">No signature</span>}
              </div>
              <div className="flex-1 space-y-2">
                <input ref={signRef} type="file" accept="image/*" hidden
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'signature')} />
                <button className="btn-ghost" onClick={() => signRef.current?.click()}><Upload size={14} /> Upload signature</button>
                <Input placeholder="…or paste an image URL" value={f.signature_url ?? ''} onChange={(e) => set('signature_url', e.target.value)} />
                <Input placeholder="Signatory name" value={f.signatory_name ?? ''} onChange={(e) => set('signatory_name', e.target.value)} />
              </div>
            </div>
          </Card>

          <p className="lg:col-span-2 rounded-lg border border-line bg-ink-800/50 px-4 py-3 text-[12px] leading-relaxed text-chrome">
            Logo and signature live in a public storage locker named <span className="font-mono text-chrome-light">brand</span>
            so they print on invoices and PDFs. After you upload, click <strong className="text-white">Save changes</strong>.
          </p>
        </div>
      )}
    </>
  );
}
