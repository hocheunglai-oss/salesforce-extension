import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  accountNameKey,
  accountRole,
  buildAccountManagerRows,
  expandLegacyAccountManager,
  groupEligibleSalesforceAccounts,
  normalizeAccountManagerUserIds,
  normalizeAccountName,
} from '../api/_accountManagers.js';

const migrationUrl = new URL('../supabase/migrations/20260722053528_account_managers.sql', import.meta.url);
const groupPropagationMigrationUrl = new URL('../supabase/migrations/20260722064852_account_manager_group_propagation.sql', import.meta.url);
const notesMigrationUrl = new URL('../supabase/migrations/20260722073320_account_manager_notes.sql', import.meta.url);
const groupScopesMigrationUrl = new URL('../supabase/migrations/20260722075428_account_manager_group_scopes.sql', import.meta.url);
const functionUrl = new URL('../api/functions/[name].js', import.meta.url);
const pageUrl = new URL('../src/pages/AccountManagers.jsx', import.meta.url);

const buyer = (overrides = {}) => ({
  Id: '0012x00000AAAAAABC',
  Name: 'Shared Account',
  Buyer_Payment_Term__c: '30 days',
  Supplier_Payment_Term__c: null,
  Is_Broker__c: false,
  Inactive_Suspended__c: false,
  Account_Manager__c: '',
  ...overrides,
});

test('normalizes Account names into a stable case-insensitive group key', () => {
  assert.equal(normalizeAccountName('  ACME   Bunker  '), 'acme bunker');
  assert.equal(normalizeAccountName('ＡＣＭＥ'), 'acme');
  assert.equal(accountNameKey('ACME Bunker'), accountNameKey(' acme   bunker '));
  assert.match(accountNameKey('ACME Bunker'), /^[a-f0-9]{64}$/);
});

test('classifies only active eligible Account records with broker precedence', () => {
  assert.equal(accountRole(buyer()), 'buyer');
  assert.equal(accountRole(buyer({ Supplier_Payment_Term__c: '45 days' })), 'buyer_supplier');
  assert.equal(accountRole(buyer({ Is_Broker__c: true, Supplier_Payment_Term__c: '45 days' })), 'broker');
  assert.equal(accountRole(buyer({ Buyer_Payment_Term__c: null, Supplier_Payment_Term__c: '45 days' })), null);
  assert.equal(accountRole(buyer({ Buyer_Payment_Term__c: null })), null);
  assert.equal(accountRole(buyer({ Inactive_Suspended__c: true })), null);
});

test('groups active same-name records once and excludes supplier-only records', () => {
  const groups = groupEligibleSalesforceAccounts([
    buyer(),
    buyer({
      Id: '0012x00000BBBBBDEF',
      Name: ' shared account ',
      Supplier_Payment_Term__c: '60 days',
    }),
    buyer({
      Id: '0012x00000CCCCCXYZ',
      Buyer_Payment_Term__c: null,
      Supplier_Payment_Term__c: '30 days',
    }),
    buyer({ Id: '0012x00000DDDDDXYZ', Name: 'Inactive Buyer', Inactive_Suspended__c: true }),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].accountName, 'Shared Account');
  assert.deepEqual(groups[0].salesforceAccountIds, ['0012x00000AAAAAABC', '0012x00000BBBBBDEF']);
  assert.deepEqual(groups[0].roles, ['buyer', 'buyer_supplier']);
});

test('identifies GROUP parents and their eligible child Account names', () => {
  const groupAccount = buyer({
    Id: '0012x00000GROUPAAB',
    Name: 'GROUP - SHARED',
    RecordType: { Name: 'Group' },
  });
  const groups = groupEligibleSalesforceAccounts([
    groupAccount,
    buyer({
      Id: '0012x00000CHILDAAB',
      Name: 'AAA Shared Child',
      ParentId: groupAccount.Id,
      Parent: { Name: groupAccount.Name },
      RecordType: { Name: 'Buyer' },
    }),
  ]);

  const parent = groups.find((group) => group.accountName === groupAccount.Name);
  const child = groups.find((group) => group.accountName === 'AAA Shared Child');
  assert.equal(groups[0].accountName, 'GROUP - SHARED');
  assert.equal(parent.isGroupAccount, true);
  assert.deepEqual(parent.childAccountNames, ['AAA Shared Child']);
  assert.equal(parent.childAccountCount, 1);
  assert.deepEqual(child.parentGroupNames, ['GROUP - SHARED']);
  assert.deepEqual(child.parentGroupKeys, [parent.accountNameKey]);
});

test('accepts zero to three unique manager users and rejects invalid assignments', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const third = '33333333-3333-4333-8333-333333333333';
  const fourth = '44444444-4444-4444-8444-444444444444';

  assert.deepEqual(normalizeAccountManagerUserIds([]), []);
  assert.deepEqual(normalizeAccountManagerUserIds([first, second, third]), [first, second, third]);
  assert.throws(() => normalizeAccountManagerUserIds([first, first]), /same manager/i);
  assert.throws(() => normalizeAccountManagerUserIds([first, second, third, fourth]), /at most three/i);
  assert.throws(() => normalizeAccountManagerUserIds(['local-admin']), /valid FCOS user/i);
});

test('joins assignments by Account name and reports Salesforce drift', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const key = accountNameKey('Shared Account');
  const rows = buildAccountManagerRows({
    salesforceAccounts: [buyer({ Account_Manager__c: 'Old Manager' })],
    managedGroups: [{ account_name_key: key, revision: 4, salesforce_sync_status: 'synced' }],
    assignments: [{ account_name_key: key, manager_user_id: userId, assignment_order: 1 }],
    profiles: [{ id: userId, full_name: 'Vincent Lee', email: 'vincent@example.com', active: true }],
    accountNotes: [{
      account_name_key: key,
      account_note: 'Review coverage monthly.',
      revision: 2,
      updated_at: '2026-07-22T07:00:00Z',
      updated_by_email: 'vincent@example.com',
      source_group_account_name_key: accountNameKey('GROUP - SHARED'),
      source_group_account_name: 'GROUP - SHARED',
    }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].managerCount, 1);
  assert.equal(rows[0].managers[0].fullName, 'Vincent Lee');
  assert.equal(rows[0].revision, 4);
  assert.equal(rows[0].salesforceSyncStatus, 'drift');
  assert.equal(rows[0].accountNote, 'Review coverage monthly.');
  assert.equal(rows[0].noteRevision, 2);
  assert.equal(rows[0].noteUpdatedByEmail, 'vincent@example.com');
  assert.equal(rows[0].noteSourceGroupAccountName, 'GROUP - SHARED');
});

test('inherits ordered GROUP managers when a child has no direct override', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const groupAccount = buyer({
    Id: '0012x00000GROUPAAB',
    Name: 'GROUP - SHARED',
    RecordType: { Name: 'Group' },
    Account_Manager__c: 'Vincent Lee / Otto Lai',
  });
  const groupKey = accountNameKey(groupAccount.Name);
  const rows = buildAccountManagerRows({
    salesforceAccounts: [
      groupAccount,
      buyer({
        Id: '0012x00000CHILDAAB',
        Name: 'Shared Child',
        ParentId: groupAccount.Id,
        Parent: { Name: groupAccount.Name },
        RecordType: { Name: 'Buyer' },
        Account_Manager__c: 'Vincent Lee / Otto Lai',
      }),
    ],
    managedGroups: [{
      account_name_key: groupKey,
      account_name: groupAccount.Name,
      revision: 3,
      salesforce_sync_status: 'synced',
      propagate_to_children: true,
    }],
    assignments: [
      { account_name_key: groupKey, manager_user_id: first, assignment_order: 1 },
      { account_name_key: groupKey, manager_user_id: second, assignment_order: 2 },
    ],
    profiles: [
      { id: first, full_name: 'Vincent Lee', email: 'vincent@example.com', active: true },
      { id: second, full_name: 'Otto Lai', email: 'otto@example.com', active: true },
    ],
    accountNotes: [{
      account_name_key: groupKey,
      account_note: 'GROUP-only note',
      revision: 1,
    }],
  });

  const child = rows.find((row) => row.accountName === 'Shared Child');
  const group = rows.find((row) => row.accountName === 'GROUP - SHARED');
  assert.deepEqual(child.managers.map((manager) => manager.fullName), ['Vincent Lee', 'Otto Lai']);
  assert.equal(child.assignmentSource, 'group');
  assert.equal(child.inheritedFromGroupName, 'GROUP - SHARED');
  assert.equal(group.accountNote, 'GROUP-only note');
  assert.equal(child.accountNote, '');
  assert.equal(child.revision, 0);
  assert.equal(child.salesforceSyncStatus, 'synced');
  assert.equal(group.propagateToChildren, true);
});

test('does not inherit GROUP managers when child propagation is disabled', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const groupAccount = buyer({
    Id: '0012x00000GROUPAAB',
    Name: 'GROUP - SHARED',
    RecordType: { Name: 'Group' },
    Account_Manager__c: 'Vincent Lee',
  });
  const groupKey = accountNameKey(groupAccount.Name);
  const rows = buildAccountManagerRows({
    salesforceAccounts: [
      groupAccount,
      buyer({
        Id: '0012x00000CHILDAAB',
        Name: 'Shared Child',
        ParentId: groupAccount.Id,
        Parent: { Name: groupAccount.Name },
        RecordType: { Name: 'Buyer' },
        Account_Manager__c: 'Vincent Lee',
      }),
    ],
    managedGroups: [{
      account_name_key: groupKey,
      account_name: groupAccount.Name,
      revision: 4,
      salesforce_sync_status: 'synced',
      propagate_to_children: false,
    }],
    assignments: [{ account_name_key: groupKey, manager_user_id: userId, assignment_order: 1 }],
    profiles: [{ id: userId, full_name: 'Vincent Lee', email: 'vincent@example.com', active: true }],
  });

  const child = rows.find((row) => row.accountName === 'Shared Child');
  assert.deepEqual(child.managers, []);
  assert.equal(child.assignmentSource, 'none');
  assert.equal(child.inheritedFromGroupName, '');
});

test('expands legacy initials and replaces Sam Yip with Vincent Lee', () => {
  assert.equal(expandLegacyAccountManager('KZ / SC / OL'), 'Kelvin Zeng / Stanley Chui / Otto Lai');
  assert.equal(expandLegacyAccountManager('SY'), 'Vincent Lee');
  assert.equal(expandLegacyAccountManager('SY/VL'), 'Vincent Lee');
  assert.throws(() => expandLegacyAccountManager('XX'), /unknown legacy/i);
});

test('migration enforces limits, revision locking, RLS, and service-role-only access', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const groupSql = await readFile(groupPropagationMigrationUrl, 'utf8');
  const notesSql = await readFile(notesMigrationUrl, 'utf8');
  const scopeSql = await readFile(groupScopesMigrationUrl, 'utf8');
  assert.match(sql, /assignment_order between 1 and 3/i);
  assert.match(sql, /unique \(account_name_key, assignment_order\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.account_manager_groups from public, anon, authenticated/i);
  assert.match(sql, /create or replace function public\.save_account_manager_group/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /changed after it was opened/i);
  assert.match(sql, /account_managers_updated/i);
  assert.match(sql, /grant execute on function public\.save_account_manager_group[\s\S]*to service_role/i);
  assert.match(groupSql, /create or replace function public\.save_account_manager_group_family/i);
  assert.match(groupSql, /delete from public\.account_manager_groups[\s\S]*account_name_key = any\(v_child_keys\)/i);
  assert.match(groupSql, /security invoker/i);
  assert.match(groupSql, /revoke all on function public\.save_account_manager_group_family[\s\S]*from public, anon, authenticated/i);
  assert.match(notesSql, /create table if not exists public\.account_manager_notes/i);
  assert.match(notesSql, /char_length\(account_note\) <= 255/i);
  assert.match(notesSql, /enable row level security/i);
  assert.match(notesSql, /create or replace function public\.save_account_manager_note/i);
  assert.match(notesSql, /pg_advisory_xact_lock/i);
  assert.match(notesSql, /changed after it was opened/i);
  assert.match(notesSql, /account_manager_note_updated/i);
  assert.match(notesSql, /revoke all on function public\.save_account_manager_note[\s\S]*from public, anon, authenticated/i);
  assert.match(notesSql, /grant execute on function public\.save_account_manager_note[\s\S]*to service_role/i);
  assert.match(scopeSql, /add column if not exists propagate_to_children boolean not null default false/i);
  assert.match(scopeSql, /create or replace function public\.save_account_manager_group_with_scope/i);
  assert.match(scopeSql, /p_propagate_to_children boolean/i);
  assert.match(scopeSql, /create or replace function public\.save_account_manager_note_family/i);
  assert.match(scopeSql, /source_group_account_name_key/i);
  assert.match(scopeSql, /account_manager_note_group_propagated/i);
  assert.match(scopeSql, /revoke all on function public\.save_account_manager_note_family[\s\S]*from public, anon, authenticated/i);
});

test('server revalidates eligibility and updates every grouped Salesforce Account atomically', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /Inactive_Suspended__c = false[\s\S]*Is_Broker__c = true OR Buyer_Payment_Term__c != null/i);
  assert.match(source, /Account_Manager__c supports only[\s\S]*Increase it to 255/i);
  assert.match(source, /body: \{ allOrNone: true, records \}/);
  assert.match(source, /save_account_manager_group_with_scope/);
  assert.match(source, /p_propagate_to_children = propagateToChildren/);
  assert.match(source, /childAccountsByKey/);
  assert.match(source, /RecordType\.Name/);
  assert.match(source, /ParentId IN/);
  assert.match(source, /accountManagersList: \['buyers_administrator'\]/);
  assert.match(source, /accountManagersSave: \['buyers_administrator'\]/);
  assert.match(source, /accountManagersSaveNote: \['buyers_administrator'\]/);
  assert.match(source, /accountManagersRetrySync: \['buyers_administrator'\]/);
  assert.match(source, /from\('account_manager_notes'\)/);
  assert.match(source, /save_account_manager_note_family/);
  assert.match(source, /propagateToChildren: groupResult\.data\.propagate_to_children === true/);
  assert.match(source, /enforceSalesforceWriteLimit: false/);
});

test('page edits rows inline with explicit save and cancel controls', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /invoke\('accountManagersList'/);
  assert.match(source, /invoke\('accountManagersSave'/);
  assert.match(source, /invoke\('accountManagersSaveNote'/);
  assert.match(source, /title="Cancel changes"/);
  assert.match(source, /title="Save Account managers"/);
  assert.match(source, /title="Edit Account note"/);
  assert.match(source, /title="Save Account note"/);
  assert.match(source, /maxLength=\{255\}/);
  assert.match(source, /<TableHead>Notes<\/TableHead>/);
  assert.match(source, /<DragDropContext/);
  assert.match(source, /Drag to change priority/);
  assert.match(source, /Edit GROUP Account managers\?/);
  assert.match(source, /Edit GROUP Account note\?/);
  assert.match(source, /GROUP \+ children/);
  assert.match(source, /GROUP only stops inheritance/);
  assert.match(source, /GROUP \+ children replaces existing child notes/);
  assert.match(source, /Account Managers Methodology/);
  assert.match(source, /Search Accounts, groups or managers/);
  assert.match(source, /Unassigned/);
  assert.doesNotMatch(source, />Manage</);
});
