'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Check, Copy, KeyRound, Plug, RefreshCw, Save, ShieldCheck, Trash2, Zap, AlertTriangle,
} from 'lucide-react';
import { PRODUCT } from '@/lib/product';
import {
  Card, Collapse, Field, Input, InfoHint, Loading, PageHeader, Select, Spinner, Toggle, toast,
} from '@/components/ui';

/* ------------------------------------------------------------------ types */

type Settings = {
  ai_primary: string | null;
  ai_fallback_enabled: boolean | null;
  deepseek_model: string | null;
  claude_model: string | null;
  deepseek_key_mask: string | null;
  deepseek_key_set: boolean;
  claude_key_mask: string | null;
  claude_key_set: boolean;
  whatsapp_enabled: boolean | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_verify_token: string | null;
  whatsapp_allowed_numbers: string[] | null;
  whatsapp_token_mask: string | null;
  whatsapp_token_set: boolean;
  telegram_enabled: boolean | null;
  telegram_bot_username: string | null;
  telegram_allowed_chats: string[] | null;
  telegram_token_mask: string | null;
  telegram_token_set: boolean;
};

type Payload = {
  settings: Settings;
  platform: { deepseek: boolean; claude: boolean };
  defaultModels: { deepseek: string; claude: string };
  encryptionReady: boolean;
};

type TestState = { ok: boolean; label: string; model: string; ms?: number; error?: string } | null;

/* ------------------------------------------------------------------ atoms */

function Mark({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-line bg-ink-800/80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={19} height={19} className="h-[19px] w-[19px] object-contain" />
    </span>
  );
}

function Badge({ tone, children }: { tone: 'live' | 'byo' | 'off' | 'warn'; children: React.ReactNode }) {
  const cls = {
    live: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
    byo: 'bg-blue/15 text-blue-300 ring-blue/30',
    warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
    off: 'bg-ink-400 text-chrome ring-line',
  }[tone];
  return <span className={`pill ring-1 ring-inset ${cls}`}>{children}</span>;
}

function CopyRow({ label, value, tip }: { label: string; value: string; tip?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <p className="field-label flex items-center gap-1.5">
        <span>{label}</span>
        {tip && <InfoHint tip={tip} />}
      </p>
      <div className="flex items-stretch gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-[7px] border border-line bg-ink-800/70 px-3 py-2 font-mono text-[12px] text-chrome-light">
          {value}
        </code>
        <button
          className="btn-ghost btn-sm shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(value).then(
              () => { setDone(true); setTimeout(() => setDone(false), 1600); },
              () => toast('Could not reach the clipboard', 'error'),
            );
          }}>
          {done ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

/** A key field that shows the mask until you type, and can be cleared outright. */
function SecretField({ label, mask, isSet, value, onChange, onClear, placeholder, hint, tip }: {
  label: string; mask: string | null; isSet: boolean;
  value: string | null; onChange: (v: string) => void; onClear: () => void;
  placeholder: string; hint?: string; tip?: React.ReactNode;
}) {
  const dirty = value !== null;
  return (
    <Field label={label} hint={hint} tip={tip}>
      <div className="flex items-stretch gap-1.5">
        <Input
          type={dirty ? 'text' : 'password'}
          className="input-mono flex-1"
          spellCheck={false}
          autoComplete="off"
          placeholder={isSet ? (mask ?? '••••••••') : placeholder}
          value={dirty ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
        {isSet && !dirty && (
          <button className="btn-ghost btn-sm shrink-0 text-red-300" onClick={onClear} title="Remove this key">
            <Trash2 size={13} />
          </button>
        )}
        {dirty && (
          <button className="btn-subtle btn-sm shrink-0" onClick={() => onChange('')} title="Cancel edit">
            Undo
          </button>
        )}
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------- page */

export default function IntegrationsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const origin = typeof window === 'undefined' ? PRODUCT.url : window.location.origin;

  const load = useCallback(async () => {
    const res = await fetch('/api/integrations');
    const json = await res.json();
    if (!res.ok) return toast(json.error ?? 'Could not load integrations', 'error');
    setData(json as Payload);
    setPatch({});
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: unknown) => setPatch((s) => ({ ...s, [k]: v }));
  const val = <T,>(k: keyof Settings, fallback: T): T =>
    (k in patch ? patch[k as string] : data?.settings[k]) as T ?? fallback;
  /** Secret inputs are uncontrolled-until-touched, so null means "unchanged". */
  const secret = (k: string): string | null => (k in patch ? (patch[k] as string | null) : null);

  const dirty = Object.keys(patch).length > 0;

  async function save() {
    setBusy(true);
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error ?? 'Save failed', 'error');
    toast('Integrations saved');
    load();
  }

  async function test(target: 'deepseek' | 'claude') {
    setTesting(target);
    const res = await fetch('/api/integrations/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    const json = await res.json();
    setTesting(null);
    setTests((s) => ({ ...s, [target]: res.ok ? json : { ok: false, label: json.label ?? target, model: json.model ?? '', error: json.error } }));
    toast(res.ok ? `${json.label} answered in ${json.ms}ms` : (json.error ?? 'Test failed'), res.ok ? 'success' : 'error');
  }

  if (!data) return <Loading label="Loading integrations" />;

  const s = data.settings;
  const primary = val<string>('ai_primary', 'deepseek');

  const engineTone = (id: 'deepseek' | 'claude') => {
    const byo = id === 'deepseek' ? s.deepseek_key_set : s.claude_key_set;
    if (byo) return { tone: 'byo' as const, text: 'Your key' };
    if (data.platform[id]) return { tone: 'live' as const, text: 'Included' };
    return { tone: 'off' as const, text: 'Not set' };
  };

  const engines = [
    {
      id: 'deepseek' as const,
      name: 'DeepSeek',
      logo: '/logos/deepseek.svg',
      role: 'Default engine',
      why: 'Handles every invoice, expense and GST question. Roughly a tenth of the cost per request, which is why it answers first.',
      console: 'https://platform.deepseek.com/api_keys',
      keyPlaceholder: 'sk-…',
      modelKey: 'deepseek_model' as const,
      secretKey: 'deepseek_key',
      mask: s.deepseek_key_mask,
      isSet: s.deepseek_key_set,
      caveat: 'Text only — it cannot read receipt photos.',
    },
    {
      id: 'claude' as const,
      name: 'Claude',
      logo: '/logos/claude.svg',
      role: 'Fallback + vision',
      why: 'Takes over when DeepSeek is down, and always handles attached receipts and challans because it can read images.',
      console: 'https://console.anthropic.com/settings/keys',
      keyPlaceholder: 'sk-ant-…',
      modelKey: 'claude_model' as const,
      secretKey: 'claude_key',
      mask: s.claude_key_mask,
      isSet: s.claude_key_set,
      caveat: 'Reads photos of bills, challans and screenshots.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Which brain answers, and where you can talk to it from."
        hint={`${PRODUCT.name} ships with working AI keys. Add your own to pay the model provider directly instead of us — your key overrides ours the moment you save it.`}>
        {dirty && <button className="btn-subtle btn-sm" onClick={() => setPatch({})}>Discard</button>}
        <button className="btn-primary" onClick={save} disabled={busy || !dirty}>
          {busy ? <Spinner /> : <><Save size={15} /> Save changes</>}
        </button>
      </PageHeader>

      {!data.encryptionReady && (
        <div className="mb-5 flex items-start gap-3 rounded-[10px] border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-[12.5px] leading-relaxed text-amber-200">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          <span>
            <strong className="text-amber-100">APP_ENCRYPTION_KEY is missing</strong>, so your own keys cannot be
            stored yet. Generate one and add it to <code className="font-mono text-[11.5px]">.env.local</code> and Vercel:
            <code className="mt-1.5 block rounded-[5px] bg-ink-800/80 px-2 py-1 font-mono text-[11px] text-amber-100">
              node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
            </code>
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------- engines */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-bold text-white">
          <Zap size={14} className="text-blue-300" /> AI engine
          <InfoHint side="bottom" tip="Requests go to the default engine first. If it errors or times out, the same question is retried on the other one — you do not have to do anything." />
        </h2>
        <div className="flex items-center gap-3">
          <Toggle
            checked={val<boolean>('ai_fallback_enabled', true)}
            onChange={(v) => set('ai_fallback_enabled', v)}
            label="Auto-fallback"
          />
        </div>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        {engines.map((e) => {
          const badge = engineTone(e.id);
          const t = tests[e.id];
          const isPrimary = primary === e.id;
          return (
            <section key={e.id} className={`card ${isPrimary ? 'ring-1 ring-inset ring-blue/30' : ''}`}>
              <header className="flex items-start gap-3 border-b border-line/80 px-5 py-3.5">
                <Mark src={e.logo} alt={e.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-bold leading-tight text-white">{e.name}</h3>
                    <Badge tone={badge.tone}>{badge.text}</Badge>
                    {isPrimary && <Badge tone="warn">Answers first</Badge>}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-chrome">
                    {e.role}
                    <InfoHint tip={e.why} />
                  </p>
                </div>
                <button
                  className="btn-ghost btn-xs shrink-0"
                  disabled={testing === e.id || (!badge.text.includes('key') && badge.tone === 'off')}
                  onClick={() => test(e.id)}>
                  {testing === e.id ? <Spinner size={12} /> : <RefreshCw size={12} />} Test
                </button>
              </header>

              <div className="space-y-4 p-5">
                <SecretField
                  label="Your API key"
                  tip={<>Stored encrypted (AES-256-GCM) and never sent back to this page. Get one at <span className="font-mono">{new URL(e.console).host}</span>.</>}
                  hint={e.caveat}
                  mask={e.mask}
                  isSet={e.isSet}
                  value={secret(e.secretKey)}
                  onChange={(v) => set(e.secretKey, v)}
                  onClear={() => set(e.secretKey, null)}
                  placeholder={e.keyPlaceholder}
                />

                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Field label="Model" hint={`Blank uses ${data.defaultModels[e.id]}`}>
                    <Input
                      className="input-mono"
                      placeholder={data.defaultModels[e.id]}
                      value={val<string>(e.modelKey, '') ?? ''}
                      onChange={(ev) => set(e.modelKey, ev.target.value)}
                    />
                  </Field>
                  <button
                    className={`btn-sm ${isPrimary ? 'btn-ghost' : 'btn-ghost'}`}
                    disabled={isPrimary}
                    onClick={() => set('ai_primary', e.id)}>
                    {isPrimary ? 'Default' : 'Make default'}
                  </button>
                </div>

                {t && (
                  <p className={`flex items-start gap-2 rounded-[7px] border px-3 py-2 text-[11.5px] leading-snug ${
                    t.ok
                      ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200'
                      : 'border-red-900/60 bg-red-950/30 text-red-200'}`}>
                    {t.ok ? <Check size={13} className="mt-px shrink-0" /> : <AlertTriangle size={13} className="mt-px shrink-0" />}
                    <span>
                      {t.ok
                        ? <>Answered in {t.ms}ms on <span className="font-mono">{t.model}</span>.</>
                        : t.error}
                    </span>
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- channels */}
      <h2 className="mb-4 flex items-center gap-2 text-[13px] font-bold text-white">
        <Plug size={14} className="text-blue-300" /> Channels
        <InfoHint side="bottom" tip="Bill from your phone without opening the app. Send a sentence to the bot and the invoice lands in your dashboard." />
      </h2>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        {/* ---- WhatsApp ---- */}
        <Card
          title={
            <span className="flex items-center gap-2.5">
              <Mark src="/logos/whatsapp.svg" alt="WhatsApp" /> WhatsApp
              {s.whatsapp_enabled ? <Badge tone="live">On</Badge> : <Badge tone="off">Off</Badge>}
            </span>
          }
          hint="Uses the Meta WhatsApp Cloud API. You need a Meta business app with a WhatsApp product and a test or verified number. Text messages only for now — send receipt photos through the dashboard chat instead."
          action={
            <Toggle
              checked={val<boolean>('whatsapp_enabled', false)}
              onChange={(v) => set('whatsapp_enabled', v)}
            />
          }>
          <div className="space-y-4">
            <CopyRow
              label="Webhook URL"
              value={`${origin}/api/channels/whatsapp`}
              tip="Paste into Meta → WhatsApp → Configuration → Callback URL."
            />
            <Field label="Verify token" tip="Any string you invent. Meta asks for the same value when it verifies the callback URL.">
              <Input
                className="input-mono"
                placeholder="a-string-you-choose"
                value={val<string>('whatsapp_verify_token', '') ?? ''}
                onChange={(e) => set('whatsapp_verify_token', e.target.value)}
              />
            </Field>
            <Field label="Phone number ID" tip="Meta → WhatsApp → API setup. A long numeric id, not the phone number itself.">
              <Input
                className="input-mono"
                placeholder="1234567890123456"
                value={val<string>('whatsapp_phone_number_id', '') ?? ''}
                onChange={(e) => set('whatsapp_phone_number_id', e.target.value)}
              />
            </Field>
            <SecretField
              label="Access token"
              tip="A permanent System User token — the 24-hour test token will expire on you mid-month."
              mask={s.whatsapp_token_mask}
              isSet={s.whatsapp_token_set}
              value={secret('whatsapp_token')}
              onChange={(v) => set('whatsapp_token', v)}
              onClear={() => set('whatsapp_token', null)}
              placeholder="EAAG…"
            />
            <Field
              label="Allowed numbers"
              tip="Only these numbers can create records. Leave empty and the webhook ignores everyone — a safe default, not a broken one."
              hint="Comma-separated, with country code: 919812345678">
              <Input
                className="input-mono"
                placeholder="919812345678, 919898989898"
                value={(val<string[]>('whatsapp_allowed_numbers', []) ?? []).join(', ')}
                onChange={(e) => set('whatsapp_allowed_numbers', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
              />
            </Field>
          </div>
        </Card>

        {/* ---- Telegram ---- */}
        <Card
          title={
            <span className="flex items-center gap-2.5">
              <Mark src="/logos/telegram.svg" alt="Telegram" /> Telegram
              {s.telegram_enabled ? <Badge tone="live">On</Badge> : <Badge tone="off">Off</Badge>}
            </span>
          }
          hint="Message @BotFather, send /newbot, and paste the token it gives you. Fastest of the two to get running."
          action={
            <Toggle
              checked={val<boolean>('telegram_enabled', false)}
              onChange={(v) => set('telegram_enabled', v)}
            />
          }>
          <div className="space-y-4">
            <CopyRow
              label="Webhook URL"
              value={`${origin}/api/channels/telegram`}
              tip="Register it once with the Telegram setWebhook API — the command is in the runbook below."
            />
            <Field label="Bot username" hint="Without the @">
              <Input
                className="input-mono"
                placeholder="my_munshi_bot"
                value={val<string>('telegram_bot_username', '') ?? ''}
                onChange={(e) => set('telegram_bot_username', e.target.value)}
              />
            </Field>
            <SecretField
              label="Bot token"
              tip="From BotFather. Looks like 123456789:AAH… — copy the whole line."
              mask={s.telegram_token_mask}
              isSet={s.telegram_token_set}
              value={secret('telegram_token')}
              onChange={(v) => set('telegram_token', v)}
              onClear={() => set('telegram_token', null)}
              placeholder="123456789:AAH…"
            />
            <Field
              label="Allowed chat IDs"
              tip="Send your bot any message, then open api.telegram.org/bot<token>/getUpdates to read your chat id. Empty means nobody is allowed."
              hint="Comma-separated numeric IDs">
              <Input
                className="input-mono"
                placeholder="123456789"
                value={(val<string[]>('telegram_allowed_chats', []) ?? []).join(', ')}
                onChange={(e) => set('telegram_allowed_chats', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
              />
            </Field>
          </div>
        </Card>
      </div>

      <Collapse
        title={<span className="flex items-center gap-2"><KeyRound size={13} className="text-chrome" /> How your keys are stored</span>}
        note="AES-256-GCM"
        className="mb-4">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-chrome">
          <li className="flex gap-2"><ShieldCheck size={14} className="mt-px shrink-0 text-emerald-400" />
            Encrypted with AES-256-GCM before it touches the database. The row holds ciphertext, an IV and an auth tag — never the key.</li>
          <li className="flex gap-2"><ShieldCheck size={14} className="mt-px shrink-0 text-emerald-400" />
            The table is closed to the browser at the database level. Only the server route can read it, and it returns a mask like <span className="font-mono text-chrome-light">sk-abc…3f9k</span>.</li>
          <li className="flex gap-2"><ShieldCheck size={14} className="mt-px shrink-0 text-emerald-400" />
            Deleting a key nulls the ciphertext. There is no archive and no recovery — paste a fresh one if you need it back.</li>
          <li className="flex gap-2"><ShieldCheck size={14} className="mt-px shrink-0 text-emerald-400" />
            Rotating <span className="font-mono text-chrome-light">APP_ENCRYPTION_KEY</span> makes stored keys unreadable. {PRODUCT.name} falls back to the platform key and asks you to re-paste rather than failing silently.</li>
        </ul>
      </Collapse>

      <Collapse
        title={<span className="flex items-center gap-2"><Plug size={13} className="text-chrome" /> Register the Telegram webhook</span>}
        note="one command">
        <p className="mb-2.5 text-[12.5px] leading-relaxed text-chrome">
          Telegram needs to be told where to deliver messages. Run this once after saving your token, replacing
          <span className="font-mono text-chrome-light"> &lt;TOKEN&gt;</span>:
        </p>
        <code className="block overflow-x-auto whitespace-pre rounded-[7px] border border-line bg-ink-800/80 px-3 py-2.5 font-mono text-[11.5px] text-blue-200">
          {`curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=${origin}/api/channels/telegram"`}
        </code>
      </Collapse>
    </>
  );
}
