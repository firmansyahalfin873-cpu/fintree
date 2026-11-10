import { randomUUID } from 'node:crypto';
import { getAddress } from 'ethers';
import { recheckConfirming, scanPayments } from './scan-payments.mjs';
import { expireInvoices } from './expire-invoices.mjs';
import { monitorPaidPayments } from './monitor-paid.mjs';

/** One resumable polling cycle. The caller schedules retries and alerts on errors. */
export async function runScannerCycle({ db, provider, chainId, contract, startBlock, confirmations, batchSize = 500, overlap = 32, leaseSeconds = 120, recheckLimit = 100 }) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || !Number.isSafeInteger(startBlock) || startBlock < 0 ||
      !Number.isSafeInteger(confirmations) || confirmations < 1 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000 ||
      !Number.isInteger(overlap) || overlap < 0 || overlap > 1000 || !Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw new RangeError('Invalid scanner configuration');
  const address = getAddress(contract).toLowerCase();
  if ((await provider.getNetwork()).chainId !== chainId) throw new Error('Unexpected chain');
  await db.query(`insert into fintree_private.scanner_state (chain_id,contract_address,start_block,next_block)
    values ($1::numeric,$2,$3,$3) on conflict (chain_id,contract_address) do nothing`, [chainId.toString(), address, startBlock]);
  const token = randomUUID();
  const claimed = await db.query(`update fintree_private.scanner_state set lease_token=$3,lease_until=now()+($4::int*interval '1 second')
    where chain_id=$1::numeric and contract_address=$2 and (lease_until is null or lease_until < now())
    returning start_block,next_block`, [chainId.toString(), address, token, leaseSeconds]);
  if (!claimed.rows.length) return { status: 'busy' };
  try {
    const savedStart = Number(claimed.rows[0].start_block), next = Number(claimed.rows[0].next_block);
    if (!Number.isSafeInteger(savedStart) || !Number.isSafeInteger(next) || savedStart !== startBlock) throw new Error('Scanner start block differs from saved state');
    const paidMonitor = await monitorPaidPayments({ db, provider, chainId, contract: address });
    const checked = await recheckConfirming({ db, provider, chainId, contract: address, confirmations, limit: recheckLimit });
    if (checked.some((entry) => ['rejected', 'conflict'].includes(entry.status))) throw new Error('Could not reconcile an existing payment');
    const head = await provider.getBlockNumber();
    if (!Number.isSafeInteger(head) || head < 0) throw new Error('Invalid chain head');
    const fromBlock = Math.max(savedStart, next - overlap);
    const toBlock = Math.min(head, next + batchSize - 1, fromBlock + 1999);
    let scanned = [];
    if (toBlock >= fromBlock) {
      scanned = await scanPayments({ db, provider, chainId, contract: address, fromBlock, toBlock, confirmations });
      if (scanned.some((entry) => !['paid', 'confirming'].includes(entry.status))) throw new Error('Payment evidence unresolved; scan will retry');
    }
    const expired = await expireInvoices({ db, chainId, contract: address });
    const newNext = Math.max(next, toBlock + 1);
    const updated = await db.query(`update fintree_private.scanner_state set next_block=$4,updated_at=now(),lease_token=null,lease_until=null
      where chain_id=$1::numeric and contract_address=$2 and lease_token=$3 and lease_until > now() returning next_block`, [chainId.toString(), address, token, newNext]);
    if (!updated.rows.length) return { status: 'lease_expired' };
    return { status: 'ok', fromBlock: toBlock >= fromBlock ? fromBlock : null, toBlock: toBlock >= fromBlock ? toBlock : null, nextBlock: newNext, scanned: scanned.length, rechecked: checked.length, expired, paidChecked: paidMonitor.checked, incidents: paidMonitor.incidents };
  } finally {
    await db.query('update fintree_private.scanner_state set lease_token=null,lease_until=null where chain_id=$1::numeric and contract_address=$2 and lease_token=$3', [chainId.toString(), address, token]);
  }
}
