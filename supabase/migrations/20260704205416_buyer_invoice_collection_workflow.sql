create extension if not exists pgcrypto;

create table if not exists public.buyer_invoice_collection_items (
  stem_id text primary key,
  status text not null default 'Not Started'
    check (status in ('Not Started', 'Reminder Sent', 'Awaiting Buyer Reply', 'Promise to Pay', 'Escalated', 'Paid / Closed', 'On Hold')),
  owner_user_id uuid null references public.user_profiles(id) on delete set null,
  owner_name text not null default '',
  latest_note text not null default '',
  next_follow_up_date date null,
  promised_payment_date date null,
  promised_amount numeric(18, 2) null,
  last_event_at timestamptz null,
  last_updated_by uuid null references public.user_profiles(id) on delete set null,
  last_updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buyer_invoice_collection_events (
  id uuid primary key default gen_random_uuid(),
  stem_id text not null references public.buyer_invoice_collection_items(stem_id) on delete cascade,
  event_type text not null default 'update'
    check (event_type in ('update', 'status_change', 'note', 'follow_up', 'promise', 'owner_change')),
  status text null,
  owner_name text null,
  note text null,
  next_follow_up_date date null,
  promised_payment_date date null,
  promised_amount numeric(18, 2) null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create table if not exists public.buyer_invoice_email_settings (
  id text primary key default 'default',
  settings jsonb not null default '{}'::jsonb,
  last_preview_at timestamptz null,
  last_preview_row_count integer null,
  last_sent_at timestamptz null,
  last_sent_row_count integer null,
  last_error text null,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buyer_invoice_email_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  schedule_time text null,
  status text not null default 'running'
    check (status in ('running', 'sent', 'skipped', 'failed')),
  rows_count integer null,
  totals jsonb not null default '{}'::jsonb,
  error text null,
  provider_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists buyer_invoice_collection_items_status_idx
on public.buyer_invoice_collection_items(status);

create index if not exists buyer_invoice_collection_items_owner_idx
on public.buyer_invoice_collection_items(owner_name);

create index if not exists buyer_invoice_collection_items_owner_user_idx
on public.buyer_invoice_collection_items(owner_user_id);

create index if not exists buyer_invoice_collection_items_last_updated_by_idx
on public.buyer_invoice_collection_items(last_updated_by);

create index if not exists buyer_invoice_collection_items_follow_up_idx
on public.buyer_invoice_collection_items(next_follow_up_date);

create index if not exists buyer_invoice_collection_events_stem_created_idx
on public.buyer_invoice_collection_events(stem_id, created_at desc);

create index if not exists buyer_invoice_collection_events_actor_user_idx
on public.buyer_invoice_collection_events(actor_user_id);

create index if not exists buyer_invoice_email_settings_updated_by_idx
on public.buyer_invoice_email_settings(updated_by);

create index if not exists buyer_invoice_email_runs_created_idx
on public.buyer_invoice_email_runs(created_at desc);

insert into public.buyer_invoice_email_settings (id, settings)
values (
  'default',
  '{
    "enabled": true,
    "from": "Fratelli Cosulich <info@cosulich.com.hk>",
    "to": ["bt@cosulich.com.hk"],
    "cc": ["lousia@cosulich.com.hk", "laureen@cosulich.com.hk"],
    "daysAhead": 7,
    "subject": "Outstanding Buyer Invoices Report",
    "intro": "Outstanding Buyer Invoices\n\nPlease find below the latest overdue buyer invoices and buyer invoices due in {{daysAhead}} days.\n\nReport window: {{reportStart}} to {{reportEnd}}. Overdue invoices are always included.",
    "includeSummary": true,
    "includeTable": true,
    "buyerTraders": [],
    "weekdays": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "sendTimes": ["08:00", "14:00"]
  }'::jsonb
)
on conflict (id) do nothing;

alter table public.buyer_invoice_collection_items enable row level security;
alter table public.buyer_invoice_collection_events enable row level security;
alter table public.buyer_invoice_email_settings enable row level security;
alter table public.buyer_invoice_email_runs enable row level security;

revoke all on table public.buyer_invoice_collection_items from anon, authenticated;
revoke all on table public.buyer_invoice_collection_events from anon, authenticated;
revoke all on table public.buyer_invoice_email_settings from anon, authenticated;
revoke all on table public.buyer_invoice_email_runs from anon, authenticated;

grant all on table public.buyer_invoice_collection_items to service_role;
grant all on table public.buyer_invoice_collection_events to service_role;
grant all on table public.buyer_invoice_email_settings to service_role;
grant all on table public.buyer_invoice_email_runs to service_role;
