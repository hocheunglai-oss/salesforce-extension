import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260712120242_operational_workflow_hardening.sql', import.meta.url);
const functionUrl = new URL('../api/functions/[name].js', import.meta.url);
const appClientUrl = new URL('../src/api/appClient.js', import.meta.url);

test('operational migration adds atomic collection and exception workflow writes', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.save_buyer_invoice_collection/i);
  assert.match(sql, /for update;/i);
  assert.match(sql, /changed after it was opened/i);
  assert.match(sql, /create table if not exists public\.exception_review_items/i);
  assert.match(sql, /create table if not exists public\.exception_review_events/i);
  assert.match(sql, /create or replace function public\.save_exception_review_item/i);
  assert.match(sql, /delivery_status in \('sending', 'sent', 'failed', 'uncertain'\)/i);
  assert.match(sql, /revoke all on function public\.save_exception_review_item/i);
});

test('sensitive workflow actions use managed capabilities', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /requireCapability\(client, profile, 'disputes_approve'/);
  assert.match(source, /requireCapability\(client, profile, 'disputes_account'/);
  assert.match(source, /requireCapability\(client, profile, 'buyer_invoices_manage'/);
  assert.match(source, /requireCapability\(client, profile, 'cashflow_forecast_manage'/);
  assert.doesNotMatch(source, /DISPUTE_BETA_APPROVER_EMAILS/);
});

test('short-lived function cache expires and can be cleared at an auth boundary', async () => {
  const source = await readFile(appClientUrl, 'utf8');
  assert.match(source, /DEFAULT_FUNCTION_CACHE_TTL_MS = 30_000/);
  assert.match(source, /Date\.now\(\) - cached\.cachedAtMs <= ttlMs/);
  assert.match(source, /functionResponseCache\.delete\(cacheKey\)/);
  assert.match(source, /clearFunctionCache\(\);\s*\n\s*if \(isSupabaseConfigured\) await supabase\.auth\.signOut/);
});

test('report archive compensates cross-system failures', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /googleDriveTrashFile\(driveFile\.id\)/);
  assert.match(source, /googleDriveRenameFile\(current\.drive_file_id, current\.file_name\)/);
  assert.match(source, /googleDriveRestoreFile\(current\.drive_file_id\)/);
});
