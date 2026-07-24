alter table public.dispute_workflow_supplier_instructions
  drop constraint if exists dispute_workflow_supplier_instructions_recovery_method_check;

alter table public.dispute_workflow_supplier_instructions
  add constraint dispute_workflow_supplier_instructions_recovery_method_check
  check (
    recovery_method is null
    or (
      instruction_type = 'get_back_paid'
      and recovery_method in ('cash_refund', 'future_invoice_offset')
    )
  );

create or replace function public.validate_dispute_supplier_instruction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.instruction_type = 'withhold_unpaid' and (
    new.recovery_method is not null
    or new.target_supplier_invoice_id is not null
    or new.matched_salesforce_payment_id is not null
  ) then
    raise exception 'Do not pay instructions cannot contain refund or offset details.' using errcode = '23514';
  end if;

  if new.instruction_type = 'get_back_paid'
    and new.status in ('Instruction Issued', 'Settled')
    and new.recovery_method is null then
    raise exception 'Get back paid amount requires a recovery method.' using errcode = '23514';
  end if;

  if new.recovery_method = 'future_invoice_offset'
    and new.target_supplier_invoice_id is null then
    raise exception 'Future invoice offset requires a target supplier invoice.' using errcode = '23514';
  end if;

  if new.recovery_method = 'cash_refund'
    and new.target_supplier_invoice_id is not null then
    raise exception 'Cash refund cannot contain an offset target invoice.' using errcode = '23514';
  end if;

  if new.status = 'Instruction Issued' and (
    new.instruction_date is null
    or (
      nullif(btrim(coalesce(new.instruction_reference, '')), '') is null
      and nullif(btrim(coalesce(new.accounting_note, '')), '') is null
    )
  ) then
    raise exception 'Instruction Issued requires a date and a reference or accounting note.' using errcode = '23514';
  end if;

  if new.status = 'Not Required'
    and nullif(btrim(coalesce(new.accounting_note, '')), '') is null then
    raise exception 'Not Required requires an accounting explanation.' using errcode = '23514';
  end if;

  if new.status = 'Settled' then
    if new.settlement_date is null then
      raise exception 'Settled requires a settlement date.' using errcode = '23514';
    end if;
    if new.settlement_amount is null
      or abs(new.settlement_amount - new.planned_amount) > 0.01 then
      raise exception 'Settlement amount must equal the planned amount.' using errcode = '23514';
    end if;
    if nullif(btrim(coalesce(new.settlement_reference, '')), '') is null
      and not exists (
        select 1
        from public.dispute_workflow_documents document
        where document.supplier_instruction_id = new.id
          and document.upload_status = 'complete'
          and document.document_type in (
            'supplier_credit_note',
            'settlement_agreement',
            'proof_of_payment'
          )
      ) then
      raise exception 'Settled requires a Finance reference or instruction-specific document.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_dispute_supplier_instruction_trigger
on public.dispute_workflow_supplier_instructions;

create trigger validate_dispute_supplier_instruction_trigger
before insert or update on public.dispute_workflow_supplier_instructions
for each row execute function public.validate_dispute_supplier_instruction();

revoke all on function public.validate_dispute_supplier_instruction() from public, anon, authenticated;
grant execute on function public.validate_dispute_supplier_instruction() to service_role;

create or replace function public.approve_dispute_workflow_case(
  p_case_id uuid,
  p_actor jsonb,
  p_note text,
  p_salesforce_status text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case public.dispute_beta_cases%rowtype;
  v_actor_id uuid := nullif(p_actor->>'id', '')::uuid;
  v_actor_email text := nullif(p_actor->>'email', '');
  v_now timestamptz := now();
  v_workflow_status text;
begin
  select * into v_case
  from public.dispute_beta_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'Dispute Workflow case not found.' using errcode = 'P0002';
  end if;
  if v_case.approval_status <> 'Pending Approval' then
    raise exception 'Only pending Dispute Workflow cases can be approved.' using errcode = '23514';
  end if;

  update public.dispute_beta_actions
  set execution_status = 'Pending Accounting',
      instruction_reference = null,
      instruction_date = null,
      instruction_amount = null,
      settlement_reference = null,
      settlement_date = null,
      settlement_amount = null,
      accounting_note = null,
      accounting_by = null,
      accounting_by_email = null,
      accounting_at = null,
      executed_by = null,
      executed_by_email = null,
      executed_at = null,
      execution_note = null,
      updated_by = v_actor_id,
      updated_by_email = v_actor_email,
      updated_at = v_now
  where case_id = p_case_id;

  update public.dispute_beta_actions
  set execution_status = 'Not Required',
      accounting_note = 'Approved with an explicit zero supplier recovery amount.',
      updated_at = v_now
  where case_id = p_case_id
    and action_type = 'resolve_supplier_dispute'
    and amount = 0;

  update public.dispute_workflow_supplier_instructions
  set status = 'Pending Accounting',
      recovery_method = null,
      target_supplier_invoice_id = null,
      target_supplier_invoice_name = null,
      target_stem_id = null,
      target_invoice_amount_snapshot = null,
      target_payable_amount_snapshot = null,
      target_invoice_snapshot = '{}'::jsonb,
      target_stem_snapshot = '{}'::jsonb,
      matched_salesforce_payment_id = null,
      matching_payment_snapshot = '{}'::jsonb,
      instruction_reference = null,
      instruction_date = null,
      instruction_amount = null,
      settlement_reference = null,
      settlement_date = null,
      settlement_amount = null,
      accounting_note = null,
      revision = revision + 1,
      updated_by = v_actor_id,
      updated_by_email = v_actor_email,
      updated_at = v_now
  where case_id = p_case_id
    and instruction_type = 'get_back_paid'
    and status <> 'Superseded';

  select case
    when exists (
      select 1 from public.dispute_beta_actions where case_id = p_case_id
    )
    and not exists (
      select 1
      from public.dispute_beta_actions
      where case_id = p_case_id
        and execution_status not in ('Settled', 'Not Required')
    )
    and not exists (
      select 1
      from public.dispute_workflow_supplier_instructions
      where case_id = p_case_id
        and status <> 'Superseded'
        and status not in ('Settled', 'Not Required')
    )
    then 'Settled - Ready to Close'
    else 'Approved - Pending Accounting'
  end into v_workflow_status;

  update public.dispute_beta_cases
  set workflow_status = v_workflow_status,
      approval_status = 'Approved',
      approved_by = v_actor_id,
      approved_by_email = v_actor_email,
      approved_at = v_now,
      rejection_reason = null,
      current_salesforce_status = p_salesforce_status,
      salesforce_writeback_status = 'success',
      salesforce_writeback_error = null,
      updated_at = v_now
  where id = p_case_id;

  insert into public.dispute_beta_events (
    case_id, stem_id, event_type, note, actor_user_id, actor_email
  ) values (
    p_case_id, v_case.stem_id, 'approved',
    coalesce(nullif(p_note, ''), 'Approved by dispute administrator.'),
    v_actor_id, v_actor_email
  );

  insert into public.dispute_beta_events (
    case_id, stem_id, event_type, note, metadata, actor_user_id, actor_email
  ) values (
    p_case_id, v_case.stem_id, 'salesforce_writeback',
    'Salesforce dispute status updated to ' || p_salesforce_status || '.',
    jsonb_build_object('salesforceStatus', p_salesforce_status, 'error', null),
    v_actor_id, v_actor_email
  );

  return p_case_id;
end;
$$;

revoke all on function public.approve_dispute_workflow_case(uuid, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.approve_dispute_workflow_case(uuid, jsonb, text, text)
to service_role;

create or replace function public.reconcile_dispute_supplier_instructions(
  p_case_id uuid,
  p_reconciliations jsonb,
  p_actor jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case public.dispute_beta_cases%rowtype;
  v_reconciliation jsonb;
  v_instruction jsonb;
  v_action_id uuid;
  v_instruction_id uuid;
  v_actor_id uuid := nullif(p_actor->>'id', '')::uuid;
  v_actor_email text := nullif(p_actor->>'email', '');
  v_now timestamptz := now();
begin
  if jsonb_typeof(p_reconciliations) <> 'array'
    or jsonb_array_length(p_reconciliations) = 0 then
    raise exception 'At least one supplier reconciliation is required.' using errcode = '22023';
  end if;

  select * into v_case
  from public.dispute_beta_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'Dispute Workflow case not found.' using errcode = 'P0002';
  end if;
  if v_case.approval_status <> 'Approved' or v_case.workflow_status = 'Closed' then
    raise exception 'Only an open approved dispute can be reconciled.' using errcode = '23514';
  end if;

  for v_reconciliation in select value from jsonb_array_elements(p_reconciliations)
  loop
    v_action_id := nullif(v_reconciliation->>'action_id', '')::uuid;
    if not exists (
      select 1
      from public.dispute_beta_actions
      where id = v_action_id
        and case_id = p_case_id
        and action_type = 'resolve_supplier_dispute'
    ) then
      raise exception 'Supplier reconciliation references an invalid action.' using errcode = '23503';
    end if;
    if jsonb_typeof(v_reconciliation->'instructions') <> 'array' then
      raise exception 'Supplier reconciliation instructions must be an array.' using errcode = '22023';
    end if;

    update public.dispute_workflow_supplier_instructions current_instruction
    set status = 'Superseded',
        revision = current_instruction.revision + 1,
        updated_by = v_actor_id,
        updated_by_email = v_actor_email,
        updated_at = v_now
    where current_instruction.case_id = p_case_id
      and current_instruction.action_id = v_action_id
      and current_instruction.status <> 'Superseded'
      and not exists (
        select 1
        from jsonb_array_elements(v_reconciliation->'instructions') desired
        where desired->>'source_supplier_invoice_id' = current_instruction.source_supplier_invoice_id
          and desired->>'instruction_type' = current_instruction.instruction_type
      );

    for v_instruction in
      select value from jsonb_array_elements(v_reconciliation->'instructions')
    loop
      if v_instruction->>'instruction_type' not in ('withhold_unpaid', 'get_back_paid') then
        raise exception 'Invalid supplier instruction type.' using errcode = '23514';
      end if;

      select id into v_instruction_id
      from public.dispute_workflow_supplier_instructions
      where case_id = p_case_id
        and action_id = v_action_id
        and source_supplier_invoice_id = v_instruction->>'source_supplier_invoice_id'
        and instruction_type = v_instruction->>'instruction_type'
        and status <> 'Superseded'
      for update;

      if v_instruction_id is null then
        insert into public.dispute_workflow_supplier_instructions (
          case_id, action_id, party_id, stem_id, source_supplier_invoice_id,
          source_supplier_invoice_name, source_stem_id, instruction_type,
          currency_iso_code, planned_amount, allocated_amount,
          source_invoice_amount_snapshot, source_payable_balance_snapshot,
          source_paid_amount_snapshot, source_invoice_snapshot, source_stem_snapshot,
          payment_snapshot, allocation_fingerprint, status,
          created_by, created_by_email, updated_by, updated_by_email, updated_at
        ) values (
          p_case_id, v_action_id, nullif(v_instruction->>'party_id', '')::uuid,
          v_case.stem_id, v_instruction->>'source_supplier_invoice_id',
          nullif(v_instruction->>'source_supplier_invoice_name', ''),
          coalesce(nullif(v_instruction->>'source_stem_id', ''), v_case.stem_id),
          v_instruction->>'instruction_type', v_instruction->>'currency_iso_code',
          nullif(v_instruction->>'planned_amount', '')::numeric,
          nullif(v_instruction->>'allocated_amount', '')::numeric,
          nullif(v_instruction->>'source_invoice_amount_snapshot', '')::numeric,
          nullif(v_instruction->>'source_payable_balance_snapshot', '')::numeric,
          nullif(v_instruction->>'source_paid_amount_snapshot', '')::numeric,
          coalesce(v_instruction->'source_invoice_snapshot', '{}'::jsonb),
          coalesce(v_instruction->'source_stem_snapshot', '{}'::jsonb),
          coalesce(v_instruction->'payment_snapshot', '{}'::jsonb),
          coalesce(v_instruction->>'allocation_fingerprint', ''),
          case when v_instruction->>'instruction_type' = 'withhold_unpaid'
            then 'Provisional Hold' else 'Pending Accounting' end,
          v_actor_id, v_actor_email, v_actor_id, v_actor_email, v_now
        );
      else
        update public.dispute_workflow_supplier_instructions
        set party_id = nullif(v_instruction->>'party_id', '')::uuid,
            stem_id = v_case.stem_id,
            source_supplier_invoice_name = nullif(v_instruction->>'source_supplier_invoice_name', ''),
            source_stem_id = coalesce(nullif(v_instruction->>'source_stem_id', ''), v_case.stem_id),
            currency_iso_code = v_instruction->>'currency_iso_code',
            planned_amount = nullif(v_instruction->>'planned_amount', '')::numeric,
            allocated_amount = nullif(v_instruction->>'allocated_amount', '')::numeric,
            source_invoice_amount_snapshot = nullif(v_instruction->>'source_invoice_amount_snapshot', '')::numeric,
            source_payable_balance_snapshot = nullif(v_instruction->>'source_payable_balance_snapshot', '')::numeric,
            source_paid_amount_snapshot = nullif(v_instruction->>'source_paid_amount_snapshot', '')::numeric,
            source_invoice_snapshot = coalesce(v_instruction->'source_invoice_snapshot', '{}'::jsonb),
            source_stem_snapshot = coalesce(v_instruction->'source_stem_snapshot', '{}'::jsonb),
            payment_snapshot = coalesce(v_instruction->'payment_snapshot', '{}'::jsonb),
            allocation_fingerprint = coalesce(v_instruction->>'allocation_fingerprint', ''),
            status = case when v_instruction->>'instruction_type' = 'withhold_unpaid'
              then 'Provisional Hold' else 'Pending Accounting' end,
            recovery_method = null,
            target_supplier_invoice_id = null,
            target_supplier_invoice_name = null,
            target_stem_id = null,
            target_invoice_amount_snapshot = null,
            target_payable_amount_snapshot = null,
            target_invoice_snapshot = '{}'::jsonb,
            target_stem_snapshot = '{}'::jsonb,
            matched_salesforce_payment_id = null,
            matching_payment_snapshot = '{}'::jsonb,
            instruction_reference = null,
            instruction_date = null,
            instruction_amount = null,
            settlement_reference = null,
            settlement_date = null,
            settlement_amount = null,
            accounting_note = null,
            acknowledged_by = null,
            acknowledged_by_email = null,
            acknowledged_at = null,
            settled_by = null,
            settled_by_email = null,
            settled_at = null,
            revision = revision + 1,
            updated_by = v_actor_id,
            updated_by_email = v_actor_email,
            updated_at = v_now
        where id = v_instruction_id;
      end if;
      v_instruction_id := null;
    end loop;

    update public.dispute_beta_actions
    set execution_status = 'Pending Accounting',
        updated_by = v_actor_id,
        updated_by_email = v_actor_email,
        updated_at = v_now
    where id = v_action_id;

    insert into public.dispute_beta_events (
      case_id, action_id, stem_id, event_type, note, metadata,
      actor_user_id, actor_email
    ) values (
      p_case_id, v_action_id, v_case.stem_id, 'supplier_recovery_adjusted',
      nullif(v_reconciliation->>'note', ''),
      coalesce(v_reconciliation->'metadata', '{}'::jsonb),
      v_actor_id, v_actor_email
    );
  end loop;

  update public.dispute_beta_cases
  set workflow_status = 'Accounting In Progress',
      updated_at = v_now
  where id = p_case_id;

  return p_case_id;
end;
$$;

revoke all on function public.reconcile_dispute_supplier_instructions(uuid, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.reconcile_dispute_supplier_instructions(uuid, jsonb, jsonb)
to service_role;

create or replace function public.update_dispute_supplier_instruction(
  p_instruction_id uuid,
  p_expected_revision integer,
  p_values jsonb,
  p_target_payable_amount numeric,
  p_actor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_instruction public.dispute_workflow_supplier_instructions%rowtype;
  v_case public.dispute_beta_cases%rowtype;
  v_status text := p_values->>'status';
  v_recovery_method text := nullif(p_values->>'recovery_method', '');
  v_target_invoice_id text := nullif(p_values->>'target_supplier_invoice_id', '');
  v_reserved_amount numeric := 0;
  v_actor_id uuid := nullif(p_actor->>'id', '')::uuid;
  v_actor_email text := nullif(p_actor->>'email', '');
  v_now timestamptz := now();
  v_action_status text;
  v_workflow_status text;
begin
  select * into v_instruction
  from public.dispute_workflow_supplier_instructions
  where id = p_instruction_id
  for update;

  if v_instruction.id is null then
    raise exception 'Supplier instruction not found.' using errcode = 'P0002';
  end if;
  if v_instruction.revision <> p_expected_revision then
    raise exception 'Supplier instruction revision conflict.' using errcode = '40001';
  end if;
  if v_instruction.status = 'Superseded' then
    raise exception 'Superseded supplier instruction cannot be updated.' using errcode = '23514';
  end if;

  select * into v_case
  from public.dispute_beta_cases
  where id = v_instruction.case_id
  for update;

  if v_status not in (
    'Provisional Hold', 'Hold Acknowledged', 'Pending Accounting',
    'Instruction Issued', 'Settled', 'Not Required'
  ) then
    raise exception 'Invalid supplier instruction status.' using errcode = '23514';
  end if;

  if v_recovery_method = 'future_invoice_offset' then
    if v_target_invoice_id is null or p_target_payable_amount is null then
      raise exception 'Offset target and payable balance are required.' using errcode = '23514';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('supplier-offset:' || left(v_target_invoice_id, 15), 0)
    );
    select coalesce(sum(planned_amount), 0) into v_reserved_amount
    from public.dispute_workflow_supplier_instructions
    where id <> p_instruction_id
      and recovery_method = 'future_invoice_offset'
      and left(target_supplier_invoice_id, 15) = left(v_target_invoice_id, 15)
      and status not in ('Not Required', 'Superseded');
    if v_reserved_amount + v_instruction.planned_amount > p_target_payable_amount + 0.01 then
      raise exception 'Offset target payable balance is already reserved by another instruction.'
        using errcode = '23514';
    end if;
  end if;

  update public.dispute_workflow_supplier_instructions
  set status = v_status,
      recovery_method = v_recovery_method,
      target_supplier_invoice_id = v_target_invoice_id,
      target_supplier_invoice_name = nullif(p_values->>'target_supplier_invoice_name', ''),
      target_stem_id = nullif(p_values->>'target_stem_id', ''),
      target_invoice_amount_snapshot = nullif(p_values->>'target_invoice_amount_snapshot', '')::numeric,
      target_payable_amount_snapshot = nullif(p_values->>'target_payable_amount_snapshot', '')::numeric,
      target_invoice_snapshot = coalesce(p_values->'target_invoice_snapshot', '{}'::jsonb),
      target_stem_snapshot = coalesce(p_values->'target_stem_snapshot', '{}'::jsonb),
      matched_salesforce_payment_id = nullif(p_values->>'matched_salesforce_payment_id', ''),
      matching_payment_snapshot = coalesce(p_values->'matching_payment_snapshot', '{}'::jsonb),
      instruction_reference = nullif(p_values->>'instruction_reference', ''),
      instruction_date = nullif(p_values->>'instruction_date', '')::date,
      instruction_amount = nullif(p_values->>'instruction_amount', '')::numeric,
      settlement_reference = nullif(p_values->>'settlement_reference', ''),
      settlement_date = nullif(p_values->>'settlement_date', '')::date,
      settlement_amount = nullif(p_values->>'settlement_amount', '')::numeric,
      accounting_note = nullif(p_values->>'accounting_note', ''),
      acknowledged_by = case when v_status = 'Hold Acknowledged'
        then v_actor_id else acknowledged_by end,
      acknowledged_by_email = case when v_status = 'Hold Acknowledged'
        then v_actor_email else acknowledged_by_email end,
      acknowledged_at = case when v_status = 'Hold Acknowledged'
        then v_now else acknowledged_at end,
      settled_by = case when v_status = 'Settled' then v_actor_id else null end,
      settled_by_email = case when v_status = 'Settled' then v_actor_email else null end,
      settled_at = case when v_status = 'Settled' then v_now else null end,
      revision = revision + 1,
      updated_by = v_actor_id,
      updated_by_email = v_actor_email,
      updated_at = v_now
  where id = p_instruction_id;

  if v_case.approval_status = 'Approved' then
    select case
      when not exists (
        select 1
        from public.dispute_workflow_supplier_instructions
        where action_id = v_instruction.action_id
          and status <> 'Superseded'
          and status not in ('Settled', 'Not Required')
      ) then case
        when not exists (
          select 1
          from public.dispute_workflow_supplier_instructions
          where action_id = v_instruction.action_id
            and status <> 'Superseded'
            and status <> 'Not Required'
        ) then 'Not Required'
        else 'Settled'
      end
      when exists (
        select 1
        from public.dispute_workflow_supplier_instructions
        where action_id = v_instruction.action_id
          and status not in ('Provisional Hold', 'Pending Accounting', 'Superseded')
      ) then 'Instruction Issued'
      else 'Pending Accounting'
    end into v_action_status;

    update public.dispute_beta_actions
    set execution_status = v_action_status,
        updated_by = v_actor_id,
        updated_by_email = v_actor_email,
        updated_at = v_now
    where id = v_instruction.action_id;

    select case
      when exists (
        select 1 from public.dispute_beta_actions where case_id = v_instruction.case_id
      )
      and not exists (
        select 1
        from public.dispute_beta_actions
        where case_id = v_instruction.case_id
          and execution_status not in ('Settled', 'Not Required')
      )
      and not exists (
        select 1
        from public.dispute_workflow_supplier_instructions
        where case_id = v_instruction.case_id
          and status <> 'Superseded'
          and status not in ('Settled', 'Not Required')
      ) then 'Settled - Ready to Close'
      when exists (
        select 1
        from public.dispute_beta_actions
        where case_id = v_instruction.case_id
          and execution_status <> 'Pending Accounting'
      ) or exists (
        select 1
        from public.dispute_workflow_supplier_instructions
        where case_id = v_instruction.case_id
          and status not in ('Provisional Hold', 'Pending Accounting', 'Superseded')
      ) then 'Accounting In Progress'
      else 'Approved - Pending Accounting'
    end into v_workflow_status;

    update public.dispute_beta_cases
    set workflow_status = v_workflow_status,
        updated_at = v_now
    where id = v_instruction.case_id;
  else
    v_workflow_status := v_case.workflow_status;
  end if;

  insert into public.dispute_beta_events (
    case_id, action_id, stem_id, event_type, note, metadata,
    actor_user_id, actor_email
  ) values (
    v_instruction.case_id, v_instruction.action_id, v_instruction.stem_id,
    coalesce(nullif(p_values->>'event_type', ''), 'accounting_updated'),
    nullif(p_values->>'event_note', ''),
    coalesce(p_values->'event_metadata', '{}'::jsonb),
    v_actor_id, v_actor_email
  );

  return jsonb_build_object(
    'instruction_id', p_instruction_id,
    'case_id', v_instruction.case_id,
    'workflow_status', v_workflow_status
  );
end;
$$;

revoke all on function public.update_dispute_supplier_instruction(uuid, integer, jsonb, numeric, jsonb)
from public, anon, authenticated;
grant execute on function public.update_dispute_supplier_instruction(uuid, integer, jsonb, numeric, jsonb)
to service_role;
