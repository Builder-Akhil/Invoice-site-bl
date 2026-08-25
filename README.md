# Buildable Labs — Billing Portal

A self-hosted replacement for Zoho Billing, built for **BuildableLabs LLP**: clients, GST-compliant
invoices, quotes, retainers, expenses, input tax credit, GST filing records — and a Claude assistant
that turns a sentence into a draft invoice.

Brand system per *Buildable Labs Brand Foundation V01* — Alloy palette (`#0B3FDE` blue, chrome,
deep neutrals), Instrument Serif / Manrope / JetBrains Mono.

---

## Get it running (about 15 minutes)

### 1. Supabase — the database

1. Create a free project at [supabase.com](https://supabase.com) (region: Mumbai or Singapore).
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and **Run**.
   That creates every table, the atomic invoice-number function, payment triggers, row-level
   security, and seeds your service catalog plus the AAFM India client.
3. **Storage → New bucket** → name it `brand`, tick **Public**. (Logo + signature uploads.)
4. **Project Settings → API** — copy `Project URL`, the `anon public` key and the `service_role` key.

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Where it comes from | Needed for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | everything |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page | everything |
| `SUPABASE_SERVICE_ROLE_KEY` | same page (keep secret) | PDFs, email, public links, cron |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000`, later your live URL | share links in emails |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys | Send to client |
| `INVOICE_FROM_EMAIL` | e.g. `Buildable Labs <billing@buildablelabs.com>` | Send to client |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | the chat assistant |
| `CRON_SECRET` | any random string | recurring invoice cron |

### 3. Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, click **First time here? Create your account**, sign up with
`akhil@buildablelabs.com`. Then go to **Profile & Settings** and fill in your address, GSTIN,
bank details, logo and signature — everything there prints on the invoice.

> **Lock it down once your team has signed up:** Supabase → Authentication → Providers → Email →
> turn **Allow new users to sign up** off. Add teammates yourself under Authentication → Users.
> Every signed-in user shares one workspace — that is what the RLS policy in the schema does.

### 4. Deploy on Vercel

The production build is `npm run build`. Cron, Node version, and env templates are already set
for Vercel — you only paste secrets and point the live URL.

1. Push this repo to GitHub (see below), then import it at [vercel.com/new](https://vercel.com/new).
2. Framework: **Next.js** (auto-detected). Root directory: `.`
3. Paste every variable from `.env.example` into **Settings → Environment Variables**
   (Production + Preview). Use real keys — never commit `.env`.
4. Deploy once. Copy the URL (e.g. `https://invoice-site-bl.vercel.app`).
5. Set `NEXT_PUBLIC_APP_URL` to that URL and **redeploy** so emails and public invoice links
   are not still pointing at localhost.
6. In **Supabase → Authentication → URL Configuration**:
   - Site URL = your Vercel URL
   - Redirect URLs = `https://your-app.vercel.app/**` (and localhost for dev)
7. `vercel.json` already registers a daily **03:00 UTC** cron that generates due retainer
   invoices (`GET /api/cron/recurring`, guarded by `CRON_SECRET`). Hobby plans allow one
   daily cron — this schedule fits. Do not add a second cron in Supabase for the same job.

The assistant route allows 60s (`maxDuration`). Long chats can time out on the free Hobby
plan; Pro is the comfortable cockpit for Claude + tools.

For deliverability, verify `buildablelabs.com` in Resend (DNS records) so invoices arrive from
your own domain rather than a shared sender.

### GitHub accounts — switch from the command line

You can stay logged into several GitHub users (personal, Builder-Akhil, …) and pick the
active one like swapping pilots. No logout each time.

```bash
./scripts/gh-use.sh login              # add an account (others stay signed in)
./scripts/gh-use.sh Builder-Akhil      # fly as Builder-Akhil
./scripts/gh-use.sh AkhilKumar-Git     # fly as the other profile
./scripts/gh-use.sh                     # who is active
./scripts/gh-use.sh logout some-user   # drop one account only
```

Same thing via npm: `npm run gh:login` / `npm run gh:use -- Builder-Akhil` / `npm run gh:who`.

Commit name + email per GitHub user lives in `~/.config/gh-identities` (created on first
login). Switching applies it to **this repo only**, not your global git identity.

GitHub CLI docs: [Using multiple accounts](https://docs.github.com/en/github-cli/github-cli/using-multiple-accounts).

---

## What's inside

**Dashboard** — net revenue for the financial year (ex-GST), outstanding, MRR from active
retainers, this month's GST position, a 12-month billed-vs-received chart, top clients, and an
overdue chase list.

**Clients** — contact person, work phone, CC emails, GST treatment (registered / unregistered /
consumer / overseas / SEZ with or without payment / deemed export), GSTIN with auto-derived PAN
and place of supply, billing and shipping addresses, payment terms, default SAC and GST rate, and
per-client TDS settings. Billed and outstanding totals per client.

**Services catalog** — reusable line items with SAC/HSN codes, unit (hour / month / project /
user…), rate and GST rate. Typing a name into an invoice line auto-fills the rest.

**Invoices & quotes**

- The number series continues from **BL-000017** automatically, assigned atomically at save so two
  people can never collide. One click switches to a manual number when a client mandates one.
- Per-line SAC/HSN code, quantity or hours, rate, discount, GST rate.
- Tax treatment auto-resolves from your state (Telangana, 36) against the place of supply:
  same state → **CGST + SGST**, different state → **IGST**, overseas or SEZ-under-LUT →
  **zero-rated** with the LUT declaration printed. Always overridable per invoice.
- Editable invoice date, terms (Due on receipt / Net 7–60 / Custom), due date, subject,
  PO number, notes, terms and internal notes.
- Multi-currency with an exchange rate that keeps INR reporting honest.
- Live preview of the exact document, print, PDF download.
- **Send** — Resend delivers it from your domain with the PDF attached, plus a public
  view-online link; status flips to Sent, then Viewed when the client opens it.
- **Record payment** — partial payments supported; a database trigger recalculates the balance
  and moves the invoice to Part paid / Paid / Overdue on its own.
- Duplicate, cancel, delete; quotes convert to invoices in one click.

**Retainers** — recurring profiles (weekly / monthly / quarterly / yearly) that generate draft
invoices on schedule and feed the MRR and ARR figures. "Run due now" generates on demand.

**Expenses** — vendor, GSTIN, category, HSN/SAC, taxable amount with a CGST+SGST / IGST / no-GST
split, ITC-claimable flag, reverse charge, multi-currency, optional rebill-to-client tag and
receipt link. Category breakdown and CSV export.

**GST & Tax** — monthly (GSTR-3B) or quarterly (QRMP) view of taxable outward supply, CGST, SGST,
IGST, zero-rated exports, input tax credit from expenses, and net payable. Record each payment
with challan number, ARN, interest and late fee; settled periods are marked. GSTR-1 style CSV
export per period.

**Assistant** — the bar at the bottom of every screen. Type *"Invoice AAFM India 2.5L for
Consulting CTO, Aug 15 – Sept 15"* and Claude matches the client, applies the right GST treatment,
and leaves a draft for you to review. It understands lakh/crore shorthand, pulls SAC codes from
your catalog, and will create a new client if you give it the details. `⌘K` opens it from anywhere.

---

## Two things worth knowing

**TDS is tracked, never deducted.** Your BL-000016 subtracted ₹25,000 "Amount Withheld" from the
total. As you asked, this portal keeps the invoice total at the full ₹2,95,000 — the legally
correct GST document value — and prints a line stating that TDS u/s 194J is to be deducted by the
recipient, showing the net remittance. When the money arrives short, record the payment as the net
amount received and log the TDS in the **TDS withheld** field; the dashboard's *TDS receivable*
figure is then your 26AS reconciliation.

**Cancel rather than delete.** GST rules expect an unbroken invoice series. Cancel keeps the number
in the series; Delete exists for genuine mistakes only.

---

## Project layout

```
supabase/schema.sql          full database, RLS, numbering + payment triggers
src/lib/gst.ts               state codes, CGST/SGST vs IGST engine, line + total maths
src/lib/format.ts            INR grouping, lakh/crore words, financial year, CSV
src/lib/invoice-service.ts   client-side save/load for invoices
src/lib/server-invoice.ts    server-side draft creation (used by the assistant)
src/lib/recurring.ts         retainer generation
src/lib/pdf/                 @react-pdf document + render helper
src/components/InvoicePaper  the on-screen document
src/app/(app)/               dashboard, invoices, quotes, clients, services,
                             retainers, expenses, GST, settings
src/app/i/[token]/           public client-facing invoice view
src/app/api/                 chat · pdf · send · cron
```

Verified before hand-off: the production build passes, and the GST engine and PDF renderer are
covered by checks reproducing BL-000016 (Telangana → Uttar Pradesh, 18% IGST), an intra-state
9 + 9 split, and a zero-rated export under LUT.
