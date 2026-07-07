create extension if not exists pgcrypto;

create table if not exists public.dispute_beta_cases (
  id uuid primary key default gen_random_uuid(),
  stem_id text not null unique,
  stem_name text null,
  buyer_name text null,
  supplier_names text null,
  current_salesforce_status text null,
  workflow_status text not null default 'Draft'
    check (workflow_status in ('Draft', 'Pending Approval', 'Approved - Pending Execution', 'Rejected', 'Revision Requested', 'Executed', 'Closed')),
  approval_status text not null default 'Draft'
    check (approval_status in ('Draft', 'Pending Approval', 'Approved', 'Rejected', 'Revision Requested')),
  latest_note text not null default '',
  submitted_by uuid null references public.user_profiles(id) on delete set null,
  submitted_by_email text null,
  submitted_at timestamptz null,
  approved_by uuid null references public.user_profiles(id) on delete set null,
  approved_by_email text null,
  approved_at timestamptz null,
  rejected_by uuid null references public.user_profiles(id) on delete set null,
  rejected_by_email text null,
  rejected_at timestamptz null,
  rejection_reason text null,
  closed_by uuid null references public.user_profiles(id) on delete set null,
  closed_by_email text null,
  closed_at timestamptz null,
  settlement_financials jsonb not null default '{}'::jsonb,
  settlement_pnl numeric(18, 2) not null default 0,
  salesforce_writeback_status text not null default 'not_started'
    check (salesforce_writeback_status in ('not_started', 'success', 'partial', 'failed')),
  salesforce_writeback_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dispute_beta_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_beta_cases(id) on delete cascade,
  stem_id text not null,
  party_type text not null
    check (party_type in ('buyer', 'supplier')),
  party_name text not null default '',
  dispute_ids text[] not null default '{}'::text[],
  action_type text not null
    check (action_type in (
      'hold_supplier_payment',
      'pay_full_supplier_invoice',
      'deduct_specific_amount',
      'issue_buyer_credit_note',
      'close_supplier_dispute',
      'close_buyer_dispute'
    )),
  action_label text not null default '',
  amount numeric(18, 2) null,
  special_sell_price numeric(18, 6) null,
  special_buy_price numeric(18, 6) null,
  quantity numeric(18, 6) null,
  quantity_unit text not null default 'MT',
  close_reason text null,
  balance_payment_instruction text null
    check (balance_payment_instruction is null or balance_payment_instruction in ('No Balance Payment', 'Pay Immediately', 'Pay with next supplier invoice')),
  description text not null default '',
  requires_attachment boolean not null default false,
  execution_status text not null default 'Pending Execution'
    check (execution_status in ('Pending Execution', 'Executed', 'Not Required')),
  executed_by uuid null references public.user_profiles(id) on delete set null,
  executed_by_email text null,
  executed_at timestamptz null,
  execution_note text null,
  created_by uuid null references public.user_profiles(id) on delete set null,
  created_by_email text null,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dispute_beta_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_beta_cases(id) on delete cascade,
  action_id uuid null references public.dispute_beta_actions(id) on delete set null,
  stem_id text not null,
  event_type text not null
    check (event_type in ('draft_saved', 'submitted', 'approved', 'rejected', 'revision_requested', 'action_executed', 'closed', 'salesforce_writeback')),
  note text null,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create index if not exists dispute_beta_cases_status_idx
on public.dispute_beta_cases(workflow_status, approval_status);

create index if not exists dispute_beta_cases_stem_idx
on public.dispute_beta_cases(stem_id);

create index if not exists dispute_beta_cases_updated_idx
on public.dispute_beta_cases(updated_at desc);

create index if not exists dispute_beta_actions_case_idx
on public.dispute_beta_actions(case_id);

create index if not exists dispute_beta_actions_stem_idx
on public.dispute_beta_actions(stem_id);

create index if not exists dispute_beta_actions_execution_idx
on public.dispute_beta_actions(execution_status);

create index if not exists dispute_beta_events_case_created_idx
on public.dispute_beta_events(case_id, created_at desc);

create index if not exists dispute_beta_events_actor_idx
on public.dispute_beta_events(actor_user_id);

alter table public.dispute_beta_cases enable row level security;
alter table public.dispute_beta_actions enable row level security;
alter table public.dispute_beta_events enable row level security;

revoke all on table public.dispute_beta_cases from anon, authenticated;
revoke all on table public.dispute_beta_actions from anon, authenticated;
revoke all on table public.dispute_beta_events from anon, authenticated;

grant all on table public.dispute_beta_cases to service_role;
grant all on table public.dispute_beta_actions to service_role;
grant all on table public.dispute_beta_events to service_role;
