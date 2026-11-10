/** Public invoice lookup. The random invoice ID is a bearer-style checkout link. */
export function createPublicCheckoutHandler({ db }) {
  return async (request) => {
    const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
    const match = /^\/api\/v1\/public\/checkout\/sessions\/(0x[0-9a-fA-F]{64})$/.exec(new URL(request.url).pathname);
    if (request.method !== 'GET' || !match) return reply(404, { error: 'not_found' });
    try {
      const result = await db.query(`select i.id,i.status,i.external_order_id,i.chain_id,i.contract_address,i.token_address,
          i.merchant_address,i.invoice_amount,i.merchant_amount,i.protocol_fee,i.total_payable,i.fee_payer,i.deadline,i.quote_signature,i.return_url,m.business_name,
          exists(select 1 from fintree_private.payment_incidents p where p.invoice_id=i.id) as review_required
        from fintree_private.invoices i join fintree_private.merchants m on m.id=i.merchant_id where i.id=$1`, [match[1].toLowerCase()]);
      const row = result.rows[0];
      if (!row) return reply(404, { error: 'not_found' });
      return reply(200, { id: row.id, status: row.status, reviewRequired: Boolean(row.review_required), orderId: row.external_order_id, businessName: row.business_name,
        chainId: String(row.chain_id), contract: row.contract_address, token: row.token_address, merchant: row.merchant_address,
        invoiceAmount: String(row.invoice_amount), merchantAmount: String(row.merchant_amount), protocolFee: String(row.protocol_fee),
        totalPayable: String(row.total_payable), feePayer: row.fee_payer, deadline: Math.floor(new Date(row.deadline).getTime() / 1000), signature: row.quote_signature, returnUrl: row.return_url });
    } catch { return reply(500, { error: 'internal_error' }); }
  };
}
