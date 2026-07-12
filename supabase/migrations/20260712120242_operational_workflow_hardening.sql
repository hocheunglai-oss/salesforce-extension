create extension if not exists pgcrypto;

-- Hidden capability rows use the existing permission tables without creating navigation items.
insert into public.app_modules (id, label, path, sort_order) values
  ('disputes_approve', 'Dispute Approval', '/disputes', 131),
  ('disputes_account', 'Dispute Accounting and Closure', '/disputes', 132),
  ('buyer_invoices_manage', 'Buyer Invoice Shared Settings', '/buyer-invoices', 133),
  ('cashflow_forecast_manage', 'Cashflow Forecast Settings', '/cashflow-forecast', 134)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select
  user_types.id,
  capability.id,
  case capability.id
    when 'disputes_approve' then
      user_types.id = 'administrator'
      or user_types.id in ('manager', 'admin_and_accounting')
      or lower(user_types.label) like '%approval%'
    when 'disputes_account' then
      user_types.id = 'administrator'
      or user_types.id in ('finance', 'admin_and_accounting')
      or lower(user_types.label) like '%account%'
      or lower(user_types.label) like '%finance%'
    when 'buyer_invoices_manage' then
      user_types.id = 'administrator'
      or user_types.id in ('manager', 'finance', 'admin_and_accounting')
      or lower(user_types.label) like '%account%'
      or lower(user_types.label) like '%finance%'
    when 'cashflow_forecast_manage' then
      user_types.id = 'administrator'
      or user_types.id in ('manager', 'finance', 'admin_and_accounting')
      or lower(user_types.label) like '%account%'
      or lower(user_types.label) like '%finance%'
    else false
  end
from public.user_types
cross join (values
  ('disputes_approve'),
  ('disputes_account'),
  ('buyer_invoices_manage'),
  ('cashflow_forecast_manage')
) as capability(id)
on conflict (user_type_id, module_id) do nothing;

-- Preserve the existing named approver while moving future control into Admin Control.
insert into public.user_module_permissions (user_id, module_id, can_view)
select id, 'disputes_approve', true
from public.user_profiles
where lower(email) in (
  'stanley@cosulich.com.hk',
  'stanley.chui@cosulich.com.hk',
  'vincent@cosulich.com.hk',
  'vincent.lee@cosulich.com.hk'
)
on conflict (user_id, module_id) do update set can_view = true, updated_at = now();

create or replace function public.save_buyer_invoice_collection(
  p_stem_id text,
  p_updates jsonb,
  p_event jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.buyer_invoice_collection_items%rowtype;
  v_item public.buyer_invoice_collection_items%rowtype;
  v_event public.buyer_invoice_collection_events%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if nullif(trim(p_stem_id), '') is null then
    raise exception 'stemId is required.';
  end if;

  select * into v_current
  from public.buyer_invoice_collection_items
  where stem_id = p_stem_id
  for update;

  if found then
    if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
      raise exception 'This collection record changed after it was opened. Refresh and review the latest update before saving.';
    end if;

    update public.buyer_invoice_collection_items set
      status = case when p_updates ? 'status' then p_updates->>'status' else status end,
      owner_user_id = case when p_updates ? 'owner_user_id' then nullif(p_updates->>'owner_user_id', '')::uuid else owner_user_id end,
      owner_name = case when p_updates ? 'owner_name' then coalesce(p_updates->>'owner_name', '') else owner_name end,
      latest_note = case when p_updates ? 'latest_note' then coalesce(p_updates->>'latest_note', '') else latest_note end,
      next_follow_up_date = case when p_updates ? 'next_follow_up_date' then nullif(p_updates->>'next_follow_up_date', '')::date else next_follow_up_date end,
      promised_payment_date = case when p_updates ? 'promised_payment_date' then nullif(p_updates->>'promised_payment_date', '')::date else promised_payment_date end,
      promised_amount = case when p_updates ? 'promised_amount' then nullif(p_updates->>'promised_amount', '')::numeric else promised_amount end,
      last_event_at = v_now,
      last_updated_by = p_actor_user_id,
      last_updated_by_email = p_actor_email,
      updated_at = v_now
    where stem_id = p_stem_id
    returning * into v_item;
  else
    insert into public.buyer_invoice_collection_items (
      stem_id, status, owner_user_id, owner_name, latest_note,
      next_follow_up_date, promised_payment_date, promised_amount,
      last_event_at, last_updated_by, last_updated_by_email, updated_at
    ) values (
      p_stem_id,
      coalesce(nullif(p_updates->>'status', ''), 'Not Started'),
      nullif(p_updates->>'owner_user_id', '')::uuid,
      coalesce(p_updates->>'owner_name', ''),
      coalesce(p_updates->>'latest_note', ''),
      nullif(p_updates->>'next_follow_up_date', '')::date,
      nullif(p_updates->>'promised_payment_date', '')::date,
      nullif(p_updates->>'promised_amount', '')::numeric,
      v_now, p_actor_user_id, p_actor_email, v_now
    ) returning * into v_item;
  end if;

  insert into public.buyer_invoice_collection_events (
    stem_id, event_type, status, owner_name, note,
    next_follow_up_date, promised_payment_date, promised_amount,
    actor_user_id, actor_email
  ) values (
    p_stem_id,
    coalesce(nullif(p_event->>'event_type', ''), 'update'),
    nullif(p_event->>'status', ''),
    nullif(p_event->>'owner_name', ''),
    nullif(p_event->>'note', ''),
    nullif(p_event->>'next_follow_up_date', '')::date,
    nullif(p_event->>'promised_payment_date', '')::date,
    nullif(p_event->>'promised_amount', '')::numeric,
    p_actor_user_id,
    p_actor_email
  ) returning * into v_event;

  return jsonb_build_object('item', to_jsonb(v_item), 'event', to_jsonb(v_event));
end;
$$;

revoke all on function public.save_buyer_invoice_collection(text, jsonb, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_buyer_invoice_collection(text, jsonb, jsonb, uuid, text, timestamptz) to service_role;

create table if not exists public.exception_review_items (
  stem_id text primary key,
  status text not null default 'Open'
    check (status in ('Open', 'Acknowledged', 'In Progress', 'Resolved', 'Dismissed')),
  department text not null default 'Unassigned'
    check (department in ('Unassigned', 'Trading', 'Operations', 'Accounting', 'Management')),
  owner_user_id uuid null references public.user_profiles(id) on delete set null,
  owner_name text not null default '',
  priority text not null default 'High'
    check (priority in ('High', 'Medium', 'Low')),
  due_date date null,
  latest_note text not null default '',
  resolution_note text not null default '',
  last_event_at timestamptz null,
  last_updated_by uuid null references public.user_profiles(id) on delete set null,
  last_updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exception_review_events (
  id uuid primary key default gen_random_uuid(),
  stem_id text not null references public.exception_review_items(stem_id) on delete cascade,
  event_type text not null default 'update',
  status text null,
  department text null,
  owner_name text null,
  priority text null,
  due_date date null,
  note text null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now()
);

create index if not exists exception_review_items_status_idx on public.exception_review_items(status);
create index if not exists exception_review_items_department_idx on public.exception_review_items(department);
create index if not exists exception_review_items_owner_idx on public.exception_review_items(owner_user_id);
create index if not exists exception_review_items_due_idx on public.exception_review_items(due_date);
create index if not exists exception_review_events_stem_created_idx on public.exception_review_events(stem_id, created_at desc);
create index if not exists exception_review_events_actor_idx on public.exception_review_events(actor_user_id);

alter table public.exception_review_items enable row level security;
alter table public.exception_review_events enable row level security;
revoke all on table public.exception_review_items from anon, authenticated;
revoke all on table public.exception_review_events from anon, authenticated;
grant all on table public.exception_review_items to service_role;
grant all on table public.exception_review_events to service_role;

create or replace function public.save_exception_review_item(
  p_stem_id text,
  p_updates jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current public.exception_review_items%rowtype;
  v_item public.exception_review_items%rowtype;
  v_event public.exception_review_events%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if nullif(trim(p_stem_id), '') is null then
    raise exception 'stemId is required.';
  end if;

  select * into v_current
  from public.exception_review_items
  where stem_id = p_stem_id
  for update;

  if found then
    if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
      raise exception 'This exception changed after it was opened. Refresh and review the latest update before saving.';
    end if;
    update public.exception_review_items set
      status = coalesce(nullif(p_updates->>'status', ''), status),
      department = coalesce(nullif(p_updates->>'department', ''), department),
      owner_user_id = case when p_updates ? 'owner_user_id' then nullif(p_updates->>'owner_user_id', '')::uuid else owner_user_id end,
      owner_name = case when p_updates ? 'owner_name' then coalesce(p_updates->>'owner_name', '') else owner_name end,
      priority = coalesce(nullif(p_updates->>'priority', ''), priority),
      due_date = case when p_updates ? 'due_date' then nullif(p_updates->>'due_date', '')::date else due_date end,
      latest_note = case when p_updates ? 'latest_note' then coalesce(p_updates->>'latest_note', '') else latest_note end,
      resolution_note = case when p_updates ? 'resolution_note' then coalesce(p_updates->>'resolution_note', '') else resolution_note end,
      last_event_at = v_now,
      last_updated_by = p_actor_user_id,
      last_updated_by_email = p_actor_email,
      updated_at = v_now
    where stem_id = p_stem_id
    returning * into v_item;
  else
    insert into public.exception_review_items (
      stem_id, status, department, owner_user_id, owner_name, priority,
      due_date, latest_note, resolution_note, last_event_at,
      last_updated_by, last_updated_by_email, updated_at
    ) values (
      p_stem_id,
      coalesce(nullif(p_updates->>'status', ''), 'Open'),
      coalesce(nullif(p_updates->>'department', ''), 'Unassigned'),
      nullif(p_updates->>'owner_user_id', '')::uuid,
      coalesce(p_updates->>'owner_name', ''),
      coalesce(nullif(p_updates->>'priority', ''), 'High'),
      nullif(p_updates->>'due_date', '')::date,
      coalesce(p_updates->>'latest_note', ''),
      coalesce(p_updates->>'resolution_note', ''),
      v_now, p_actor_user_id, p_actor_email, v_now
    ) returning * into v_item;
  end if;

  insert into public.exception_review_events (
    stem_id, event_type, status, department, owner_name, priority,
    due_date, note, actor_user_id, actor_email
  ) values (
    p_stem_id,
    case when v_item.status in ('Resolved', 'Dismissed') then 'resolution' else 'update' end,
    v_item.status,
    v_item.department,
    nullif(v_item.owner_name, ''),
    v_item.priority,
    v_item.due_date,
      coalesce(nullif(v_item.resolution_note, ''), nullif(v_item.latest_note, '')),
    p_actor_user_id,
    p_actor_email
  ) returning * into v_event;

  return jsonb_build_object('item', to_jsonb(v_item), 'event', to_jsonb(v_event));
end;
$$;

revoke all on function public.save_exception_review_item(text, jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_exception_review_item(text, jsonb, uuid, text, timestamptz) to service_role;

alter table public.incoming_payment_interest_notifications
  add column if not exists delivery_status text not null default 'sent',
  add column if not exists last_attempt_at timestamptz null,
  add column if not exists last_error text null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.incoming_payment_interest_notifications
  alter column sent_at drop not null,
  alter column sent_at drop default;

alter table public.incoming_payment_interest_notifications
  drop constraint if exists incoming_payment_interest_notifications_delivery_status_check;
alter table public.incoming_payment_interest_notifications
  add constraint incoming_payment_interest_notifications_delivery_status_check
  check (delivery_status in ('sending', 'sent', 'failed', 'uncertain'));

create index if not exists incoming_payment_interest_delivery_status_idx
on public.incoming_payment_interest_notifications(delivery_status, last_attempt_at desc);
