create extension if not exists pgcrypto;

insert into public.app_modules (id, label, path, sort_order)
values ('cashflow_forecast', 'Cashflow Forecast', '/cashflow-forecast', 47)
on conflict (id) do update
set label = excluded.label,
    path = excluded.path,
    sort_order = excluded.sort_order,
    updated_at = now();

insert into public.user_type_module_permissions (user_type_id, module_id, can_view)
select id,
       'cashflow_forecast',
       id in ('administrator', 'manager', 'finance')
from public.user_types
on conflict (user_type_id, module_id) do update
set can_view = excluded.can_view,
    updated_at = now();

create table if not exists public.cashflow_forecast_settings (
  id text primary key default 'default',
  horizon_days integer not null default 90 check (horizon_days between 1 and 365),
  lookback_months integer not null default 12 check (lookback_months between 1 and 36),
  min_buyer_samples integer not null default 3 check (min_buyer_samples between 1 and 100),
  min_group_samples integer not null default 5 check (min_group_samples between 1 and 100),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

insert into public.cashflow_forecast_settings (
  id,
  horizon_days,
  lookback_months,
  min_buyer_samples,
  min_group_samples
)
values ('default', 90, 12, 3, 5)
on conflict (id) do nothing;

create table if not exists public.cashflow_holiday_cache (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  calendar_year integer not null,
  source text not null default 'nager.date',
  holidays jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz null,
  error_message text null,
  unique (country_code, calendar_year, source)
);

create index if not exists cashflow_holiday_cache_country_year_idx
on public.cashflow_holiday_cache (country_code, calendar_year);

create table if not exists public.cashflow_holiday_overrides (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  country_code text not null default 'MANUAL',
  name text not null default 'Manual blocked date',
  is_blocked boolean not null default true,
  note text null,
  created_by uuid null references public.user_profiles(id) on delete set null,
  created_by_email text null,
  created_at timestamptz not null default now(),
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  updated_at timestamptz not null default now(),
  unique (holiday_date, country_code)
);

create index if not exists cashflow_holiday_overrides_date_idx
on public.cashflow_holiday_overrides (holiday_date);

alter table public.cashflow_forecast_settings enable row level security;
alter table public.cashflow_holiday_cache enable row level security;
alter table public.cashflow_holiday_overrides enable row level security;

revoke all on table public.cashflow_forecast_settings from anon, authenticated;
revoke all on table public.cashflow_holiday_cache from anon, authenticated;
revoke all on table public.cashflow_holiday_overrides from anon, authenticated;

grant all on table public.cashflow_forecast_settings to service_role;
grant all on table public.cashflow_holiday_cache to service_role;
grant all on table public.cashflow_holiday_overrides to service_role;
