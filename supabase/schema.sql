-- ============================================================================
-- BUILDABLE LABS LLP — BILLING PORTAL
-- Supabase / Postgres schema.  Run this whole file once in:
--   Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to re-run (everything is IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. COMPANY PROFILE  (single row, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists company_profile (
  id                int primary key default 1 check (id = 1),
  legal_name        text not null default 'BuildableLabs LLP',
  trade_name        text default 'Buildable Labs',
  entity_type       text not null default 'LLP',          -- LLP / Pvt Ltd / Proprietorship
  gstin             text default '36ABHFB0187F1ZL',
  pan               text,
  cin_llpin         text,
  contact_person    text default 'Akhil Kumar Alampally',
  designation       text default 'Designated Partner',
  email             text default 'akhil@buildablelabs.com',
  phone             text,
  website           text default 'https://www.buildablelabs.com',
  address_line1     text,
  address_line2     text,
  city              text,
  state             text default 'Telangana',
  state_code        text default '36',
  pincode           text,
  country           text default 'India',
  logo_url          text default '/buildable-labs-payment-logo.png',
  signature_url     text,
  signatory_name    text default 'Akhil Kumar Alampally',
  -- banking (printed on every invoice)
  bank_account_name text default 'BUILDABLELABS LLP',
  bank_account_no   text,
  bank_ifsc         text,
  bank_swift        text,
  bank_name         text,
  bank_branch       text,
  beneficiary_name  text,
  upi_id            text,
  -- document defaults
  invoice_prefix    text not null default 'BL-',
  invoice_padding   int  not null default 6,
  next_invoice_no   int  not null default 17,
  quote_prefix      text not null default 'BLQ-',
  quote_padding     int  not null default 4,
  next_quote_no     int  not null default 1,
  default_due_days  int  not null default 7,
  default_terms     text default 'Payment due within 7 days of invoice date.',
  default_notes     text,
  default_sac       text default '998314',
  default_gst_rate  numeric(5,2) not null default 18,
  lut_number        text,                                  -- for zero-rated exports
  fy_start_month    int not null default 4,                -- April
  cash_on_hand      numeric(14,2),                         -- typed in Settings; null = not set (do not fake runway)
  updated_at        timestamptz not null default now()
);

insert into company_profile (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. CLIENTS
-- ---------------------------------------------------------------------------
create table if not exists clients (
  id                uuid primary key default gen_random_uuid(),
  company_name      text not null,
  display_name      text,
  contact_person    text,               -- person representing the company
  contact_designation text,
  email             text,
  cc_emails         text,               -- comma separated
  work_phone        text,
  mobile            text,
  website           text,
  -- GST
  gst_treatment     text not null default 'registered_business',
    -- registered_business | unregistered_business | consumer | overseas
    -- | sez_with_payment | sez_without_payment | deemed_export
  gstin             text,
  pan               text,
  place_of_supply_state text default 'Telangana',
  place_of_supply_code  text default '36',
  is_overseas       boolean not null default false,
  currency          text not null default 'INR',
  -- billing address
  bill_attention    text,
  bill_line1        text,
  bill_line2        text,
  bill_city         text,
  bill_state        text,
  bill_pincode      text,
  bill_country      text default 'India',
  -- shipping (optional)
  ship_same_as_bill boolean not null default true,
  ship_line1        text,
  ship_line2        text,
  ship_city         text,
  ship_state        text,
  ship_pincode      text,
  ship_country      text,
  -- commercial defaults
  payment_terms_days int not null default 7,
  default_sac       text,
  default_gst_rate  numeric(5,2) default 18,
  tds_applicable    boolean not null default false,
  tds_section       text default '194J',
  tds_rate          numeric(5,2) default 10,
  opening_balance   numeric(14,2) not null default 0,
  status            text not null default 'active',   -- active | inactive
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists clients_name_idx on clients (lower(company_name));

-- ---------------------------------------------------------------------------
-- 3. SERVICE / ITEM CATALOG  (SAC & HSN codes for GST compliance)
-- ---------------------------------------------------------------------------
create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  kind          text not null default 'service',    -- service | goods
  code_type     text not null default 'SAC',        -- SAC | HSN
  code          text,                               -- e.g. 998314 / 999293
  unit          text not null default 'qty',        -- qty | hour | day | month | project | user
  rate          numeric(14,2) not null default 0,
  currency      text not null default 'INR',
  gst_rate      numeric(5,2) not null default 18,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. INVOICES  (doc_type = invoice | quote)
-- ---------------------------------------------------------------------------
create table if not exists invoices (
  id                uuid primary key default gen_random_uuid(),
  doc_type          text not null default 'invoice',   -- invoice | quote
  invoice_number    text not null,
  client_id         uuid references clients(id) on delete restrict,
  -- frozen client snapshot so historic invoices never change
  client_snapshot   jsonb,
  invoice_date      date not null default current_date,
  due_date          date,
  terms_label       text default 'Due on Receipt',
  subject           text,
  place_of_supply       text,
  place_of_supply_code  text,
  tax_mode          text not null default 'inter',
    -- intra (CGST+SGST) | inter (IGST) | export_lut (0%) | export_paid (IGST) | exempt
  reverse_charge    boolean not null default false,
  lut_number        text,
  currency          text not null default 'INR',
  exchange_rate     numeric(14,6) not null default 1,   -- to INR, for reporting
  status            text not null default 'draft',
    -- draft | sent | viewed | partially_paid | paid | overdue | cancelled | accepted | declined
  subtotal          numeric(14,2) not null default 0,
  discount_total    numeric(14,2) not null default 0,
  cgst_total        numeric(14,2) not null default 0,
  sgst_total        numeric(14,2) not null default 0,
  igst_total        numeric(14,2) not null default 0,
  cess_total        numeric(14,2) not null default 0,
  tax_total         numeric(14,2) not null default 0,
  round_off         numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  amount_paid       numeric(14,2) not null default 0,
  balance_due       numeric(14,2) not null default 0,
  -- TDS is informational only (client deducts it) — never reduces the invoice total
  tds_applicable    boolean not null default false,
  tds_section       text,
  tds_rate          numeric(5,2) default 0,
  tds_amount        numeric(14,2) not null default 0,
  notes             text,
  terms             text,
  internal_notes    text,
  po_number         text,
  public_token      text unique default encode(gen_random_bytes(16), 'hex'),
  sent_at           timestamptz,
  viewed_at         timestamptz,
  paid_at           timestamptz,
  recurring_id      uuid,
  converted_from    uuid,                              -- quote -> invoice link
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists invoices_number_idx on invoices (invoice_number);
create index if not exists invoices_client_idx on invoices (client_id);
create index if not exists invoices_date_idx on invoices (invoice_date);
create index if not exists invoices_status_idx on invoices (status);

create table if not exists invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  position      int not null default 0,
  item_id       uuid references items(id) on delete set null,
  name          text not null,
  description   text,
  code_type     text default 'SAC',
  code          text,
  unit          text default 'qty',
  quantity      numeric(14,3) not null default 1,
  rate          numeric(14,2) not null default 0,
  discount_pct  numeric(5,2) not null default 0,
  taxable_value numeric(14,2) not null default 0,
  gst_rate      numeric(5,2) not null default 18,
  cgst_amount   numeric(14,2) not null default 0,
  sgst_amount   numeric(14,2) not null default 0,
  igst_amount   numeric(14,2) not null default 0,
  cess_rate     numeric(5,2) not null default 0,
  cess_amount   numeric(14,2) not null default 0,
  line_total    numeric(14,2) not null default 0
);
create index if not exists invoice_items_inv_idx on invoice_items (invoice_id);

-- ---------------------------------------------------------------------------
-- 5. PAYMENTS RECEIVED
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  client_id     uuid references clients(id) on delete set null,
  payment_date  date not null default current_date,
  amount        numeric(14,2) not null,
  currency      text not null default 'INR',
  exchange_rate numeric(14,6) not null default 1,
  mode          text not null default 'bank_transfer', -- bank_transfer | upi | cheque | card | cash | wire | other
  reference     text,
  deposit_to    text,
  tds_deducted  numeric(14,2) not null default 0,
  bank_charges  numeric(14,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists payments_invoice_idx on payments (invoice_id);

-- ---------------------------------------------------------------------------
-- 6. EXPENSES  (organisation cost + input tax credit)
-- ---------------------------------------------------------------------------
create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  expense_date  date not null default current_date,
  vendor_name   text not null,
  vendor_gstin  text,
  category      text not null default 'Software & Subscriptions',
  description   text,
  bill_number   text,
  code          text,                                  -- HSN/SAC of the purchase
  taxable_amount numeric(14,2) not null default 0,
  gst_rate      numeric(5,2) not null default 0,
  cgst_amount   numeric(14,2) not null default 0,
  sgst_amount   numeric(14,2) not null default 0,
  igst_amount   numeric(14,2) not null default 0,
  total_amount  numeric(14,2) not null default 0,
  itc_eligible  boolean not null default true,
  is_reverse_charge boolean not null default false,
  currency      text not null default 'INR',
  exchange_rate numeric(14,6) not null default 1,
  payment_mode  text default 'bank_transfer',
  paid_by       text,
  reference     text,
  billable_to   uuid references clients(id) on delete set null,
  attachment_url text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists expenses_date_idx on expenses (expense_date);

-- ---------------------------------------------------------------------------
-- 7. GST PAYMENTS / FILINGS
-- ---------------------------------------------------------------------------
create table if not exists gst_payments (
  id            uuid primary key default gen_random_uuid(),
  period_type   text not null default 'monthly',      -- monthly | quarterly
  period        text not null,                        -- '2026-08' or '2026-Q2'
  return_type   text not null default 'GSTR-3B',      -- GSTR-1 | GSTR-3B | GSTR-9 | DRC-03
  filed_on      date,
  paid_on       date,
  challan_no    text,
  igst_paid     numeric(14,2) not null default 0,
  cgst_paid     numeric(14,2) not null default 0,
  sgst_paid     numeric(14,2) not null default 0,
  cess_paid     numeric(14,2) not null default 0,
  interest      numeric(14,2) not null default 0,
  late_fee      numeric(14,2) not null default 0,
  itc_utilised  numeric(14,2) not null default 0,
  total_paid    numeric(14,2) not null default 0,
  status        text not null default 'paid',          -- pending | paid | filed
  arn           text,
  notes         text,
  created_at    timestamptz not null default now()
);
create unique index if not exists gst_period_idx on gst_payments (period, return_type);

-- ---------------------------------------------------------------------------
-- 8. RECURRING PROFILES  (retainers -> MRR)
-- ---------------------------------------------------------------------------
create table if not exists recurring_profiles (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  client_id     uuid not null references clients(id) on delete cascade,
  frequency     text not null default 'monthly',       -- weekly | monthly | quarterly | yearly
  start_date    date not null default current_date,
  end_date      date,
  next_run_date date not null default current_date,
  day_of_month  int default 1,
  currency      text not null default 'INR',
  amount        numeric(14,2) not null default 0,      -- cached monthly value for MRR
  line_items    jsonb not null default '[]'::jsonb,
  subject       text,
  notes         text,
  terms         text,
  due_days      int not null default 7,
  auto_send     boolean not null default false,
  is_active     boolean not null default true,
  last_run_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8b. TEAM  (flexible contract pay lines in JSONB — not frozen columns)
-- ---------------------------------------------------------------------------
create table if not exists team_members (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  role           text,
  email          text,
  start_date     date,
  is_active      boolean not null default true,
  notes          text,
  currency       text not null default 'INR',
  exchange_rate  numeric(14,6) not null default 1,
  components     jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists payroll_items (
  id              uuid primary key default gen_random_uuid(),
  team_member_id  uuid not null references team_members(id) on delete cascade,
  period          text not null,                          -- YYYY-MM of the *work* month
  lines           jsonb not null default '[]'::jsonb,     -- snapshot + this month's score / rupees
  total           numeric(14,2) not null default 0,
  status          text not null default 'planned',        -- planned | paid
  paid_on         date,
  expense_id      uuid references expenses(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (team_member_id, period)
);
create index if not exists payroll_items_period_idx on payroll_items (period);

-- ---------------------------------------------------------------------------
-- 8c. RECURRING VENDOR SPEND  (subscriptions — money out, not retainers)
-- ---------------------------------------------------------------------------
create table if not exists recurring_expenses (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  vendor          text not null,
  category        text not null default 'Software & Subscriptions',
  frequency       text not null default 'monthly',
  next_run_date   date not null default current_date,
  day_of_month    int default 1,
  taxable_amount  numeric(14,2) not null default 0,
  gst_rate        numeric(5,2) not null default 18,
  tax_split       text not null default 'igst',            -- igst | cgst_sgst | none
  itc_eligible    boolean not null default true,
  currency        text not null default 'INR',
  exchange_rate   numeric(14,6) not null default 1,
  is_active       boolean not null default true,
  notes           text,
  last_run_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists recurring_expenses_next_idx on recurring_expenses (next_run_date);

alter table company_profile add column if not exists cash_on_hand numeric(14,2);

-- ---------------------------------------------------------------------------
-- 9. ACTIVITY LOG
-- ---------------------------------------------------------------------------
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  entity      text not null,          -- invoice | client | payment | expense | gst
  entity_id   uuid,
  action      text not null,
  detail      text,
  actor       text,
  created_at  timestamptz not null default now()
);
create index if not exists activity_entity_idx on activity_log (entity, entity_id);

-- ---------------------------------------------------------------------------
-- 10. ATOMIC DOCUMENT NUMBERING
-- ---------------------------------------------------------------------------
create or replace function next_document_number(p_doc_type text default 'invoice')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text; v_pad int; v_no int;
begin
  if p_doc_type = 'quote' then
    update company_profile
       set next_quote_no = next_quote_no + 1
     where id = 1
     returning quote_prefix, quote_padding, next_quote_no - 1
      into v_prefix, v_pad, v_no;
  else
    update company_profile
       set next_invoice_no = next_invoice_no + 1
     where id = 1
     returning invoice_prefix, invoice_padding, next_invoice_no - 1
      into v_prefix, v_pad, v_no;
  end if;
  return v_prefix || lpad(v_no::text, v_pad, '0');
end;
$$;

-- peek without consuming (used by the invoice editor for the suggested number)
create or replace function peek_document_number(p_doc_type text default 'invoice')
returns text
language sql
stable
as $$
  select case when p_doc_type = 'quote'
    then quote_prefix || lpad(next_quote_no::text, quote_padding, '0')
    else invoice_prefix || lpad(next_invoice_no::text, invoice_padding, '0')
  end from company_profile where id = 1;
$$;

-- keep invoice.amount_paid / balance_due / status in sync with payments
create or replace function recalc_invoice_payment(p_invoice uuid)
returns void
language plpgsql
as $$
declare v_paid numeric(14,2); v_total numeric(14,2); v_status text; v_due date;
begin
  select coalesce(sum(amount),0) into v_paid from payments where invoice_id = p_invoice;
  select total, due_date, status into v_total, v_due, v_status from invoices where id = p_invoice;
  if v_status in ('cancelled','draft') then
    update invoices set amount_paid = v_paid, balance_due = v_total - v_paid, updated_at = now() where id = p_invoice;
    return;
  end if;
  update invoices
     set amount_paid = v_paid,
         balance_due = round(v_total - v_paid, 2),
         paid_at = case when v_paid >= v_total - 0.5 then now() else null end,
         status = case
           when v_paid >= v_total - 0.5 then 'paid'
           when v_paid > 0 then 'partially_paid'
           when v_due is not null and v_due < current_date then 'overdue'
           else 'sent' end,
         updated_at = now()
   where id = p_invoice;
end;
$$;

create or replace function trg_payments_touch() returns trigger
language plpgsql as $$
begin
  perform recalc_invoice_payment(coalesce(new.invoice_id, old.invoice_id));
  return null;
end; $$;

drop trigger if exists payments_after_change on payments;
create trigger payments_after_change
after insert or update or delete on payments
for each row execute function trg_payments_touch();

-- ---------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
--     Single shared workspace: every signed-in user (you + your team) has
--     full access. Invite team members in Supabase -> Authentication -> Users.
--     The public invoice link is served through the service-role key on the
--     server, so no anonymous table access is granted here.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['company_profile','clients','items','invoices','invoice_items',
                           'payments','expenses','gst_payments','recurring_profiles','activity_log',
                           'team_members','payroll_items','recurring_expenses']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists team_all on %I', t);
    execute format(
      'create policy team_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11b. CHAT HISTORY  (per signed-in user — like a flight log, one book per captain)
-- ---------------------------------------------------------------------------
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conversations_user_idx on conversations (user_id, updated_at desc);

create table if not exists conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null default '',
  attachments      jsonb not null default '[]'::jsonb,
  draft            jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists conversation_messages_conv_idx on conversation_messages (conversation_id, created_at);

alter table conversations enable row level security;
alter table conversation_messages enable row level security;

drop policy if exists conv_own on conversations;
create policy conv_own on conversations for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists conv_msg_own on conversation_messages;
create policy conv_msg_own on conversation_messages for all to authenticated
  using (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 11c. STORAGE — public bucket for logo + authorised signature
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand', 'brand', true, 5242880,
  array['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists brand_public_read on storage.objects;
create policy brand_public_read on storage.objects
  for select using (bucket_id = 'brand');

drop policy if exists brand_auth_insert on storage.objects;
create policy brand_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'brand');

drop policy if exists brand_auth_update on storage.objects;
create policy brand_auth_update on storage.objects
  for update to authenticated
  using (bucket_id = 'brand')
  with check (bucket_id = 'brand');

drop policy if exists brand_auth_delete on storage.objects;
create policy brand_auth_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'brand');

-- ---------------------------------------------------------------------------
-- 12. SEED — your existing catalog + the AAFM India client from BL-000016
--     (delete this block if you would rather start empty)
-- ---------------------------------------------------------------------------
insert into items (name, description, kind, code_type, code, unit, rate, gst_rate)
select * from (values
  ('Consulting CTO Retainer','Fractional CTO engagement — monthly','service','SAC','999293','month',250000,18),
  ('AI Systems Build','Custom AI system design, build and deployment','service','SAC','998314','project',0,18),
  ('Technical Advisory','Advisory / architecture review','service','SAC','998311','hour',0,18),
  ('Corporate AI Training','Enterprise AI enablement workshop','service','SAC','999293','day',0,18),
  ('Enterprise Automation','Workflow automation build & integration','service','SAC','998314','project',0,18)
) as v(name,description,kind,code_type,code,unit,rate,gst_rate)
where not exists (select 1 from items);

insert into clients (company_name, display_name, contact_person, email, gst_treatment, gstin,
  place_of_supply_state, place_of_supply_code, bill_line1, bill_line2, bill_city, bill_state,
  bill_pincode, bill_country, payment_terms_days, default_sac, tds_applicable, tds_section, tds_rate)
select 'AAFM India','AAFM India',null,null,'registered_business','09AAYCA1840R1ZR',
  'Uttar Pradesh','09','Plot No. 30, 3rd Floor, Grover Tower-1',
  'Main Najafgarh Road, Shivaji Marg, Moti Nagar','New Delhi','Delhi','110015','India',
  7,'999293',true,'194J',10
where not exists (select 1 from clients where company_name = 'AAFM India');
