import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../api/functions/[name].js', import.meta.url), 'utf8');
const workflowPageSource = readFileSync(new URL('../src/pages/DisputeWorkflow.jsx', import.meta.url), 'utf8');
const migrationSource = readFileSync(
  new URL('../supabase/migrations/20260724075339_paid_supplier_invoice_dispute_automation.sql', import.meta.url),
  'utf8',
);
const hardeningMigrationSource = readFileSync(
  new URL('../supabase/migrations/20260724121500_harden_supplier_dispute_accounting.sql', import.meta.url),
  'utf8',
);

test('supplier instruction storage is server-only, revisioned, and saved with the draft', () => {
  assert.match(migrationSource, /create table if not exists public\.dispute_workflow_supplier_instructions/i);
  assert.match(migrationSource, /enable row level security/i);
  assert.match(migrationSource, /revoke all on table public\.dispute_workflow_supplier_instructions from public, anon, authenticated/i);
  assert.match(migrationSource, /grant all on table public\.dispute_workflow_supplier_instructions to service_role/i);
  assert.match(migrationSource, /security invoker/i);
  assert.match(migrationSource, /v_action->'supplier_instructions'/i);
  assert.match(migrationSource, /supplier_hold_created/i);
  assert.match(migrationSource, /revision = dispute_workflow_supplier_instructions\.revision \+ 1/i);
});

test('supplier resolution routes revalidate allocations and expose invoice-level Finance controls', () => {
  assert.match(apiSource, /prepareSupplierSettlementAction/);
  assert.match(apiSource, /assertSupplierAllocationsCurrent/);
  assert.match(apiSource, /reconcileApprovedSupplierInstructions/);
  assert.match(apiSource, /disputeWorkflowSupplierInstructionUpdate/);
  assert.match(apiSource, /disputeWorkflowSupplierOffsetOptions/);
  assert.match(apiSource, /disputeWorkflowSupplierAmountAmend/);
  assert.match(apiSource, /supplier_instruction_id/);
  assert.match(apiSource, /Supplier payments changed after approval/);
});

test('approval, payment reconciliation, and Finance instruction updates use atomic database functions', () => {
  assert.match(apiSource, /client\.rpc\('approve_dispute_workflow_case'/);
  assert.match(apiSource, /client\.rpc\('reconcile_dispute_supplier_instructions'/);
  assert.match(apiSource, /client\.rpc\('update_dispute_supplier_instruction'/);
  assert.match(hardeningMigrationSource, /for update/i);
  assert.match(hardeningMigrationSource, /pg_advisory_xact_lock/i);
  assert.match(hardeningMigrationSource, /already reserved by another instruction/i);
  assert.match(hardeningMigrationSource, /supplier_instruction_id = new\.id/i);
  assert.match(hardeningMigrationSource, /security invoker/i);
  assert.match(hardeningMigrationSource, /from public, anon, authenticated/i);
  assert.match(hardeningMigrationSource, /to service_role/i);
});

test('legacy amount amendment is restricted to the responsible trader or administrator', () => {
  assert.match(apiSource, /profile\.user_type !== 'administrator' && !responsibleTrader/);
  assert.match(apiSource, /Only the responsible trader or an administrator/);
});

test('settlement evidence is linked to the exact supplier instruction', () => {
  assert.match(apiSource, /document\.supplier_instruction_id === instruction\.id/);
  assert.doesNotMatch(
    apiSource.match(/const hasEvidence = documents\.some[\s\S]*?\n  \)\);/)?.[0] || '',
    /document\.action_id/,
  );
});

test('new supplier financial outcomes count the commercial amount once', () => {
  const settlementBranch = apiSource.match(
    /if \(action\.action_type === 'resolve_supplier_dispute'[\s\S]*?\n    \}/,
  )?.[0] || '';
  assert.match(settlementBranch, /supplierImpact \+= amount/);
  assert.doesNotMatch(settlementBranch, /totalDoNotPay|totalGetBackPaid/);
});

test('workflow UI offers one new supplier resolution and invoice-level Finance controls', () => {
  assert.match(workflowPageSource, /value: 'resolve_supplier_dispute'.*partyType: 'supplier'/);
  assert.match(workflowPageSource, /const NEW_ACTION_TYPES = ACTION_TYPES\.filter\(\(action\) => !action\.legacy\)/);
  assert.match(workflowPageSource, /Invoice allocation preview/);
  assert.match(workflowPageSource, /Acknowledge urgent hold/);
  assert.match(workflowPageSource, /Cash refund from supplier/);
  assert.match(workflowPageSource, /Offset against another supplier invoice/);
  assert.match(workflowPageSource, /supplierInstructionId: supplierInstruction\?\.id/);
});
