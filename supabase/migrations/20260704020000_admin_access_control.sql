create extension if not exists pgcrypto;

create table if not exists public.app_modules (
  id text primary key,
  label text not null,
  path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  user_type text not null default 'viewer'
    check (user_type in ('administrator', 'manager', 'finance', 'operations', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_module_permissions (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  module_id text not null references public.app_modules(id) on delete cascade,
  can_view boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null,
  actor_email text null,
  action text not null,
  target_user_id uuid null,
  target_email text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_profiles_user_type_idx on public.user_profiles(user_type);
create index if not exists user_profiles_active_idx on public.user_profiles(active);
create index if not exists user_module_permissions_module_idx on public.user_module_permissions(module_id);
create index if not exists admin_audit_logs_created_at_idx on public.admin_audit_logs(created_at desc);
create index if not exists admin_audit_logs_target_user_id_idx on public.admin_audit_logs(target_user_id);

insert into public.app_modules (id, label, path, sort_order) values
  ('dashboard', 'Dashboard', '/', 10),
  ('review', 'Exception Review', '/review', 20),
  ('disputes', 'Dispute Management', '/disputes', 30),
  ('buyer_invoices', 'Outstanding Buyer Invoices', '/buyer-invoices', 40),
  ('reports', 'Report Builder', '/reports', 50),
  ('pnl', 'Stem P&L', '/pnl', 60),
  ('brokers', 'Broker''s Commission', '/brokers', 70),
  ('explorer', 'Data Explorer', '/explorer', 80),
  ('settings', 'Settings', '/settings', 90),
  ('admin', 'Admin Control', '/admin', 100)
on conflict (id) do update set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.app_modules enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_module_permissions enable row level security;
alter table public.admin_audit_logs enable row level security;

drop policy if exists "Authenticated users can read app modules" on public.app_modules;
create policy "Authenticated users can read app modules"
on public.app_modules for select
to authenticated
using (true);

drop policy if exists "Users can read own profile" on public.user_profiles;
create policy "Users can read own profile"
on public.user_profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can read own module permissions" on public.user_module_permissions;
create policy "Users can read own module permissions"
on public.user_module_permissions for select
to authenticated
using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated, service_role;
grant select on public.app_modules to authenticated;
grant select on public.user_profiles to authenticated;
grant select on public.user_module_permissions to authenticated;
grant all on public.app_modules to service_role;
grant all on public.user_profiles to service_role;
grant all on public.user_module_permissions to service_role;
grant all on public.admin_audit_logs to service_role;
