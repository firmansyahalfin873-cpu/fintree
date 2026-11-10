import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, parseAmount } from '../src/domain/money.mjs';

test('parses token amounts exactly without floating point', () => {
  assert.equal(parseAmount('15.000001'), 15000001n);
  assert.equal(parseAmount('9007199254740993.123456'), 9007199254740993123456n);
  assert.equal(parseAmount('3', 0), 3n);
});

test('rejects malformed values and precision that cannot be represented', () => {
  for (const value of ['-1', '1e2', '01', '1.', '.1', '1.0000001', '', ' 1']) {
    assert.throws(() => parseAmount(value), RangeError, value);
  }
  assert.throws(() => parseAmount(1), TypeError);
});

test('charges the selected payer and preserves the settlement total', () => {
  const amount = parseAmount('100');
  const customer = calculateQuote(amount, 'customer');
  const merchant = calculateQuote(amount, 'merchant');
  assert.deepEqual(customer, { invoiceAmount: amount, protocolFee: 300000n, totalPayable: 100300000n, merchantReceives: amount });
  assert.deepEqual(merchant, { invoiceAmount: amount, protocolFee: 300000n, totalPayable: amount, merchantReceives: 99700000n });
  for (const quote of [customer, merchant]) assert.equal(quote.totalPayable, quote.merchantReceives + quote.protocolFee);
});

test('rounds fees to the closest atomic unit with ties up', () => {
  assert.equal(calculateQuote(4999n, 'customer', 1).protocolFee, 0n);
  assert.equal(calculateQuote(5000n, 'customer', 1).protocolFee, 1n);
  assert.equal(calculateQuote(15000n, 'customer', 1).protocolFee, 2n);
});

test('rejects invalid quote inputs', () => {
  assert.throws(() => calculateQuote(0n, 'customer'), RangeError);
  assert.throws(() => calculateQuote(-1n, 'customer'), RangeError);
  assert.throws(() => calculateQuote(1n, 'other'), RangeError);
  assert.throws(() => calculateQuote(1n, 'customer', 10001), RangeError);
  assert.throws(() => calculateQuote(1n, 'customer', 1.5), RangeError);
});
