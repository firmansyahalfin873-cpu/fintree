import { verifyPayment } from './verify-payment.mjs';
import { recordPaid } from './record-paid.mjs';

/**
 * Reconcile one candidate transaction using invoice values from private storage.
 * Discovery, retries, finality policy and post-finality monitoring belong to the caller.
 */
export async function reconcilePayment({ db, provider, invoiceId, transactionHash, confirmations }) {
  if (typeof invoiceId !== 'string' || !/^0x[0-9a-f]{64}$/i.test(invoiceId)) throw new TypeError('Invalid invoice ID');
  const row = (await db.query('select * from fintree_private.invoices where id = $1', [invoiceId.toLowerCase()])).rows[0];
  if (!row) return { status: 'not_found' };
  if (row.status === 'paid') return { status: 'paid', recorded: false };
  const invoice = { invoiceId: row.id, chainId: BigInt(row.chain_id), contract: row.contract_address, token: row.token_address,
    merchant: row.merchant_address, merchantAmount: BigInt(row.merchant_amount), protocolFee: BigInt(row.protocol_fee),
    deadline: BigInt(Math.floor(new Date(row.deadline).getTime() / 1000)) };
  const verification = await verifyPayment({ provider, transactionHash, invoice, confirmations });
  // A transaction may be re-included in a different block and revert or no longer
  // contain the payment event. Forget only the stale confirming observation;
  // the scanner will continue looking for another valid payment.
  if (row.status === 'confirming' && verification.status === 'rejected' && verification.observedBlockHash &&
      row.block_hash && verification.observedBlockHash.toLowerCase() !== row.block_hash.toLowerCase() && row.tx_hash?.toLowerCase() === transactionHash.toLowerCase()) {
    const cleared = await db.query(`update fintree_private.invoices set status=case when deadline < now() then 'expired' else 'pending' end,
      tx_hash=null,block_hash=null,block_number=null,payer_address=null,rechecked_at=null
      where id=$1 and status='confirming' and tx_hash=$2 and block_hash=$3 returning status`, [row.id, row.tx_hash, row.block_hash]);
    return cleared.rows.length ? { status: 'pending', reason: 'reorg_payment_removed' } : { status: 'conflict' };
  }
  if (verification.status === 'paid') {
    const result = await recordPaid(db, row.id, verification);
    if (result.recorded) return { status: 'paid', recorded: true };
    const current = (await db.query('select status from fintree_private.invoices where id=$1', [row.id])).rows[0];
    return current?.status === 'paid' ? { status: 'paid', recorded: false } : { status: 'conflict' };
  }
  if (verification.status === 'confirming') {
    const updated = await db.query(`update fintree_private.invoices set status='confirming', tx_hash=$2, block_hash=$3, block_number=$4, payer_address=$5
      where id=$1 and status in ('pending','expired','confirming') and (tx_hash is null or tx_hash=$2) returning id`,
    [row.id, verification.evidence.transactionHash.toLowerCase(), verification.evidence.blockHash.toLowerCase(), verification.evidence.blockNumber, verification.evidence.payer.toLowerCase()]);
    if (!updated.rows.length) return { status: 'conflict' };
  }
  if (verification.status === 'pending' && ['noncanonical_receipt', 'receipt_not_found'].includes(verification.reason)) {
    await db.query(`update fintree_private.invoices set status=case when deadline < now() then 'expired' else 'pending' end,
      tx_hash=null, block_hash=null, block_number=null, payer_address=null, rechecked_at=null where id=$1 and status='confirming' and tx_hash=$2`, [row.id, transactionHash.toLowerCase()]);
  }
  return verification;
}
