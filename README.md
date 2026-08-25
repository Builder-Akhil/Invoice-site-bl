# Buildable Labs — Billing

The invoicing and GST desk for **Buildable Labs LLP**. It replaced Zoho Billing: raise invoices, track who has paid, log expenses, keep GST numbers honest, and talk to an assistant that can actually save records — not just chat.

Think of it as the flight log for money: every invoice, payment, and expense in one cockpit. You do not need to know how the aircraft is built to fly it.

Live code: [github.com/Builder-Akhil/Invoice-site-bl](https://github.com/Builder-Akhil/Invoice-site-bl)

---

## For the team (no coding needed)

Sign in at the website, then use the left menu. The assistant bar sits at the bottom of every screen (`⌘K` / `Ctrl+K` opens it).

### What each screen is for

| Screen | What it is, in plain English |
|---|---|
| **Dashboard** | This year’s revenue, money still owed, monthly retainers (MRR), GST position, overdue list. |
| **Clients** | Who you bill — GSTIN, Indian vs overseas, payment terms, addresses. |
| **Services** | Your rate card (CTO retainer, advisory hours, and so on). Typing a name on an invoice fills the rest. |
| **Invoices** | Bills you have raised. Status, total, balance. Pencil on the row flips **Paid / Unpaid** if a payment got stuck or was recorded wrong. |
| **Quotes** | Estimates. One click turns an accepted quote into an invoice. |
| **Retainers** | Recurring work (monthly / quarterly / yearly). The system drafts the next invoice on schedule. |
| **Expenses** | Money the LLP spent — software, travel, hotels, reimbursements to the founder. Marks whether GST credit (ITC) can be claimed. |
| **GST & Tax** | Period view of tax you charged, credit from expenses, cash paid to the department, challan / ARN. |
| **Chats** | Saved conversations with the assistant, including screenshots you attached. |
| **Settings** | Company name, GSTIN, bank, logo, signature — everything that prints on the invoice. |

### Invoices, in practice

1. **New invoice** — pick a client, add lines, save. GST (CGST+SGST vs IGST vs export under LUT) is chosen from *your* state vs the client’s place of supply. You can override it.
2. **Send** — emails the PDF from your domain and gives the client a view-online link. Status becomes Sent, then Viewed when they open it.
3. **Paid** — record a payment on the invoice, **or** tap the pencil on the Invoices list and choose Paid / Unpaid. Unpaid clears a wrong or stuck payment.
4. **Partial payments** are allowed. The balance updates on its own.
5. **Cancel, don’t delete**, if the invoice already has a number. GST expects an unbroken series (BL-000001, BL-000002…). Delete is only for a genuine mistake before it went out.

Numbers are issued automatically (next is **BL-000017** onwards) so two people cannot grab the same number.

**TDS is shown, never subtracted from the GST total.** The invoice stays at the full taxable value (for example ₹2,95,000). A line tells the client that TDS u/s 194J is theirs to deduct. When they pay short, record what actually landed and put the withheld amount in **TDS withheld** — that is your 26AS check.

### Expenses and “the LLP paid me back”

If you paid Airbnb or a hotel from your pocket (or moved the same amount from the LLP account to your savings), log it as a **Travel** expense with payment mode **Reimbursement**. That is company travel, not a loan the LLP owes you as founder.

Airbnb and most foreign platforms have **no Indian GSTIN**, so GST credit is usually **not claimable**. Indian software bills with a GSTIN usually **are**.

### Retainers (recurring invoices)

Set the client, amount, and cadence. A nightly job (3:00 UTC on Vercel) drafts invoices that are due. On your laptop that job does not run — use **Retainers → Run due now**, or ask the assistant.

This is **not** a second cron in Supabase. One alarm only, or you would raise two invoices for the same month.

### The assistant

Describe what you want in English, attach a screenshot of a receipt or rate card, or tap the mic and speak. Pause when you are done — the words fill the box; **you** press send (it does not send on its own).

It can:

- Create a **client**
- Draft an **invoice** or **quote**
- Log an **expense** (including founder reimbursement)
- Record a **GST payment** or **ITC credit**
- Create a **retainer**, or run due retainers
- Mark an invoice **paid / unpaid**

It understands “2.5L”, “50k”, “1cr”. After it *actually* saves something, you get a card in the chat — tap it to open the record. If you only see “Done.” and no card, nothing was written; ask again or add the amount and date.

**Examples**

- *Invoice AAFM India 2.5L for Consulting CTO, 15 Aug – 15 Sept*
- *Log Cursor Pro ₹2,000 as software, ITC eligible*
- *Log this Airbnb as travel, reimbursement, no GST* (attach the receipt)
- *GSTR-3B Aug 2026, ₹18,000 IGST paid, ₹5,000 ITC*
- *Monthly retainer for AAFM at 2.5L on the 1st*

Chats are saved under **Chats**. History, images, and voice live there.

### Not built yet

Recurring **expenses** (a hotel that repeats every month on a timer). Retainers only generate **invoices** (money in). Monthly spend is still logged by hand or via chat each time.

---

## For developers

Stack: **Next.js 14**, **Supabase** (Postgres + Auth), **Claude** (Anthropic), **Resend** (email), **Vercel** (hosting + daily cron). Node 18.18+.

### Clone and run locally

```bash
git clone https://github.com/Builder-Akhil/Invoice-site-bl.git
cd Invoice-site-bl
npm install
cp .env.example .env.local
# fill .env.local — see table below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). First visit: **Create your account**, then **Settings** for GSTIN, bank, logo.

Optional: copy `.env.example` to `.env` if you prefer that filename; both `.env` and `.env.local` are gitignored. **Never commit real keys.**

### Environment variables

| Variable | Where it comes from | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | App + database |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page | Browser sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | same page (secret) | PDFs, public invoice links, email, cron |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000`, then the live Vercel URL | Links in emails |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys | Send invoice to client |
| `INVOICE_FROM_EMAIL` | Verified domain, e.g. `Buildable Labs <billing@updates.buildablelabs.com>` | From address |
| `INVOICE_BCC_EMAIL` | Optional | BCC a copy to yourself |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Assistant |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-5` | Which Claude |
| `CRON_SECRET` | Any long random string | Protects `/api/cron/recurring` |

### Supabase (once per project)

1. Create a project ([supabase.com](https://supabase.com)) — Mumbai or Singapore is fine.
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**. Tables, invoice numbering, payment triggers, RLS, the public `brand` storage bucket (logo + signature), and seed catalog.
3. Copy URL, anon key, and service-role key into `.env.local`.
4. After the team has accounts: **Authentication → Providers → Email** → turn **Allow new users to sign up** off. Invite people under **Authentication → Users**. Everyone signed in shares one workspace.

**Auth URLs** (needed on Vercel): Site URL = your live app URL. Redirect URLs = `https://your-app.vercel.app/**` and `http://localhost:3000/**`.

Zoho CSV seed (local only — those files are gitignored because they hold real GSTINs and emails):

```bash
node --env-file=.env scripts/seed-zoho.mjs
```

### Deploy on Vercel

`npm run build` is what Vercel runs. Cron and Node version are already in the repo.

1. Push `main` to [Builder-Akhil/Invoice-site-bl](https://github.com/Builder-Akhil/Invoice-site-bl) (keep the GitHub repo **private** if you can — this is a billing app).
2. Import at [vercel.com/new](https://vercel.com/new). Framework: Next.js. Root: `.`
3. Paste every variable from `.env.example` into **Settings → Environment Variables** (Production + Preview), with **real** secrets.
4. Deploy once, copy the URL, set `NEXT_PUBLIC_APP_URL` to it, **redeploy**.
5. Point Supabase Site URL / redirects at that URL.
6. Verify `buildablelabs.com` in Resend (DNS) so mail is not stuck on a shared sender.

`vercel.json` registers `GET /api/cron/recurring` daily at **03:00 UTC**, guarded by `CRON_SECRET`. Hobby allows one daily cron — this fits. Do **not** add pg_cron in Supabase for the same job.

Chat is allowed 60 seconds (`maxDuration`). Long receipt + tools runs are more comfortable on Vercel Pro; Hobby can time out.

### GitHub accounts (no login/logout every time)

Stay signed into several users and switch:

```bash
./scripts/gh-use.sh login              # add an account; others stay
./scripts/gh-use.sh Builder-Akhil      # use this project’s account
./scripts/gh-use.sh                     # who is active
./scripts/gh-use.sh logout some-user   # drop one account only
```

Or `npm run gh:login` / `npm run gh:use -- Builder-Akhil` / `npm run gh:who`.

Commit name and email per GitHub user: `~/.config/gh-identities` (this repo only). Docs: [Using multiple accounts](https://docs.github.com/en/github-cli/github-cli/using-multiple-accounts).

### Useful scripts

```bash
npm run dev          # local app
npm run build        # production build (same as Vercel)
npx tsx --env-file=.env scripts/verify-assistant-tools.ts
                     # live-check chat tools (expense, client, GST, invoice), then deletes the test rows
```

### Layout

```
supabase/schema.sql          database, RLS, numbering, payment triggers
src/lib/gst.ts               CGST+SGST vs IGST vs LUT
src/lib/assistant-tools.ts   chat tools (client, invoice, expense, GST, retainer, paid)
src/lib/invoice-status.ts    Paid / Unpaid from the list or chat
src/lib/recurring.ts         retainer → draft invoice
src/lib/chat.ts              images, voice, history helpers
src/app/api/chat             assistant
src/app/api/cron/recurring   nightly retainers
src/app/(app)/               signed-in pages
src/app/i/[token]/           public invoice link for the client
scripts/gh-use.sh            GitHub profile switch
scripts/seed-zoho.mjs        optional CSV import (local)
```

### GST engine (quick)

Supplier is Telangana (36). Same state as the client → CGST + SGST. Other Indian state → IGST. Overseas / SEZ under LUT → zero-rated. Always overridable on the invoice. The PDF and on-screen paper share the same figures.
