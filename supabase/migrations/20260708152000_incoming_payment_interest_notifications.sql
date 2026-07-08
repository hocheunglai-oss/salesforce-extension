create table if not exists public.incoming_payment_interest_notifications (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null unique,
  payment_name text null,
  stem_id text null,
  stem_name text null,
  buyer_name text null,
  buyer_group_name text null,
  received_date timestamptz null,
  payment_created_date timestamptz null,
  delay_days integer null,
  amount numeric(18, 2) null,
  currency text null,
  receivable_balance numeric(18, 2) null,
  recipient_email text not null default 'louisa@cosulich.com.hk',
  email_subject text null,
  email_message_id text null,
  email_provider text null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  actor_name text null,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists incoming_payment_interest_notifications_sent_at_idx
on public.incoming_payment_interest_notifications(sent_at desc);

create index if not exists incoming_payment_interest_notifications_actor_idx
on public.incoming_payment_interest_notifications(actor_user_id);

create index if not exists incoming_payment_interest_notifications_stem_idx
on public.incoming_payment_interest_notifications(stem_id);

alter table public.incoming_payment_interest_notifications enable row level security;

revoke all on table public.incoming_payment_interest_notifications from anon, authenticated;
grant all on table public.incoming_payment_interest_notifications to service_role;
