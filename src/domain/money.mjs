/** Parse an unsigned decimal amount into exact atomic units. */
export function parseAmount(value, decimals = 6) {
  if (typeof value !== 'string' || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new TypeError('Amount must be a decimal string and decimals must be between 0 and 18');
  }
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > decimals) {
    throw new RangeError('Invalid amount or excess decimal precision');
  }
  const fraction = (match[2] ?? '').padEnd(decimals, '0');
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction || '0');
}

/** Compute a quote in atomic units, rounding half up to the nearest unit. */
export function calculateQuote(amount, feePayer, feeBps = 30) {
  if (typeof amount !== 'bigint' || amount <= 0n) throw new RangeError('Amount must be positive atomic units');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw new RangeError('Invalid fee basis points');
  if (feePayer !== 'customer' && feePayer !== 'merchant') throw new RangeError('Invalid fee payer');
  const fee = (amount * BigInt(feeBps) + 5000n) / 10000n;
  return {
    invoiceAmount: amount,
    protocolFee: fee,
    totalPayable: feePayer === 'customer' ? amount + fee : amount,
    merchantReceives: feePayer === 'merchant' ? amount - fee : amount,
  };
}
