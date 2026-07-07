create extension if not exists pgcrypto;

insert into public.app_modules (id, label, path, sort_order) values
  ('report_archive', 'Reports Archive', '/report-archive', 75)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select
  user_types.id,
  'report_archive',
  case
    when user_types.id = 'administrator' then true
    when exists (
      select 1
      from public.user_type_module_permissions broker_permissions
      where broker_permissions.user_type_id = user_types.id
        and broker_permissions.module_id = 'brokers'
        and broker_permissions.can_view = true
    ) then true
    else false
  end
from public.user_types
on conflict (user_type_id, module_id) do update set
  can_view = excluded.can_view,
  updated_at = now();

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  report_label text not null default '',
  file_name text not null,
  mime_type text not null default 'application/vnd.ms-excel',
  size_bytes bigint not null default 0,
  checksum_sha256 text null,
  drive_file_id text null,
  drive_web_view_link text null,
  drive_web_content_link text null,
  status text not null default 'uploading'
    check (status in ('uploading', 'active', 'failed', 'deleted')),
  exported_by uuid null references public.user_profiles(id) on delete set null,
  exported_by_email text null,
  deleted_by uuid null references public.user_profiles(id) on delete set null,
  deleted_by_email text null,
  metadata jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.report_export_events (
  id uuid primary key default gen_random_uuid(),
  report_export_id uuid not null references public.report_exports(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid null references public.user_profiles(id) on delete set null,
  actor_email text null,
  previous_file_name text null,
  new_file_name text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists report_exports_created_at_idx
on public.report_exports(created_at desc);

create index if not exists report_exports_status_idx
on public.report_exports(status);

create index if not exists report_exports_report_type_idx
on public.report_exports(report_type);

create index if not exists report_exports_exported_by_idx
on public.report_exports(exported_by);

create index if not exists report_export_events_export_created_idx
on public.report_export_events(report_export_id, created_at desc);

alter table public.report_exports enable row level security;
alter table public.report_export_events enable row level security;

revoke all on table public.report_exports from anon, authenticated;
revoke all on table public.report_export_events from anon, authenticated;

grant all on table public.report_exports to service_role;
grant all on table public.report_export_events to service_role;
