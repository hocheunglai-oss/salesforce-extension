import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260723125141_buyer_invoice_reminder_rules.sql', import.meta.url);
const functionUrl = new URL('../api/functions/[name].js', import.meta.url);
const pageUrl = new URL('../src/pages/BuyerInvoices.jsx', import.meta.url);

test('migration keeps reminder rules server-only, revisioned, and audited', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /salesforce_account_id text primary key/i);
  assert.match(sql, /policy in \('standard', 'overdue_only'\)/i);
  assert.match(sql, /char_length\(note\) <= 255/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.buyer_invoice_reminder_rules\s+from public, anon, authenticated/i);
  assert.match(sql, /security invoker/ig);
  assert.match(sql, /changed after it was opened/i);
  assert.match(sql, /buyer_invoice_reminder_rule_saved/i);
  assert.match(sql, /buyer_invoice_reminder_rule_removed/i);
  assert.match(sql, /p_replace_child_overrides/i);
});

test('server validates Salesforce Accounts and enforces eligibility again before send', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /\['ParentId', 'reference'\]/);
  assert.match(source, /referenceTo\?\.includes\('Account'\)/);
  assert.match(source, /\['Company_Code__c', 'string'\]/);
  assert.match(source, /\['Is_Broker__c', 'boolean'\]/);
  assert.match(source, /WHERE Inactive_Suspended__c = false[\s\S]*Is_Broker__c = false[\s\S]*Company_Code__c != null[\s\S]*Buyer_Payment_Term__c != null OR RecordType\.Name = 'Group'/);
  assert.match(source, /Boolean\(String\(account\.Company_Code__c \|\| ''\)\.trim\(\)\)/);
  assert.match(source, /childCount: children\.length/);
  assert.match(source, /eligibleChildCount: children\.length/);
  assert.match(source, /buyerInvoiceReminderRulesList: \['buyer_invoices'\]/);
  assert.match(source, /report\.paymentReminderRulesAvailable !== true/);
  assert.match(source, /evaluateBuyerReminderSelection\(candidates/);
  assert.match(source, /selection\.unknownStemIds\.length/);
  assert.match(source, /selection\.restrictedRows\.length/);
  assert.match(source, /paymentReminderRoutingForRows\(eligibleCandidates\)/);
});

test('Buyer Invoices exposes rule management and disables restricted selections', async () => {
  const source = await readFile(pageUrl, 'utf8');
  assert.match(source, /function ReminderRulesModal/);
  assert.match(source, />Reminder Rules</);
  assert.match(source, /GROUP \+ children/);
  assert.match(source, /Replace direct child overrides/);
  assert.match(source, /Use GROUP rule/);
  assert.match(source, /Overdue reminders only/);
  assert.match(source, /REMINDER_RULES_PAGE_SIZE = 100/);
  assert.match(source, /visibleAccounts = filteredAccounts\.slice/);
  assert.match(source, /Search Account name, CL Key, GROUP, rule, or note/);
  assert.match(source, /accountClKeyLabel\(account\.clKey\)/);
  assert.doesNotMatch(source, /account\.accountId\.slice\(-6\)/);
  assert.match(source, /disabled=\{row\.paymentReminderEligible !== true\}/);
  assert.match(source, /data-reminder-state=\{row\.paymentReminderEligible !== true/);
  assert.match(source, /'blocked'[\s\S]*'sent-today'[\s\S]*'available'/);
  assert.match(source, /row\.paymentReminderEligible !== true[\s\S]*<X className="h-3\.5 w-3\.5"/);
  assert.match(source, /reminderSentToday[\s\S]*<Check className="h-3\.5 w-3\.5"/);
  assert.match(source, /disabled:!pointer-events-auto/);
  assert.match(source, /disabled=\{!reminderEligible\}/);
});
