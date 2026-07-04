create table if not exists public.user_types (
  id text primary key,
  label text not null,
  description text not null default '',
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.user_types (id, label, description, is_system, sort_order) values
  ('administrator', 'Administrator', 'Full system administration access.', true, 10),
  ('manager', 'Manager', 'Operational management access without user administration.', true, 20),
  ('finance', 'Finance', 'Finance, invoice, report, and commission review access.', true, 30),
  ('operations', 'Operations', 'Operational review and dispute workflow access.', true, 40),
  ('viewer', 'Viewer', 'Read-only dashboard access.', true, 50)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  is_system = excluded.is_system,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.user_profiles
  drop constraint if exists user_profiles_user_type_check;

alter table public.user_profiles
  add column if not exists use_type_defaults boolean;

update public.user_profiles
set use_type_defaults = false
where use_type_defaults is null;

alter table public.user_profiles
  alter column use_type_defaults set default true,
  alter column use_type_defaults set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_user_type_fkey'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_user_type_fkey
      foreign key (user_type)
      references public.user_types(id)
      on update cascade
      on delete restrict;
  end if;
end $$;

create table if not exists public.user_type_module_permissions (
  user_type_id text not null references public.user_types(id) on update cascade on delete cascade,
  module_id text not null references public.app_modules(id) on delete cascade,
  can_view boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_type_id, module_id)
);

create index if not exists user_type_module_permissions_module_idx
on public.user_type_module_permissions(module_id);

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select 'administrator', id, true from public.app_modules
on conflict (user_type_id, module_id) do update set can_view = excluded.can_view, updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view) values
  ('manager', 'dashboard', true),
  ('manager', 'review', true),
  ('manager', 'disputes', true),
  ('manager', 'buyer_invoices', true),
  ('manager', 'reports', true),
  ('manager', 'pnl', true),
  ('manager', 'brokers', true),
  ('manager', 'explorer', false),
  ('manager', 'settings', true),
  ('manager', 'admin', false),
  ('finance', 'dashboard', true),
  ('finance', 'review', true),
  ('finance', 'disputes', true),
  ('finance', 'buyer_invoices', true),
  ('finance', 'reports', true),
  ('finance', 'pnl', true),
  ('finance', 'brokers', true),
  ('finance', 'explorer', false),
  ('finance', 'settings', false),
  ('finance', 'admin', false),
  ('operations', 'dashboard', true),
  ('operations', 'review', true),
  ('operations', 'disputes', true),
  ('operations', 'buyer_invoices', false),
  ('operations', 'reports', true),
  ('operations', 'pnl', true),
  ('operations', 'brokers', false),
  ('operations', 'explorer', false),
  ('operations', 'settings', false),
  ('operations', 'admin', false),
  ('viewer', 'dashboard', true),
  ('viewer', 'review', false),
  ('viewer', 'disputes', false),
  ('viewer', 'buyer_invoices', false),
  ('viewer', 'reports', false),
  ('viewer', 'pnl', false),
  ('viewer', 'brokers', false),
  ('viewer', 'explorer', false),
  ('viewer', 'settings', false),
  ('viewer', 'admin', false)
on conflict (user_type_id, module_id) do nothing;

alter table public.user_types enable row level security;
alter table public.user_type_module_permissions enable row level security;

drop policy if exists "Authenticated users can read user types" on public.user_types;
create policy "Authenticated users can read user types"
on public.user_types for select
to authenticated
using (true);

drop policy if exists "Users can read own user type permissions" on public.user_type_module_permissions;
create policy "Users can read own user type permissions"
on public.user_type_module_permissions for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.user_type = user_type_id
  )
);

grant select on public.user_types to authenticated;
grant select on public.user_type_module_permissions to authenticated;
grant all on public.user_types to service_role;
grant all on public.user_type_module_permissions to service_role;
