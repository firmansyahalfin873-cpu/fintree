import { Interface, getAddress, isHexString } from 'ethers';

const events = new Interface([
  'event PaymentFulfilled(bytes32 indexed invoiceId,address indexed merchant,address indexed payer,address token,uint256 merchantAmount,uint256 protocolFee)',
]);

/**
 * Inspect a transaction against a server-owned invoice and trusted RPC provider.
 * This function does not mutate invoice state; callers must persist the result
 * atomically and recheck canonicality until their chosen finality policy is met.
 */
export async function verifyPayment({ provider, transactionHash, invoice, confirmations }) {
  if (!isHexString(transactionHash, 32) || !isHexString(invoice?.invoiceId, 32)) throw new TypeError('Invalid transaction or invoice ID');
  if (typeof invoice.chainId !== 'bigint' || invoice.chainId <= 0n ||
      typeof invoice.merchantAmount !== 'bigint' || invoice.merchantAmount <= 0n ||
      typeof invoice.protocolFee !== 'bigint' || invoice.protocolFee < 0n ||
      typeof invoice.deadline !== 'bigint' || invoice.deadline <= 0n ||
      !Number.isSafeInteger(confirmations) || confirmations < 1) throw new TypeError('Invalid trusted invoice or confirmation policy');
  const contract = getAddress(invoice.contract);
  const merchant = getAddress(invoice.merchant);
  const token = getAddress(invoice.token);
  const network = await provider.getNetwork();
  if (network.chainId !== invoice.chainId) return { status: 'rejected', reason: 'wrong_chain' };
  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (!receipt) return { status: 'pending', reason: 'receipt_not_found' };
  if (receipt.hash.toLowerCase() !== transactionHash.toLowerCase()) return { status: 'rejected', reason: 'wrong_transaction' };
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || block.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase()) return { status: 'pending', reason: 'noncanonical_receipt' };
  const observedBlockHash = receipt.blockHash;
  if (receipt.status !== 1) return { status: 'rejected', reason: 'transaction_failed', observedBlockHash };
  if (BigInt(block.timestamp) > invoice.deadline) return { status: 'rejected', reason: 'payment_after_deadline', observedBlockHash };
  const matches = [];
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== contract) continue;
    let event;
    try { event = events.parseLog(log); } catch { continue; }
    if (!event || event.name !== 'PaymentFulfilled') continue;
    const args = event.args;
    if (args.invoiceId.toLowerCase() === invoice.invoiceId.toLowerCase() &&
        getAddress(args.merchant) === merchant && getAddress(args.token) === token &&
        args.merchantAmount === invoice.merchantAmount && args.protocolFee === invoice.protocolFee) matches.push(args);
  }
  if (matches.length !== 1) return { status: 'rejected', reason: 'payment_event_mismatch', observedBlockHash };
  const head = await provider.getBlockNumber();
  const observedConfirmations = head - receipt.blockNumber + 1;
  if (!Number.isSafeInteger(observedConfirmations) || observedConfirmations < 1) return { status: 'pending', reason: 'head_behind_receipt' };
  const evidence = { transactionHash: receipt.hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, payer: getAddress(matches[0].payer), confirmations: observedConfirmations,
    invoiceId: invoice.invoiceId, chainId: invoice.chainId, contract, token, merchant,
    merchantAmount: invoice.merchantAmount, protocolFee: invoice.protocolFee, deadline: invoice.deadline };
  return observedConfirmations < confirmations
    ? { status: 'confirming', evidence }
    : { status: 'paid', evidence };
}
