create unique index if not exists dispute_beta_actions_id_case_uidx
on public.dispute_beta_actions(id, case_id);

create table if not exists public.dispute_workflow_supplier_instructions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.dispute_beta_cases(id) on delete cascade,
  action_id uuid not null,
  party_id uuid not null,
  stem_id text not null,
  source_supplier_invoice_id text not null,
  source_supplier_invoice_name text null,
  source_stem_id text not null,
  target_supplier_invoice_id text null,
  target_supplier_invoice_name text null,
  target_stem_id text null,
  instruction_type text not null
    check (instruction_type in ('withhold_unpaid', 'get_back_paid')),
  recovery_method text null,
  currency_iso_code text not null
    check (currency_iso_code ~ '^[A-Z]{3}$'),
  planned_amount numeric(18, 2) not null check (planned_amount >= 0),
  allocated_amount numeric(18, 2) not null check (allocated_amount >= 0),
  source_invoice_amount_snapshot numeric(18, 2) null,
  source_payable_balance_snapshot numeric(18, 2) null,
  source_paid_amount_snapshot numeric(18, 2) null,
  target_invoice_amount_snapshot numeric(18, 2) null,
  target_payable_amount_snapshot numeric(18, 2) null,
  source_invoice_snapshot jsonb not null default '{}'::jsonb,
  source_stem_snapshot jsonb not null default '{}'::jsonb,
  target_invoice_snapshot jsonb not null default '{}'::jsonb,
  target_stem_snapshot jsonb not null default '{}'::jsonb,
  payment_snapshot jsonb not null default '{}'::jsonb,
  allocation_fingerprint text not null default '',
  status text not null default 'Provisional Hold'
    check (status in (
      'Provisional Hold',
      'Hold Acknowledged',
      'Pending Accounting',
      'Instruction Issued',
      'Settled',
      'Not Required',
      'Superseded'
    )),
  matched_salesforce_payment_id text null,
  matching_payment_snapshot jsonb not null default '{}'::jsonb,
  instruction_reference text null,
  instruction_date date null,
  instruction_amount numeric(18, 2) null,
  settlement_reference text null,
  settlement_date date null,
  settlement_amount numeric(18, 2) null,
  accounting_note text null,
  revision integer not null default 1 check (revision > 0),
  acknowledged_by uuid null references public.user_profiles(id) on delete set null,
  acknowledged_by_email text null,
  acknowledged_at timestamptz null,
  instruction_by uuid null references public.user_profiles(id) on delete set null,
  instruction_by_email text null,
  instructed_at timestamptz null,
  settled_by uuid null references public.user_profiles(id) on delete set null,
  settled_by_email text null,
  settled_at timestamptz null,
  created_by uuid null references public.user_profiles(id) on delete set null,
  created_by_email text null,
  updated_by uuid null references public.user_profiles(id) on delete set null,
  updated_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispute_workflow_supplier_instructions_party_case_fkey
    foreign key (party_id, case_id)
    references public.dispute_workflow_parties(id, case_id)
    on delete restrict,
  constraint dispute_workflow_supplier_instructions_action_case_fkey
    foreign key (action_id, case_id)
    references public.dispute_beta_actions(id, case_id)
    on delete cascade,
  constraint dispute_workflow_supplier_instructions_recovery_method_check
    check (recovery_method is null or instruction_type = 'get_back_paid')
);

create index if not exists dispute_workflow_supplier_instructions_case_idx
on public.dispute_workflow_supplier_instructions(case_id, created_at desc);

create index if not exists dispute_workflow_supplier_instructions_stem_idx
on public.dispute_workflow_supplier_instructions(stem_id, created_at desc);

create index if not exists dispute_workflow_supplier_instructions_action_idx
on public.dispute_workflow_supplier_instructions(action_id, created_at desc);

create index if not exists dispute_workflow_supplier_instructions_party_idx
on public.dispute_workflow_supplier_instructions(party_id, created_at desc);

create index if not exists dispute_workflow_supplier_instructions_source_invoice_idx
on public.dispute_workflow_supplier_instructions(source_supplier_invoice_id);

create index if not exists dispute_workflow_supplier_instructions_target_invoice_idx
on public.dispute_workflow_supplier_instructions(target_supplier_invoice_id)
where target_supplier_invoice_id is not null;

create index if not exists dispute_workflow_supplier_instructions_status_idx
on public.dispute_workflow_supplier_instructions(status, updated_at desc);

create unique index if not exists dispute_workflow_supplier_instructions_active_uidx
on public.dispute_workflow_supplier_instructions(action_id, source_supplier_invoice_id, instruction_type)
where status <> 'Superseded';

alter table public.dispute_workflow_supplier_instructions enable row level security;
revoke all on table public.dispute_workflow_supplier_instructions from public, anon, authenticated;
grant all on table public.dispute_workflow_supplier_instructions to service_role;

alter table public.dispute_workflow_documents
  add column if not exists supplier_instruction_id uuid null
    references public.dispute_workflow_supplier_instructions(id) on delete set null;

create index if not exists dispute_workflow_documents_supplier_instruction_idx
on public.dispute_workflow_documents(supplier_instruction_id, created_at desc)
where supplier_instruction_id is not null;

alter table public.dispute_beta_actions
  drop constraint if exists dispute_beta_actions_action_type_check;

alter table public.dispute_beta_actions
  add constraint dispute_beta_actions_action_type_check
  check (action_type in (
    'hold_supplier_payment',
    'pay_full_supplier_invoice',
    'deduct_specific_amount',
    'resolve_supplier_dispute',
    'issue_buyer_credit_note',
    'close_supplier_dispute',
    'close_buyer_dispute'
  ));

alter table public.dispute_beta_events
  drop constraint if exists dispute_beta_events_event_type_check;

alter table public.dispute_beta_events
  add constraint dispute_beta_events_event_type_check
  check (event_type in (
    'draft_saved',
    'submitted',
    'approved',
    'rejected',
    'revision_requested',
    'action_executed',
    'accounting_updated',
    'document_uploaded',
    'closed',
    'salesforce_writeback',
    'supplier_hold_created',
    'supplier_hold_acknowledged',
    'supplier_payment_reconciled',
    'supplier_recovery_adjusted',
    'supplier_recovery_method_selected',
    'supplier_recovery_settled'
  ));

create or replace function public.save_dispute_workflow_draft(
  p_case jsonb,
  p_parties jsonb,
  p_actions jsonb,
  p_actor jsonb,
  p_event_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_actor_id uuid := nullif(p_actor->>'id', '')::uuid;
  v_actor_email text := nullif(p_actor->>'email', '');
  v_party jsonb;
  v_action jsonb;
  v_instruction jsonb;
  v_party_id uuid;
  v_action_id uuid;
  v_instruction_id uuid;
begin
  if jsonb_typeof(p_parties) <> 'array' or jsonb_array_length(p_parties) = 0 then
    raise exception 'At least one disputed Account is required.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Actions must be a JSON array.' using errcode = '22023';
  end if;

  insert into public.dispute_beta_cases (
    stem_id, stem_name, buyer_name, supplier_names, current_salesforce_status,
    workflow_status, approval_status, latest_note, settlement_financials,
    settlement_pnl, updated_at
  ) values (
    p_case->>'stem_id', nullif(p_case->>'stem_name', ''), nullif(p_case->>'buyer_name', ''),
    nullif(p_case->>'supplier_names', ''), nullif(p_case->>'current_salesforce_status', ''),
    coalesce(nullif(p_case->>'workflow_status', ''), 'Draft'),
    coalesce(nullif(p_case->>'approval_status', ''), 'Draft'),
    coalesce(p_case->>'latest_note', ''), coalesce(p_case->'settlement_financials', '{}'::jsonb),
    coalesce(nullif(p_case->>'settlement_pnl', '')::numeric, 0), now()
  )
  on conflict (stem_id) do update set
    stem_name = excluded.stem_name,
    buyer_name = excluded.buyer_name,
    supplier_names = excluded.supplier_names,
    current_salesforce_status = excluded.current_salesforce_status,
    workflow_status = excluded.workflow_status,
    approval_status = excluded.approval_status,
    latest_note = excluded.latest_note,
    settlement_financials = excluded.settlement_financials,
    settlement_pnl = excluded.settlement_pnl,
    updated_at = now()
  returning id into v_case_id;

  for v_party in select value from jsonb_array_elements(p_parties)
  loop
    insert into public.dispute_workflow_parties (
      case_id, stem_id, account_id, account_key, account_name, roles, source_types,
      source_record_ids, payment_terms, products, cancelled_source_only,
      created_by, created_by_email, updated_by, updated_by_email, updated_at
    ) values (
      v_case_id, p_case->>'stem_id', v_party->>'account_id', v_party->>'account_key',
      coalesce(v_party->>'account_name', ''),
      array(select jsonb_array_elements_text(coalesce(v_party->'roles', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'source_types', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'source_record_ids', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'payment_terms', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_party->'products', '[]'::jsonb))),
      coalesce((v_party->>'cancelled_source_only')::boolean, false),
      v_actor_id, v_actor_email, v_actor_id, v_actor_email, now()
    )
    on conflict (case_id, account_key) do update set
      account_id = excluded.account_id,
      account_name = excluded.account_name,
      roles = excluded.roles,
      source_types = excluded.source_types,
      source_record_ids = excluded.source_record_ids,
      payment_terms = excluded.payment_terms,
      products = excluded.products,
      cancelled_source_only = excluded.cancelled_source_only,
      updated_by = excluded.updated_by,
      updated_by_email = excluded.updated_by_email,
      updated_at = now();
  end loop;

  delete from public.dispute_beta_actions a
  where a.case_id = v_case_id
    and not exists (
      select 1
      from jsonb_array_elements(p_actions) action_json
      where nullif(action_json->>'id', '')::uuid = a.id
    );

  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    select id into v_party_id
    from public.dispute_workflow_parties
    where case_id = v_case_id and account_key = v_action->>'party_account_key';
    if v_party_id is null then
      raise exception 'Action references an unselected disputed Account.' using errcode = '23503';
    end if;

    v_action_id := nullif(v_action->>'id', '')::uuid;
    if v_action_id is not null and exists (
      select 1 from public.dispute_beta_actions where id = v_action_id and case_id = v_case_id
    ) then
      update public.dispute_beta_actions set
        party_id = v_party_id,
        party_side = v_action->>'party_side',
        action_type = v_action->>'action_type',
        action_label = coalesce(v_action->>'action_label', ''),
        amount = nullif(v_action->>'amount', '')::numeric,
        special_sell_price = nullif(v_action->>'special_sell_price', '')::numeric,
        special_buy_price = nullif(v_action->>'special_buy_price', '')::numeric,
        quantity = nullif(v_action->>'quantity', '')::numeric,
        quantity_unit = coalesce(nullif(v_action->>'quantity_unit', ''), 'MT'),
        close_reason = nullif(v_action->>'close_reason', ''),
        balance_payment_instruction = nullif(v_action->>'balance_payment_instruction', ''),
        description = coalesce(v_action->>'description', ''),
        requires_attachment = coalesce((v_action->>'requires_attachment')::boolean, false),
        execution_status = coalesce(nullif(v_action->>'execution_status', ''), 'Pending Accounting'),
        updated_by = v_actor_id,
        updated_by_email = v_actor_email,
        updated_at = now()
      where id = v_action_id and case_id = v_case_id;
    else
      insert into public.dispute_beta_actions (
        case_id, stem_id, party_id, party_side, action_type, action_label, amount,
        special_sell_price, special_buy_price, quantity, quantity_unit, close_reason,
        balance_payment_instruction, description, requires_attachment, execution_status,
        created_by, created_by_email, updated_by, updated_by_email
      ) values (
        v_case_id, p_case->>'stem_id', v_party_id, v_action->>'party_side',
        v_action->>'action_type', coalesce(v_action->>'action_label', ''),
        nullif(v_action->>'amount', '')::numeric,
        nullif(v_action->>'special_sell_price', '')::numeric,
        nullif(v_action->>'special_buy_price', '')::numeric,
        nullif(v_action->>'quantity', '')::numeric,
        coalesce(nullif(v_action->>'quantity_unit', ''), 'MT'),
        nullif(v_action->>'close_reason', ''),
        nullif(v_action->>'balance_payment_instruction', ''),
        coalesce(v_action->>'description', ''),
        coalesce((v_action->>'requires_attachment')::boolean, false),
        coalesce(nullif(v_action->>'execution_status', ''), 'Pending Accounting'),
        v_actor_id, v_actor_email, v_actor_id, v_actor_email
      )
      returning id into v_action_id;
    end if;

    if v_action ? 'supplier_instructions' then
      if jsonb_typeof(v_action->'supplier_instructions') <> 'array' then
        raise exception 'Supplier instructions must be a JSON array.' using errcode = '22023';
      end if;
      if jsonb_array_length(v_action->'supplier_instructions') > 0
        and v_action->>'party_side' <> 'supplier' then
        raise exception 'Supplier instructions require a supplier action.' using errcode = '23514';
      end if;

      delete from public.dispute_workflow_supplier_instructions si
      where si.action_id = v_action_id
        and not exists (
          select 1
          from jsonb_array_elements(v_action->'supplier_instructions') instruction_json
          where nullif(instruction_json->>'id', '')::uuid = si.id
             or (
               instruction_json->>'source_supplier_invoice_id' = si.source_supplier_invoice_id
               and instruction_json->>'instruction_type' = si.instruction_type
             )
        );

      for v_instruction in select value from jsonb_array_elements(v_action->'supplier_instructions')
      loop
        v_instruction_id := nullif(v_instruction->>'id', '')::uuid;
        if v_instruction_id is null then
          select id into v_instruction_id
          from public.dispute_workflow_supplier_instructions
          where action_id = v_action_id
            and case_id = v_case_id
            and source_supplier_invoice_id = v_instruction->>'source_supplier_invoice_id'
            and instruction_type = v_instruction->>'instruction_type'
            and status <> 'Superseded'
          order by created_at desc
          limit 1;
        end if;
        if v_instruction_id is not null and exists (
          select 1
          from public.dispute_workflow_supplier_instructions
          where id = v_instruction_id and action_id = v_action_id and case_id = v_case_id
        ) then
          update public.dispute_workflow_supplier_instructions set
            party_id = v_party_id,
            stem_id = p_case->>'stem_id',
            source_supplier_invoice_id = v_instruction->>'source_supplier_invoice_id',
            source_supplier_invoice_name = nullif(v_instruction->>'source_supplier_invoice_name', ''),
            source_stem_id = v_instruction->>'source_stem_id',
            target_supplier_invoice_id = nullif(v_instruction->>'target_supplier_invoice_id', ''),
            target_supplier_invoice_name = nullif(v_instruction->>'target_supplier_invoice_name', ''),
            target_stem_id = nullif(v_instruction->>'target_stem_id', ''),
            instruction_type = v_instruction->>'instruction_type',
            recovery_method = nullif(v_instruction->>'recovery_method', ''),
            currency_iso_code = v_instruction->>'currency_iso_code',
            planned_amount = nullif(v_instruction->>'planned_amount', '')::numeric,
            allocated_amount = nullif(v_instruction->>'allocated_amount', '')::numeric,
            source_invoice_amount_snapshot = nullif(v_instruction->>'source_invoice_amount_snapshot', '')::numeric,
            source_payable_balance_snapshot = nullif(v_instruction->>'source_payable_balance_snapshot', '')::numeric,
            source_paid_amount_snapshot = nullif(v_instruction->>'source_paid_amount_snapshot', '')::numeric,
            target_invoice_amount_snapshot = nullif(v_instruction->>'target_invoice_amount_snapshot', '')::numeric,
            target_payable_amount_snapshot = nullif(v_instruction->>'target_payable_amount_snapshot', '')::numeric,
            source_invoice_snapshot = coalesce(v_instruction->'source_invoice_snapshot', '{}'::jsonb),
            source_stem_snapshot = coalesce(v_instruction->'source_stem_snapshot', '{}'::jsonb),
            target_invoice_snapshot = coalesce(v_instruction->'target_invoice_snapshot', '{}'::jsonb),
            target_stem_snapshot = coalesce(v_instruction->'target_stem_snapshot', '{}'::jsonb),
            payment_snapshot = coalesce(v_instruction->'payment_snapshot', '{}'::jsonb),
            allocation_fingerprint = coalesce(v_instruction->>'allocation_fingerprint', ''),
            status = case
              when status = 'Hold Acknowledged'
                and allocation_fingerprint = coalesce(v_instruction->>'allocation_fingerprint', '')
                and coalesce(nullif(v_instruction->>'status', ''), 'Provisional Hold') = 'Provisional Hold'
                then status
              else coalesce(nullif(v_instruction->>'status', ''), 'Provisional Hold')
            end,
            acknowledged_by = case
              when allocation_fingerprint = coalesce(v_instruction->>'allocation_fingerprint', '')
                then acknowledged_by
              else null
            end,
            acknowledged_by_email = case
              when allocation_fingerprint = coalesce(v_instruction->>'allocation_fingerprint', '')
                then acknowledged_by_email
              else null
            end,
            acknowledged_at = case
              when allocation_fingerprint = coalesce(v_instruction->>'allocation_fingerprint', '')
                then acknowledged_at
              else null
            end,
            matched_salesforce_payment_id = nullif(v_instruction->>'matched_salesforce_payment_id', ''),
            matching_payment_snapshot = coalesce(v_instruction->'matching_payment_snapshot', '{}'::jsonb),
            instruction_reference = nullif(v_instruction->>'instruction_reference', ''),
            instruction_date = nullif(v_instruction->>'instruction_date', '')::date,
            instruction_amount = nullif(v_instruction->>'instruction_amount', '')::numeric,
            settlement_reference = nullif(v_instruction->>'settlement_reference', ''),
            settlement_date = nullif(v_instruction->>'settlement_date', '')::date,
            settlement_amount = nullif(v_instruction->>'settlement_amount', '')::numeric,
            accounting_note = nullif(v_instruction->>'accounting_note', ''),
            revision = dispute_workflow_supplier_instructions.revision + 1,
            updated_by = v_actor_id,
            updated_by_email = v_actor_email,
            updated_at = now()
          where id = v_instruction_id and action_id = v_action_id and case_id = v_case_id;
        else
          insert into public.dispute_workflow_supplier_instructions (
            case_id, action_id, party_id, stem_id, source_supplier_invoice_id,
            source_supplier_invoice_name, source_stem_id, target_supplier_invoice_id,
            target_supplier_invoice_name, target_stem_id, instruction_type, recovery_method,
            currency_iso_code, planned_amount, allocated_amount, source_invoice_amount_snapshot,
            source_payable_balance_snapshot, source_paid_amount_snapshot,
            target_invoice_amount_snapshot, target_payable_amount_snapshot,
            source_invoice_snapshot, source_stem_snapshot, target_invoice_snapshot,
            target_stem_snapshot, payment_snapshot, allocation_fingerprint, status, matched_salesforce_payment_id,
            matching_payment_snapshot, instruction_reference, instruction_date,
            instruction_amount, settlement_reference, settlement_date, settlement_amount,
            accounting_note, revision, created_by, created_by_email, updated_by, updated_by_email
          ) values (
            v_case_id, v_action_id, v_party_id, p_case->>'stem_id',
            v_instruction->>'source_supplier_invoice_id',
            nullif(v_instruction->>'source_supplier_invoice_name', ''),
            v_instruction->>'source_stem_id',
            nullif(v_instruction->>'target_supplier_invoice_id', ''),
            nullif(v_instruction->>'target_supplier_invoice_name', ''),
            nullif(v_instruction->>'target_stem_id', ''),
            v_instruction->>'instruction_type', nullif(v_instruction->>'recovery_method', ''),
            v_instruction->>'currency_iso_code', nullif(v_instruction->>'planned_amount', '')::numeric,
            nullif(v_instruction->>'allocated_amount', '')::numeric,
            nullif(v_instruction->>'source_invoice_amount_snapshot', '')::numeric,
            nullif(v_instruction->>'source_payable_balance_snapshot', '')::numeric,
            nullif(v_instruction->>'source_paid_amount_snapshot', '')::numeric,
            nullif(v_instruction->>'target_invoice_amount_snapshot', '')::numeric,
            nullif(v_instruction->>'target_payable_amount_snapshot', '')::numeric,
            coalesce(v_instruction->'source_invoice_snapshot', '{}'::jsonb),
            coalesce(v_instruction->'source_stem_snapshot', '{}'::jsonb),
            coalesce(v_instruction->'target_invoice_snapshot', '{}'::jsonb),
            coalesce(v_instruction->'target_stem_snapshot', '{}'::jsonb),
            coalesce(v_instruction->'payment_snapshot', '{}'::jsonb),
            coalesce(v_instruction->>'allocation_fingerprint', ''),
            coalesce(nullif(v_instruction->>'status', ''), 'Provisional Hold'),
            nullif(v_instruction->>'matched_salesforce_payment_id', ''),
            coalesce(v_instruction->'matching_payment_snapshot', '{}'::jsonb),
            nullif(v_instruction->>'instruction_reference', ''),
            nullif(v_instruction->>'instruction_date', '')::date,
            nullif(v_instruction->>'instruction_amount', '')::numeric,
            nullif(v_instruction->>'settlement_reference', ''),
            nullif(v_instruction->>'settlement_date', '')::date,
            nullif(v_instruction->>'settlement_amount', '')::numeric,
            nullif(v_instruction->>'accounting_note', ''),
            coalesce(nullif(v_instruction->>'revision', '')::integer, 1),
            v_actor_id, v_actor_email, v_actor_id, v_actor_email
          )
          returning id into v_instruction_id;
          if v_instruction->>'instruction_type' = 'withhold_unpaid' then
            insert into public.dispute_beta_events (
              case_id, action_id, stem_id, event_type, note, metadata,
              actor_user_id, actor_email
            ) values (
              v_case_id, v_action_id, p_case->>'stem_id', 'supplier_hold_created',
              'Urgent Finance Do not pay instruction created from the trader draft.',
              jsonb_build_object(
                'supplierInstructionId', v_instruction_id,
                'sourceSupplierInvoiceId', v_instruction->>'source_supplier_invoice_id',
                'plannedAmount', nullif(v_instruction->>'planned_amount', '')::numeric,
                'currencyIsoCode', v_instruction->>'currency_iso_code'
              ),
              v_actor_id, v_actor_email
            );
          end if;
        end if;
      end loop;
    end if;
  end loop;

  delete from public.dispute_workflow_parties p
  where p.case_id = v_case_id
    and not exists (
      select 1
      from jsonb_array_elements(p_parties) party_json
      where party_json->>'account_key' = p.account_key
    );

  insert into public.dispute_beta_events (
    case_id, stem_id, event_type, note, actor_user_id, actor_email
  ) values (
    v_case_id, p_case->>'stem_id', 'draft_saved', nullif(p_event_note, ''), v_actor_id, v_actor_email
  );

  return v_case_id;
end;
$$;

revoke all on function public.save_dispute_workflow_draft(jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_dispute_workflow_draft(jsonb, jsonb, jsonb, jsonb, text) to service_role;
