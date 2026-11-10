/**
 * Persist a paid result from the trusted verifier and enqueue its event in one
 * database statement. Never call with evidence supplied by a browser or API user.
 */
export async function recordPaid(db, invoiceId, verification) {
  if (verification?.status !== 'paid' || !verification.evidence || typeof invoiceId !== 'string' || verification.evidence.invoiceId?.toLowerCase() !== invoiceId.toLowerCase()) throw new TypeError('A matching verified paid result is required');
  const evidence = verification.evidence;
  const result = await db.query(`
    with updated as (
      update fintree_private.invoices
      set status = 'paid', tx_hash = $2, block_hash = $3, block_number = $4,
          payer_address = $5, paid_at = now()
      where id = $1 and status in ('pending', 'confirming', 'expired')
        and chain_id = $6::numeric and contract_address = $7 and token_address = $8
        and merchant_address = $9 and merchant_amount = $10::numeric
        and protocol_fee = $11::numeric and deadline = to_timestamp($12::double precision)
      returning id, merchant_id, external_order_id, tx_hash, payer_address,
                invoice_amount, merchant_amount, protocol_fee
    ), queued as (
      insert into fintree_private.webhook_outbox (event_id, invoice_id, event_type, payload)
      select 'evt_' || id, id, 'checkout.session.completed',
        jsonb_build_object('id', 'evt_' || id, 'type', 'checkout.session.completed', 'schema_version', 1, 'created_at', now(),
          'data', jsonb_build_object('invoice_id', id, 'order_id', external_order_id,
            'tx_hash', tx_hash, 'payer_address', payer_address,
            'invoice_amount_atomic', invoice_amount::text,
            'merchant_amount_atomic', merchant_amount::text, 'protocol_fee_atomic', protocol_fee::text))
      from updated
      returning event_id
    ) select event_id from queued
  `, [invoiceId.toLowerCase(), evidence.transactionHash.toLowerCase(), evidence.blockHash.toLowerCase(), evidence.blockNumber, evidence.payer.toLowerCase(),
    evidence.chainId.toString(), evidence.contract.toLowerCase(), evidence.token.toLowerCase(), evidence.merchant.toLowerCase(),
    evidence.merchantAmount.toString(), evidence.protocolFee.toString(), evidence.deadline.toString()]);
  return { recorded: result.rows.length === 1, eventId: result.rows[0]?.event_id ?? null };
}
