import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateSupplierDispute,
  resolveSupplierSettlementSchema,
  sortSupplierInvoicesOldestFirst,
  supplierInstructionRows,
  validSupplierSettlementPayment,
} from '../api/_disputeSupplierSettlement.js';

function invoice(id, amount, payable, dueDate, extra = {}) {
  return {
    supplierInvoiceId: id,
    invoiceName: `INV-${id}`,
    supplierAccountId: '001000000000001AAA',
    invoiceAmount: amount,
    payableBalance: payable,
    dueDate,
    currencyIsoCode: extra.currency || 'USD',
    invoiceDate: extra.invoiceDate || null,
    createdDate: extra.createdDate || null,
  };
}

test('sorts supplier invoices by due date, invoice date, then ID', () => {
  const rows = sortSupplierInvoicesOldestFirst([
    invoice('C', 100, 100, null, { invoiceDate: '2025-12-01' }),
    invoice('B', 100, 100, '2026-01-01'),
    invoice('A', 100, 100, '2026-01-01'),
  ]);
  assert.deepEqual(rows.map((row) => row.supplierInvoiceId), ['A', 'B', 'C']);
});

test('allocates oldest first and separates unpaid withholding from paid recovery', () => {
  const result = allocateSupplierDispute({
    disputeAmount: 150,
    invoices: [
      invoice('newer', 200, 200, '2026-02-01'),
      invoice('older', 100, 20, '2026-01-01'),
    ],
  });
  assert.equal(result.totalDoNotPay, 70);
  assert.equal(result.totalGetBackPaid, 80);
  assert.deepEqual(result.allocations.map((row) => ({
    id: row.supplierInvoiceId,
    allocated: row.allocatedAmount,
    hold: row.doNotPayAmount,
    getBack: row.getBackPaidAmount,
  })), [
    { id: 'older', allocated: 100, hold: 20, getBack: 80 },
    { id: 'newer', allocated: 50, hold: 50, getBack: 0 },
  ]);
});

test('supports editable invoice allocations while filling the remainder oldest first', () => {
  const result = allocateSupplierDispute({
    disputeAmount: 80,
    invoices: [
      invoice('older', 100, 100, '2026-01-01'),
      invoice('newer', 100, 0, '2026-02-01'),
    ],
    invoiceAllocations: [{ supplierInvoiceId: 'newer', amount: 60 }],
  });
  assert.deepEqual(result.allocations.map((row) => [row.supplierInvoiceId, row.allocatedAmount]), [
    ['older', 20],
    ['newer', 60],
  ]);
  assert.equal(result.totalDoNotPay, 20);
  assert.equal(result.totalGetBackPaid, 60);
});

test('recalculates later payments without changing the approved dispute total', () => {
  const approved = allocateSupplierDispute({
    disputeAmount: 100,
    invoices: [invoice('invoice', 100, 60, '2026-01-01')],
  });
  const later = allocateSupplierDispute({
    disputeAmount: 100,
    invoices: [invoice('invoice', 100, 40, '2026-01-01')],
    invoiceAllocations: [{ supplierInvoiceId: 'invoice', amount: 100 }],
  });
  assert.equal(approved.disputeAmount, later.disputeAmount);
  assert.equal(approved.totalDoNotPay, 60);
  assert.equal(approved.totalGetBackPaid, 40);
  assert.equal(later.totalDoNotPay, 40);
  assert.equal(later.totalGetBackPaid, 60);
  assert.notEqual(approved.fingerprint, later.fingerprint);
});

test('creates invoice-level hold and get-back accounting instructions', () => {
  const allocation = allocateSupplierDispute({
    disputeAmount: 100,
    invoices: [invoice('invoice', 100, 40, '2026-01-01')],
  });
  const instructions = supplierInstructionRows(allocation);
  assert.deepEqual(instructions.map((row) => [row.instruction_type, row.planned_amount, row.status]), [
    ['withhold_unpaid', 40, 'Provisional Hold'],
    ['get_back_paid', 60, 'Pending Accounting'],
  ]);
});

test('treats fully paid, overpaid, and zero-payable invoices as paid recovery', () => {
  const fullyPaid = allocateSupplierDispute({
    disputeAmount: 75,
    invoices: [invoice('paid', 100, 0, '2026-01-01')],
  });
  assert.equal(fullyPaid.totalDoNotPay, 0);
  assert.equal(fullyPaid.totalGetBackPaid, 75);
  assert.equal(fullyPaid.allocations[0].paymentState, 'Paid');

  const overpaid = allocateSupplierDispute({
    disputeAmount: 40,
    invoices: [invoice('overpaid', 100, -20, '2026-01-01')],
  });
  assert.equal(overpaid.totalDoNotPay, 0);
  assert.equal(overpaid.totalGetBackPaid, 40);
  assert.equal(overpaid.allocations[0].paymentState, 'Overpaid');
  assert.match(overpaid.allocations[0].warnings.join(' '), /negative/);
});

test('keeps same-name supplier Account IDs and invoice currencies separate', () => {
  const result = allocateSupplierDispute({
    disputeAmount: 50,
    currencyIsoCode: 'USD',
    invoices: [
      invoice('wrong-account', 100, 100, '2026-01-01', { currency: 'HKD' }),
      invoice('correct', 100, 25, '2026-02-01', { currency: 'USD' }),
    ],
  });
  assert.deepEqual(result.allocations.map((row) => row.supplierInvoiceId), ['correct']);
  assert.equal(result.totalDoNotPay, 25);
  assert.equal(result.totalGetBackPaid, 25);
});

test('rejects forged invoice allocations and excessive dispute totals', () => {
  assert.throws(() => allocateSupplierDispute({
    disputeAmount: 10,
    invoices: [invoice('valid', 100, 100, '2026-01-01')],
    invoiceAllocations: [{ supplierInvoiceId: 'forged', amount: 10 }],
  }), /unavailable supplier invoice/);
  assert.throws(() => allocateSupplierDispute({
    disputeAmount: 101,
    invoices: [invoice('valid', 100, 100, '2026-01-01')],
  }), /exceeds the available supplier invoices/);
});

test('fails closed when Salesforce financial relationships are unavailable', () => {
  const schema = resolveSupplierSettlementSchema({
    supplierInvoiceFields: [
      { name: 'Invoice_Amount__c', type: 'currency' },
      { name: 'Payable_Balance__c', type: 'currency' },
      { name: 'Supplier__c', type: 'string', referenceTo: [] },
    ],
    paymentFields: [
      { name: 'Amount__c', type: 'currency' },
      { name: 'Date__c', type: 'date' },
    ],
  });
  assert.equal(schema.valid, false);
  assert.match(schema.issues.join(' '), /Lookup\(Account\)/);
  assert.match(schema.issues.join(' '), /Lookup\(Supplier_Invoice__c\)/);
});

test('fails closed when Salesforce financial fields have non-numeric types', () => {
  const schema = resolveSupplierSettlementSchema({
    supplierInvoiceFields: [
      { name: 'Invoice_Amount__c', type: 'string' },
      { name: 'Payable_Balance__c', type: 'formula' },
      { name: 'Supplier__c', type: 'reference', referenceTo: ['Account'] },
    ],
    paymentFields: [
      { name: 'Amount__c', type: 'string' },
      { name: 'Date__c', type: 'string' },
      { name: 'Supplier_Invoice__c', type: 'reference', referenceTo: ['Supplier_Invoice__c'] },
    ],
  });
  assert.equal(schema.valid, false);
  assert.match(schema.issues.join(' '), /numeric invoice amount/);
  assert.match(schema.issues.join(' '), /numeric payable balance/);
  assert.match(schema.issues.join(' '), /numeric amount field/);
  assert.match(schema.issues.join(' '), /date or datetime/);
});

test('recognizes valid payment schema and excludes voided payments', () => {
  const schema = resolveSupplierSettlementSchema({
    supplierInvoiceFields: [
      { name: 'Invoice_Amount__c', type: 'currency' },
      { name: 'Payable_Balance__c', type: 'currency' },
      { name: 'Supplier__c', type: 'reference', referenceTo: ['Account'] },
    ],
    paymentFields: [
      { name: 'Amount__c', type: 'currency' },
      { name: 'Date__c', type: 'date' },
      { name: 'Supplier_Invoice__c', type: 'reference', referenceTo: ['Supplier_Invoice__c'] },
      { name: 'Status__c', type: 'picklist' },
    ],
  });
  assert.equal(schema.valid, true);
  assert.equal(validSupplierSettlementPayment({ Status__c: 'Completed' }, schema.paymentStatusFields), true);
  assert.equal(validSupplierSettlementPayment({ Status__c: 'Voided' }, schema.paymentStatusFields), false);
});
