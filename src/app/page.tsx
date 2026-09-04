import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight, ChevronDown, CreditCard, FileSignature, Fuel, Landmark, Lock,
  MessageSquare, Receipt, Repeat, ShieldCheck, Sparkles, UsersRound, Zap,
} from 'lucide-react';
import { PRODUCT, PLANS, PAID_FROM } from '@/lib/product';
import { LogoMark } from '@/components/Logo';
import Nav from '@/components/marketing/Nav';
import HeroDemo from '@/components/marketing/HeroDemo';
import Pricing from '@/components/marketing/Pricing';

export const metadata: Metadata = {
  title: `${PRODUCT.name} — ${PRODUCT.tagline}`,
  description: PRODUCT.blurb,
  keywords: [
    'GST invoicing software India', 'AI invoice generator', 'GST billing software for freelancers',
    'GSTR-1 GSTR-3B software', 'invoicing software for startups India', 'WhatsApp invoicing',
    'bring your own API key invoicing', 'SAC code invoice', 'CGST SGST IGST calculator',
    'invoice software for MSME', 'alternative to Zoho Books', 'self-hosted invoicing',
  ],
  alternates: { canonical: PRODUCT.url },
  openGraph: {
    type: 'website',
    url: PRODUCT.url,
    siteName: PRODUCT.name,
    title: `${PRODUCT.name} — ${PRODUCT.tagline}`,
    description: PRODUCT.blurb,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PRODUCT.name} — ${PRODUCT.tagline}`,
    description: PRODUCT.blurb,
    creator: PRODUCT.twitter,
  },
};

/* ------------------------------------------------------------------- data */

const STEPS = [
  {
    n: '01',
    title: 'Say it in plain English',
    body: '“Bill Acme 2.5L for the API build, Net 15.” No form, no dropdown hunting, no SAC lookup.',
  },
  {
    n: '02',
    title: 'It does the compliance part',
    body: 'Place of supply, IGST versus CGST + SGST, SAC code, due date, invoice number in your series.',
  },
  {
    n: '03',
    title: 'Your CA gets a clean pack',
    body: 'GSTR-1 and GSTR-3B ready CSVs, month by month, with the invoices behind every figure.',
  },
];

const FEATURES = [
  { icon: FileSignature, title: 'Invoices & quotes', body: 'Numbered series, PDF, public pay-link, email delivery.' },
  { icon: Landmark, title: 'GST that follows cash', body: 'Tax is due when the client pays — not the day you invoice.' },
  { icon: Repeat, title: 'Retainers on autopilot', body: 'Monthly invoices fire themselves. MRR on the dashboard.' },
  { icon: Receipt, title: 'Expenses & input credit', body: 'Photograph the bill. It files it and claims the ITC.' },
  { icon: UsersRound, title: 'Team payroll', body: 'Flexible pay lines, work-month scoring, salary expense on payout.' },
  { icon: Fuel, title: 'Runway you can trust', body: 'Cash ÷ real burn. It refuses to guess if you have not counted.' },
];

const GST_ROWS: [string, string, string][] = [
  ['Invoice raised, unpaid', 'Not your problem yet', 'Excluded'],
  ['Client paid', 'Tax collected', 'Included'],
  ['Company bill with GSTIN', 'Input credit', 'Deducted'],
  ['Export under LUT', 'Zero-rated', 'Reported, nil tax'],
];

const FAQ: [string, string][] = [
  [
    'Is this actually GST compliant?',
    'Yes. Every invoice carries the fields a tax invoice needs — your GSTIN, the client GSTIN, place of supply, SAC code per line, and the correct split into IGST or CGST + SGST based on the two states. Exports under a LUT print as zero-rated with your LUT number. You can export GSTR-1 and GSTR-3B ready CSVs for any month or quarter.',
  ],
  [
    'Do I need to understand GST to use it?',
    'No. That is the point. You describe the work and the amount; the software decides IGST versus CGST + SGST, picks the SAC code, and works out what you owe. The explanations sit behind small info icons if you ever want to check its reasoning.',
  ],
  [
    'What if the AI gets something wrong?',
    'The model never does arithmetic. It reads your sentence and fills in fields; every tax figure, total and due date is computed by ordinary deterministic code — the same code whether you type a sentence or use the form. Records land as drafts you approve before anything is sent.',
  ],
  [
    'What does "bring your own API key" mean?',
    `${PRODUCT.name} ships with working AI keys, so Pro works the moment you sign up. If you would rather pay DeepSeek or Anthropic directly — usually a few rupees a day — paste your own key on the Integrations page and it overrides ours instantly. Keys are encrypted with AES-256-GCM and never sent back to the browser.`,
  ],
  [
    'Why DeepSeek and not only Claude?',
    'DeepSeek costs roughly a tenth as much per request and is more than good enough for "bill Acme 2.5 lakh, Net 15". So it answers first, and Claude is the automatic fallback and handles anything with an attached photo, because it can read images. You can flip which one leads.',
  ],
  [
    'Can I really invoice over WhatsApp?',
    'Yes. Connect a WhatsApp Cloud API number or a Telegram bot, whitelist your own number, and send a sentence. The invoice appears in your dashboard. Useful when a client asks for the bill while you are in the back of a cab.',
  ],
  [
    'Can I bill clients in dollars?',
    'Yes. Foreign-currency invoices and subscriptions are stored in their own currency and converted to INR at the published rate for that date — so a $20 Cursor renewal never lands in your books as ₹20.',
  ],
  [
    'What happens when I hit 3 invoices on the Free plan?',
    'Issuing is paused for the rest of the month; drafts stay unlimited and free, so you can prepare everything and issue on the first. Nothing is deleted and nothing is held to ransom.',
  ],
  [
    'Do you file my returns for me?',
    'No — and be careful of anyone who says they will without a CA in the loop. We produce filing-ready packs so your CA spends minutes instead of a weekend. Your challan and ARN go back into the app so the month shows as settled.',
  ],
  [
    'Can I self-host it on my own infrastructure?',
    `The "Own It" plan. Your Supabase project, your Vercel account, your API keys, your data — plus a setup runbook an AI agent can execute in about half an hour. One payment, no per-seat pricing. Email ${PRODUCT.supportEmail}.`,
  ],
];

/* --------------------------------------------------------------- JSON-LD */

function StructuredData() {
  const graph = [
    {
      '@type': 'SoftwareApplication',
      '@id': `${PRODUCT.url}/#software`,
      name: PRODUCT.name,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Accounting and invoicing software',
      operatingSystem: 'Web browser',
      description: PRODUCT.blurb,
      url: PRODUCT.url,
      inLanguage: 'en-IN',
      audience: {
        '@type': 'Audience',
        audienceType: 'Founders, freelancers, SMEs and MSMEs in India',
        geographicArea: { '@type': 'Country', name: 'India' },
      },
      featureList: [
        'GST-compliant tax invoices with SAC codes',
        'Automatic IGST vs CGST + SGST from place of supply',
        'Natural-language invoicing via DeepSeek or Claude',
        'Receipt photo to expense with input tax credit',
        'GSTR-1 and GSTR-3B export packs',
        'Recurring retainers and MRR tracking',
        'WhatsApp and Telegram invoicing',
        'Bring your own AI API key',
        'Self-hosted deployment option',
      ],
      offers: PLANS.filter((p) => p.monthly != null).map((p) => ({
        '@type': 'Offer',
        name: p.name,
        price: String(p.monthly),
        priceCurrency: 'INR',
        description: p.pitch,
        url: `${PRODUCT.url}/#pricing`,
        ...(p.monthly === 0 ? {} : {
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: String(p.monthly),
            priceCurrency: 'INR',
            unitCode: 'MON',
          },
        }),
      })),
    },
    {
      '@type': 'Organization',
      '@id': `${PRODUCT.url}/#org`,
      name: PRODUCT.legalOwner,
      url: PRODUCT.url,
      email: PRODUCT.supportEmail,
      founder: { '@type': 'Person', name: PRODUCT.founder },
      address: { '@type': 'PostalAddress', addressCountry: 'IN' },
    },
    {
      '@type': 'WebSite',
      '@id': `${PRODUCT.url}/#website`,
      url: PRODUCT.url,
      name: PRODUCT.name,
      publisher: { '@id': `${PRODUCT.url}/#org` },
      inLanguage: 'en-IN',
    },
    {
      '@type': 'FAQPage',
      '@id': `${PRODUCT.url}/#faq`,
      mainEntity: FAQ.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      // Static, author-controlled payload — no user input reaches this string.
      dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }) }}
    />
  );
}

/* ------------------------------------------------------------------ page */

export default function LandingPage() {
  return (
    <>
      <StructuredData />
      <Nav />

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden">
        <div className="mk-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="mk-section relative grid items-center gap-10 py-14 lg:grid-cols-[1.03fr_1fr] lg:gap-14 lg:py-20">
          <div>
            <p className="mk-eyebrow">Invoicing for Indian founders</p>
            <h1 className="mt-4 font-display text-[44px] leading-[1.02] tracking-[-0.02em] text-white sm:text-[62px]">
              Bill a client in
              <br className="hidden sm:block" />{' '}
              <span className="text-blue-300">one sentence.</span>
            </h1>
            <p className="mt-5 max-w-[520px] text-[15.5px] leading-relaxed text-chrome-light">
              Type <span className="text-white">“bill Acme 2.5L for the API build, Net 15”</span>. {PRODUCT.name} raises the
              GST invoice, gets the tax split right, chases the payment and hands your CA a filing-ready pack.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn-primary h-[40px] px-5 text-[14px]">
                Start free <ArrowRight size={15} />
              </Link>
              <a href="#how" className="btn-ghost h-[40px] px-5 text-[14px]">See how it works</a>
            </div>

            <p className="mt-4 text-[12.5px] text-chrome">
              3 invoices a month free, forever. No card. Pro from ₹{PAID_FROM}/month.
            </p>

            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-line/70 pt-5 text-[12px] text-chrome">
              {['GSTR-1 & 3B packs', 'CGST / SGST / IGST', 'Exports under LUT', 'Your keys, your data'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-emerald-400" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:pl-2">
            <HeroDemo />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- runs-on strip */}
      <section className="border-y border-line/70 bg-ink-800/30 py-7">
        <div className="mk-section flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
          <span className="label-mono">Runs on</span>
          {[
            { src: '/logos/deepseek.svg', label: 'DeepSeek', note: 'default engine' },
            { src: '/logos/claude.svg', label: 'Claude', note: 'fallback + reads receipts' },
            { src: '/logos/whatsapp.svg', label: 'WhatsApp', note: 'bill from your phone' },
            { src: '/logos/telegram.svg', label: 'Telegram', note: 'bot in 2 minutes' },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.src} alt="" width={20} height={20} className="h-5 w-5 object-contain" aria-hidden />
              <span className="leading-tight">
                <span className="block text-[13px] font-semibold text-white">{l.label}</span>
                <span className="block text-[10.5px] text-chrome">{l.note}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- how */}
      <section id="how" className="mk-section scroll-mt-20 py-16 sm:py-20">
        <p className="mk-eyebrow">How it works</p>
        <h2 className="mk-h2 mt-3 max-w-[620px]">Three steps, and two of them are not yours.</h2>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="card p-5">
              <span className="font-mono text-[11px] tracking-[0.14em] text-blue-300">{s.n}</span>
              <h3 className="mt-3 text-[15px] font-bold text-white">{s.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-chrome">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- features */}
      <section className="mk-section pb-16 sm:pb-20">
        <div className="mk-rule mb-14" />
        <p className="mk-eyebrow">The whole desk</p>
        <h2 className="mk-h2 mt-3 max-w-[640px]">Everything a small company actually bills, spends and owes.</h2>

        <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-ink-700/60 p-5 transition-colors hover:bg-ink-600/60">
              <f.icon size={17} strokeWidth={1.7} className="text-blue-300" />
              <h3 className="mt-3.5 text-[14px] font-bold text-white">{f.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-chrome">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- GST */}
      <section id="gst" className="scroll-mt-20 border-y border-line/70 bg-ink-800/30 py-16 sm:py-20">
        <div className="mk-section grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
          <div>
            <p className="mk-eyebrow">The part everyone gets wrong</p>
            <h2 className="mk-h2 mt-3">You owe GST when the money lands.</h2>
            <p className="mk-lede mt-5 max-w-[460px]">
              Most tools bill you tax the day you raise the invoice. So founders pay the Government out of pocket for
              work a client has not paid for yet. {PRODUCT.name} follows the cash instead.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <span className="chip"><Lock size={12} /> Unpaid invoices excluded</span>
              <span className="chip"><Zap size={12} /> Input credit netted off</span>
              <span className="chip"><Landmark size={12} /> Monthly or QRMP</span>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-line/80 px-5 py-3">
              <h3 className="text-[13px] font-bold text-white">What counts toward this month</h3>
            </div>
            <table className="w-full">
              <tbody>
                {GST_ROWS.map(([what, meaning, verdict]) => (
                  <tr key={what} className="border-t border-line/60 first:border-t-0">
                    <td className="px-5 py-3 text-[12.5px] text-[#C9CEDA]">{what}</td>
                    <td className="px-3 py-3 text-[12px] text-chrome">{meaning}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`pill ${
                        verdict === 'Included' ? 'bg-emerald-500/15 text-emerald-300'
                          : verdict === 'Deducted' ? 'bg-blue/15 text-blue-300'
                            : verdict === 'Excluded' ? 'bg-ink-400 text-chrome'
                              : 'bg-violet-500/15 text-violet-300'}`}>
                        {verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line/80 px-5 py-3 text-[11.5px] leading-snug text-chrome-dark">
              Same engine produces the GSTR-1 and GSTR-3B CSVs, so the pack always reconciles with the dashboard.
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- channels */}
      <section id="channels" className="mk-section scroll-mt-20 py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div className="order-2 lg:order-1">
            <div className="card p-5">
              <div className="space-y-3">
                <div className="flex justify-end">
                  <p className="max-w-[76%] rounded-[12px] rounded-br-[4px] bg-blue px-3.5 py-2.5 text-[13.5px] leading-snug text-white">
                    invoice AAFM 1.5L for the October workshop, net 7
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-ink-600 text-blue-300">
                    <Sparkles size={12} />
                  </span>
                  <div className="max-w-[80%] rounded-[12px] rounded-bl-[4px] border border-line bg-ink-800/70 px-3.5 py-2.5">
                    <p className="text-[13.5px] leading-snug text-[#D6DAE3]">
                      Drafted <span className="font-mono text-white">BL-000018</span> — ₹1,50,000 + ₹27,000 IGST.
                      Due 3 Sep. Send it?
                    </p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <p className="rounded-[12px] rounded-br-[4px] bg-blue px-3.5 py-2.5 text-[13.5px] text-white">yes</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-line/80 pt-3.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logos/whatsapp.svg" alt="" width={15} height={15} className="h-[15px] w-[15px]" aria-hidden />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logos/telegram.svg" alt="" width={15} height={15} className="h-[15px] w-[15px]" aria-hidden />
                <span className="text-[11.5px] text-chrome-dark">Whitelisted numbers only. Nobody else can reach your books.</span>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <p className="mk-eyebrow">WhatsApp & Telegram</p>
            <h2 className="mk-h2 mt-3">Bill from the back of a cab.</h2>
            <p className="mk-lede mt-5 max-w-[440px]">
              Connect a WhatsApp Cloud number or a Telegram bot, whitelist your own number, and send a sentence. The
              invoice is waiting in your dashboard when you get to a laptop.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                'Raise an invoice from a sentence, away from your desk',
                'Ask “who owes me money?” and get the list',
                'Approve or bin a draft with one word',
              ].map((t) => (
                <li key={t} className="flex gap-2.5 text-[13px] text-[#C9CEDA]">
                  <MessageSquare size={14} className="mt-0.5 shrink-0 text-blue-300" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- BYO */}
      <section className="border-y border-line/70 bg-ink-800/30 py-16 sm:py-20">
        <div className="mk-section">
          <div className="max-w-[620px]">
            <p className="mk-eyebrow">No AI markup</p>
            <h2 className="mk-h2 mt-3">Bring your own brain.</h2>
            <p className="mk-lede mt-5">
              Every other billing tool resells you AI at a margin. Paste your own DeepSeek or Claude key and you pay
              the model provider directly — usually a few rupees a day. Ours works out of the box if you would rather
              not bother.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Zap,
                title: 'Our keys, zero setup',
                body: 'Pro works the second you sign up. DeepSeek answers, Claude covers receipts and outages.',
              },
              {
                icon: CreditCard,
                title: 'Your keys, our software',
                body: 'Paste a key on the Integrations page. Encrypted with AES-256-GCM, never returned to the browser, overrides ours instantly.',
              },
              {
                icon: ShieldCheck,
                title: 'Your keys, your servers',
                body: 'The Own It plan hands over the whole stack — your Supabase, your Vercel, plus a runbook an AI agent finishes in half an hour.',
              },
            ].map((c) => (
              <div key={c.title} className="card p-5">
                <c.icon size={17} strokeWidth={1.7} className="text-blue-300" />
                <h3 className="mt-3.5 text-[14px] font-bold text-white">{c.title}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-chrome">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- pricing */}
      <section id="pricing" className="mk-section scroll-mt-20 py-16 sm:py-20">
        <div className="mb-10 text-center">
          <p className="mk-eyebrow">Pricing</p>
          <h2 className="mk-h2 mt-3">Cheaper than the hour you spend on it.</h2>
          <p className="mk-lede mx-auto mt-4 max-w-[520px]">
            No per-invoice fees, no per-seat tax, no locking your own data behind a tier.
          </p>
        </div>
        <Pricing />
      </section>

      {/* ------------------------------------------------------------- FAQ */}
      <section id="faq" className="mk-section scroll-mt-20 pb-16 sm:pb-20">
        <div className="mk-rule mb-14" />
        <div className="grid gap-10 lg:grid-cols-[340px_1fr] lg:gap-16">
          <div>
            <p className="mk-eyebrow">Questions</p>
            <h2 className="mk-h2 mt-3">Straight answers.</h2>
            <p className="mt-5 text-[13px] leading-relaxed text-chrome">
              Something not here? Email{' '}
              <a href={`mailto:${PRODUCT.supportEmail}`} className="link">{PRODUCT.supportEmail}</a> — it reaches a
              person, not a queue.
            </p>
          </div>

          <div className="divide-y divide-line/70 border-y border-line/70">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-4 py-4 text-[14px] font-semibold text-white [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown size={15} className="ml-auto shrink-0 text-chrome transition-transform group-open:rotate-180" />
                </summary>
                <p className="pb-5 pr-8 text-[13px] leading-relaxed text-chrome">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA */}
      <section className="border-t border-line/70">
        <div className="mk-section py-16 text-center sm:py-20">
          <LogoMark size={38} />
          <h2 className="mk-h2 mx-auto mt-6 max-w-[560px]">Your next invoice is one sentence away.</h2>
          <p className="mk-lede mx-auto mt-4 max-w-[440px]">
            Three a month, free, forever. Upgrade the day it starts saving you an evening.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn-primary h-[40px] px-5 text-[14px]">
              Start free <ArrowRight size={15} />
            </Link>
            <a href={`mailto:${PRODUCT.supportEmail}?subject=${encodeURIComponent(`${PRODUCT.name} — self-hosted`)}`}
              className="btn-ghost h-[40px] px-5 text-[14px]">
              Talk about self-hosting
            </a>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-line/70 bg-ink-800/40">
        <div className="mk-section flex flex-wrap items-center gap-x-6 gap-y-3 py-7">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span className="text-[13px] font-bold text-white">{PRODUCT.name}</span>
          </div>
          <p className="text-[11.5px] text-chrome-dark">
            by {PRODUCT.legalOwner} · {PRODUCT.founder}
          </p>
          <nav className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-chrome">
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
            <Link href="/login" className="hover:text-white">Sign in</Link>
            <a href={`mailto:${PRODUCT.supportEmail}`} className="hover:text-white">{PRODUCT.supportEmail}</a>
          </nav>
        </div>
        <div className="mk-section border-t border-line/60 py-4">
          <p className="text-[11px] leading-relaxed text-chrome-dark">
            {PRODUCT.name} produces filing-ready GST packs; it is not a substitute for your chartered accountant and
            does not file returns on your behalf. GST rates, SAC codes and thresholds change — confirm treatment with
            your CA before filing.
          </p>
        </div>
      </footer>
    </>
  );
}
