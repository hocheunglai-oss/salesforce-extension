import test from 'node:test';
import assert from 'node:assert/strict';
import { disputeQueueExtraCostProductName } from '../api/_disputeQueue.js';

function extraCostProduct(name) {
  return { Product2Id__r: { Name: name } };
}

test('hides transport, undercharge, and adjustment extra-cost products', () => {
  assert.equal(disputeQueueExtraCostProductName(extraCostProduct('Transport (Barge Included)')), '');
  assert.equal(disputeQueueExtraCostProductName(extraCostProduct('UNDERCHARGE-')), '');
  assert.equal(disputeQueueExtraCostProductName(extraCostProduct('Price Adjustment')), '');
});

test('keeps other extra-cost product names without adding quantity text', () => {
  assert.equal(disputeQueueExtraCostProductName(extraCostProduct('SPECIAL DISCOUNT')), 'SPECIAL DISCOUNT');
  assert.equal(disputeQueueExtraCostProductName({ Product__r: { Name: 'Survey fee' } }), 'Survey fee');
});
