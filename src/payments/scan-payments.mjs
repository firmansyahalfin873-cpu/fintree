import { Interface, getAddress } from 'ethers';
import { reconcilePayment } from './reconcile-payment.mjs';

const events = new Interface(['event PaymentFulfilled(bytes32 indexed invoiceId,address indexed merchant,address indexed payer,address token,uint256 merchantAmount,uint256 protocolFee)']);

/**
 * Scan a bounded range. The caller must persist its cursor only after success,
 * rescan for reorganizations, and revisit confirming transactions separately.
 */
export async function scanPayments({ db, provider, chainId, contract, fromBlock, toBlock, confirmations }) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || !Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock) || fromBlock < 0 || toBlock < fromBlock || toBlock - fromBlock > 1999) throw new RangeError('Invalid scan range');
  const address = getAddress(contract);
  if ((await provider.getNetwork()).chainId !== chainId) throw new Error('Unexpected chain');
  const logs = await provider.getLogs({ address, fromBlock, toBlock, topics: [events.getEvent('PaymentFulfilled').topicHash] });
  const results = [];
  for (const log of logs) {
    const event = events.parseLog(log);
    if (!event || log.removed) continue;
    const invoiceId = event.args.invoiceId.toLowerCase();
    const row = (await db.query('select id from fintree_private.invoices where id=$1 and chain_id=$2::numeric and contract_address=$3', [invoiceId, chainId.toString(), address.toLowerCase()])).rows[0];
    if (!row) continue;
    const result = await reconcilePayment({ db, provider, invoiceId, transactionHash: log.transactionHash, confirmations });
    results.push({ invoiceId, ...result });
  }
  return results;
}

/** Recheck tracked, unfinalized transactions, including after a reorganization. */
export async function recheckConfirming({ db, provider, chainId, contract, confirmations, limit = 100 }) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid recheck configuration');
  const address = getAddress(contract).toLowerCase();
  if ((await provider.getNetwork()).chainId !== chainId) throw new Error('Unexpected chain');
  const rows = (await db.query(`select id,tx_hash from fintree_private.invoices where chain_id=$1::numeric and contract_address=$2 and status='confirming' and tx_hash is not null order by rechecked_at asc nulls first, id limit $3`, [chainId.toString(), address, limit])).rows;
  const results = [];
  for (const row of rows) {
    const result = await reconcilePayment({ db, provider, invoiceId: row.id, transactionHash: row.tx_hash, confirmations });
    await db.query("update fintree_private.invoices set rechecked_at=clock_timestamp() where id=$1 and status='confirming' and tx_hash=$2", [row.id, row.tx_hash]);
    results.push({ invoiceId: row.id, ...result });
  }
  return results;
}
