import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentsToCsv } from '../src/ui/payment-export.mjs';

const payment = { orderId: 'order, "one"', id: `0x${'a'.repeat(64)}`, status: 'paid', reviewRequired: false,
  chainId: '84532', token: `0x${'b'.repeat(40)}`, invoiceAmount: '9007199254740993123456',
  protocolFee: '300000', totalPayable: '9007199254740993423456', merchantAmount: '9007199254740993123456',
  feePayer: 'customer', deadline: 1700000000, signature: 'must-not-appear', metadata: { secret: 'must-not-appear' } };

test('payment export preserves precision, quotes values, and excludes private fields', () => {
  const csv = paymentsToCsv([payment]);
  assert.ok(csv.startsWith('\ufeff"order_reference"'));
  assert.match(csv, /"order, ""one"""/);
  assert.match(csv, /"9007199254740993\.123456"/);
  assert.match(csv, /"0\.300000"/);
  assert.match(csv, /2023-11-14T22:13:20\.000Z/);
  assert.doesNotMatch(csv, /must-not-appear|signature|metadata/);
});

test('payment export neutralizes spreadsheet formulas and rejects invalid amounts', () => {
  for (const orderId of ['=1+1', ' +cmd', '@bad', '-formula', '\t=cmd']) {
    assert.ok(paymentsToCsv([{ ...payment, orderId }]).includes(`"'${orderId}"`));
  }
  assert.throws(() => paymentsToCsv([{ ...payment, totalPayable: '1e6' }]), TypeError);
});
