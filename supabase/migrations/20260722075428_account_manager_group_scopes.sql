do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'account_manager_groups'
      and column_name = 'propagate_to_children'
  ) then
    alter table public.account_manager_groups
    add column if not exists propagate_to_children boolean not null default false;

    update public.account_manager_groups
    set propagate_to_children = true
    where upper(account_name) like 'GROUP - %';
  end if;
end;
$$;

alter table public.account_manager_notes
add column if not exists source_group_account_name_key text null
  check (source_group_account_name_key is null or source_group_account_name_key ~ '^[a-f0-9]{64}$'),
add column if not exists source_group_account_name text null;

create or replace function public.save_account_manager_group_with_scope(
  p_account_name_key text,
  p_account_name text,
  p_salesforce_account_ids text[],
  p_account_roles text[],
  p_salesforce_manager_text text,
  p_manager_user_ids uuid[],
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint,
  p_child_account_name_keys text[],
  p_propagate_to_children boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parent_key text := lower(btrim(coalesce(p_account_name_key, '')));
  v_propagate boolean := coalesce(p_propagate_to_children, false);
  v_group jsonb;
begin
  if v_propagate then
    select public.save_account_manager_group_family(
      p_account_name_key => v_parent_key,
      p_account_name => p_account_name,
      p_salesforce_account_ids => p_salesforce_account_ids,
      p_account_roles => p_account_roles,
      p_salesforce_manager_text => p_salesforce_manager_text,
      p_manager_user_ids => p_manager_user_ids,
      p_actor_user_id => p_actor_user_id,
      p_actor_email => p_actor_email,
      p_expected_revision => p_expected_revision,
      p_child_account_name_keys => p_child_account_name_keys
    ) into v_group;
  else
    select public.save_account_manager_group(
      p_account_name_key => v_parent_key,
      p_account_name => p_account_name,
      p_salesforce_account_ids => p_salesforce_account_ids,
      p_account_roles => p_account_roles,
      p_salesforce_manager_text => p_salesforce_manager_text,
      p_manager_user_ids => p_manager_user_ids,
      p_actor_user_id => p_actor_user_id,
      p_actor_email => p_actor_email,
      p_expected_revision => p_expected_revision
    ) into v_group;
  end if;

  update public.account_manager_groups
  set propagate_to_children = v_propagate
  where account_name_key = v_parent_key
  returning to_jsonb(account_manager_groups) into v_group;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_managers_group_scope_updated',
    jsonb_build_object(
      'group_account_name_key', v_parent_key,
      'group_account_name', btrim(coalesce(p_account_name, '')),
      'propagate_to_children', v_propagate,
      'child_account_name_keys', to_jsonb(coalesce(p_child_account_name_keys, '{}'::text[]))
    )
  );

  return v_group;
end;
$$;

revoke all on function public.save_account_manager_group_with_scope(
  text, text, text[], text[], text, uuid[], uuid, text, bigint, text[], boolean
) from public, anon, authenticated;

grant execute on function public.save_account_manager_group_with_scope(
  text, text, text[], text[], text, uuid[], uuid, text, bigint, text[], boolean
) to service_role;

create or replace function public.save_account_manager_note(
  p_account_name_key text,
  p_account_name text,
  p_account_note text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_name_key text := lower(btrim(coalesce(p_account_name_key, '')));
  v_account_name text := btrim(coalesce(p_account_name, ''));
  v_account_note text := btrim(coalesce(p_account_note, ''));
  v_current public.account_manager_notes%rowtype;
  v_note public.account_manager_notes%rowtype;
  v_revision bigint := 1;
  v_now timestamptz := clock_timestamp();
begin
  if v_account_name_key !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid Account name key is required.';
  end if;
  if v_account_name = '' then
    raise exception 'Account name is required.';
  end if;
  if char_length(v_account_note) > 255 then
    raise exception 'Account note cannot exceed 255 characters.';
  end if;
  if not exists (
    select 1
    from public.user_profiles
    where id = p_actor_user_id
      and active = true
  ) then
    raise exception 'The note editor must be an active FCOS user.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-manager-note:' || v_account_name_key, 0));

  select * into v_current
  from public.account_manager_notes
  where account_name_key = v_account_name_key
  for update;

  if found then
    if p_expected_revision is null or v_current.revision <> p_expected_revision then
      raise exception 'This Account note changed after it was opened. Refresh and review the latest note before saving.';
    end if;
    v_revision := v_current.revision + 1;
  elsif coalesce(p_expected_revision, 0) <> 0 then
    raise exception 'This Account note changed after it was opened. Refresh and review the latest note before saving.';
  end if;

  insert into public.account_manager_notes (
    account_name_key,
    account_name,
    account_note,
    revision,
    updated_by,
    updated_by_email,
    source_group_account_name_key,
    source_group_account_name,
    updated_at
  ) values (
    v_account_name_key,
    v_account_name,
    v_account_note,
    v_revision,
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    null,
    null,
    v_now
  )
  on conflict (account_name_key) do update set
    account_name = excluded.account_name,
    account_note = excluded.account_note,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email,
    source_group_account_name_key = null,
    source_group_account_name = null,
    updated_at = excluded.updated_at
  returning * into v_note;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_manager_note_updated',
    jsonb_build_object(
      'account_name_key', v_account_name_key,
      'account_name', v_account_name,
      'previous_account_note', coalesce(v_current.account_note, ''),
      'account_note', v_account_note,
      'revision', v_revision
    )
  );

  return to_jsonb(v_note);
end;
$$;

create or replace function public.save_account_manager_note_family(
  p_account_name_key text,
  p_account_name text,
  p_account_note text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_expected_revision bigint,
  p_child_accounts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parent_key text := lower(btrim(coalesce(p_account_name_key, '')));
  v_parent_name text := btrim(coalesce(p_account_name, ''));
  v_note text := btrim(coalesce(p_account_note, ''));
  v_children jsonb := coalesce(p_child_accounts, '[]'::jsonb);
  v_child jsonb;
  v_child_key text;
  v_child_name text;
  v_expected_revision bigint;
  v_current public.account_manager_notes%rowtype;
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
  v_parent_note jsonb;
  v_lock_key text;
begin
  if jsonb_typeof(v_children) <> 'array' then
    raise exception 'Child Accounts must be a list.';
  end if;
  if jsonb_array_length(v_children) > 5000 then
    raise exception 'A GROUP note can be applied to at most 5,000 direct child Accounts.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_children) as children(child)
    where lower(btrim(coalesce(child ->> 'accountNameKey', ''))) !~ '^[a-f0-9]{64}$'
      or lower(btrim(coalesce(child ->> 'accountNameKey', ''))) = v_parent_key
      or btrim(coalesce(child ->> 'accountName', '')) = ''
      or coalesce(child ->> 'expectedRevision', '') !~ '^[0-9]+$'
  ) then
    raise exception 'Every child Account must include a valid name, key, and expected note revision.';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(v_children)
  ) <> (
    select count(distinct lower(btrim(child ->> 'accountNameKey')))
    from jsonb_array_elements(v_children) as children(child)
  ) then
    raise exception 'Child Account name keys cannot be repeated.';
  end if;

  for v_lock_key in
    select lock_key
    from (
      select v_parent_key as lock_key
      union
      select lower(btrim(child ->> 'accountNameKey'))
      from jsonb_array_elements(v_children) as children(child)
    ) as family_keys
    order by lock_key
  loop
    perform pg_advisory_xact_lock(hashtextextended('account-manager-note:' || v_lock_key, 0));
  end loop;

  select public.save_account_manager_note(
    p_account_name_key => v_parent_key,
    p_account_name => v_parent_name,
    p_account_note => v_note,
    p_actor_user_id => p_actor_user_id,
    p_actor_email => p_actor_email,
    p_expected_revision => p_expected_revision
  ) into v_parent_note;

  for v_child in
    select child
    from jsonb_array_elements(v_children) as children(child)
    order by lower(btrim(child ->> 'accountNameKey'))
  loop
    v_child_key := lower(btrim(v_child ->> 'accountNameKey'));
    v_child_name := btrim(v_child ->> 'accountName');
    v_expected_revision := (v_child ->> 'expectedRevision')::bigint;
    v_current := null;
    v_revision := 1;

    select * into v_current
    from public.account_manager_notes
    where account_name_key = v_child_key
    for update;

    if found then
      if v_current.revision <> v_expected_revision then
        raise exception 'A child Account note changed after this GROUP edit was opened. Refresh and review the latest notes before saving.';
      end if;
      v_revision := v_current.revision + 1;
    elsif v_expected_revision <> 0 then
      raise exception 'A child Account note changed after this GROUP edit was opened. Refresh and review the latest notes before saving.';
    end if;

    insert into public.account_manager_notes (
      account_name_key,
      account_name,
      account_note,
      revision,
      updated_by,
      updated_by_email,
      source_group_account_name_key,
      source_group_account_name,
      updated_at
    ) values (
      v_child_key,
      v_child_name,
      v_note,
      v_revision,
      p_actor_user_id,
      nullif(btrim(coalesce(p_actor_email, '')), ''),
      v_parent_key,
      v_parent_name,
      v_now
    )
    on conflict (account_name_key) do update set
      account_name = excluded.account_name,
      account_note = excluded.account_note,
      revision = excluded.revision,
      updated_by = excluded.updated_by,
      updated_by_email = excluded.updated_by_email,
      source_group_account_name_key = excluded.source_group_account_name_key,
      source_group_account_name = excluded.source_group_account_name,
      updated_at = excluded.updated_at;
  end loop;

  insert into public.admin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    metadata
  ) values (
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    'account_manager_note_group_propagated',
    jsonb_build_object(
      'group_account_name_key', v_parent_key,
      'group_account_name', v_parent_name,
      'child_account_count', jsonb_array_length(v_children),
      'child_account_name_keys', (
        select coalesce(jsonb_agg(lower(btrim(child ->> 'accountNameKey')) order by lower(btrim(child ->> 'accountNameKey'))), '[]'::jsonb)
        from jsonb_array_elements(v_children) as children(child)
      )
    )
  );

  return v_parent_note;
end;
$$;

revoke all on function public.save_account_manager_note(text, text, text, uuid, text, bigint)
from public, anon, authenticated;
grant execute on function public.save_account_manager_note(text, text, text, uuid, text, bigint)
to service_role;

revoke all on function public.save_account_manager_note_family(text, text, text, uuid, text, bigint, jsonb)
from public, anon, authenticated;
grant execute on function public.save_account_manager_note_family(text, text, text, uuid, text, bigint, jsonb)
to service_role;

notify pgrst, 'reload schema';
