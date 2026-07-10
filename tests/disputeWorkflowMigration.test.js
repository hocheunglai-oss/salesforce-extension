import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260710115129_supabase_owned_dispute_parties.sql', import.meta.url);
const functionUrl = new URL('../api/functions/[name].js', import.meta.url);

test('migration deletes only the disputes mirror and adds normalized workflow parties', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /drop table if exists public\.disputes;/i);
  assert.doesNotMatch(sql, /drop table[^;]+cascade/i);
  assert.match(sql, /create table if not exists public\.dispute_workflow_parties/i);
  assert.match(sql, /unique \(case_id, account_key\)/i);
  assert.match(sql, /create unique index dispute_workflow_documents_stem_filename_uidx/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function public\.save_dispute_workflow_draft/i);
});

test('workflow backend does not query, write, or link the Salesforce Dispute object', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.doesNotMatch(source, /FROM\s+Dispute__c/i);
  assert.doesNotMatch(source, /sobjects\/Dispute__c/i);
  assert.doesNotMatch(source, /recordsLinkedToStemByLookup\('Dispute__c'/i);
});

test('workflow queue includes invoiced and uninvoiced STEM extra-cost products', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /item\['Product2Id__r'\]\?\.Name/);
  assert.match(source, /supplierInvoiceProductRowsById\.get\(item\.Supplier_Invoice__c\)/);
  assert.match(source, /uninvoicedExtraCostProductRows\.push/);
});
