/** Export only visible payment fields. Never include API credentials, signatures or metadata. */
const columns = ['order_reference', 'payment_id', 'status', 'needs_review', 'chain_id', 'token_address', 'order_amount', 'protocol_fee', 'fee_payer', 'customer_pays', 'merchant_receives', 'expires_utc'];

function amount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new TypeError('Invalid payment amount');
  const n = BigInt(value), fraction = (n % 1000000n).toString().padStart(6, '0');
  return `${n / 1000000n}.${fraction}`;
}

function cell(value) {
  let text = String(value);
  // Spreadsheet applications can evaluate cells as formulas, even when quoted.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function paymentsToCsv(payments) {
  if (!Array.isArray(payments)) throw new TypeError('Payments must be a list');
  const rows = payments.map((payment) => {
    if (!Number.isSafeInteger(payment.deadline) || payment.deadline < 0) throw new TypeError('Invalid payment deadline');
    return [payment.orderId, payment.id, payment.status, payment.reviewRequired ? 'yes' : 'no', payment.chainId, payment.token,
      amount(payment.invoiceAmount), amount(payment.protocolFee), payment.feePayer, amount(payment.totalPayable), amount(payment.merchantAmount),
      new Date(payment.deadline * 1000).toISOString()].map(cell).join(',');
  });
  return '\ufeff' + [columns.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
}
