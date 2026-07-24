import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disputeClosureDefaults,
  FULL_PAYMENT_RECEIVED_REASON,
  NO_BALANCE_PAYMENT_INSTRUCTION,
} from '../src/lib/disputeWorkflowDefaults.js';

test('prefills both supplier closure fields when payable and receivable are zero', () => {
  assert.deepEqual(
    disputeClosureDefaults({
      actionType: 'close_supplier_dispute',
      buyerReceivableBalance: 0,
      supplierPayableBalance: '0.00',
    }),
    {
      closeReason: FULL_PAYMENT_RECEIVED_REASON,
      balancePaymentInstruction: NO_BALANCE_PAYMENT_INSTRUCTION,
    },
  );
});

test('prefills buyer full-payment closure only when receivable is explicitly zero', () => {
  assert.deepEqual(
    disputeClosureDefaults({
      actionType: 'close_buyer_dispute',
      buyerReceivableBalance: 0,
      supplierPayableBalance: 0,
    }),
    {
      closeReason: FULL_PAYMENT_RECEIVED_REASON,
      balancePaymentInstruction: '',
    },
  );
  assert.equal(disputeClosureDefaults({
    actionType: 'close_buyer_dispute',
    buyerReceivableBalance: null,
  }).closeReason, '');
});

test('does not prefill closure fields for positive or missing balances', () => {
  assert.deepEqual(
    disputeClosureDefaults({
      actionType: 'close_supplier_dispute',
      buyerReceivableBalance: 100,
      supplierPayableBalance: undefined,
    }),
    {
      closeReason: '',
      balancePaymentInstruction: '',
    },
  );
});
