import test from 'node:test';
import assert from 'node:assert/strict';
import { grossMarginPercent } from '../api/_dashboardMetrics.js';

test('calculates gross margin percentage from monthly profit and turnover', () => {
  assert.equal(grossMarginPercent(25_000, 500_000), 5);
  assert.equal(grossMarginPercent(-10_000, 200_000), -5);
});

test('returns null when monthly turnover cannot produce a meaningful margin', () => {
  assert.equal(grossMarginPercent(10_000, 0), null);
  assert.equal(grossMarginPercent('invalid', 100_000), null);
  assert.equal(grossMarginPercent(10_000, undefined), null);
});
