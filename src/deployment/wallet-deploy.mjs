import { BrowserProvider, ContractFactory, getAddress, getCreateAddress, isHexString, keccak256, toQuantity, ZeroAddress } from 'ethers';
import { validateDeployment } from '../server/validate-deployment.mjs';

export class DeploymentUncertainError extends Error {
  constructor(message, transactionHash = null) { super(message); this.name = 'DeploymentUncertainError'; this.transactionHash = transactionHash; }
}

/** Validate exact deployment data against the separately reviewed contract and addresses. */
export async function validateWalletDeploymentPlan(plan, expected) {
  if (!plan || !expected || typeof expected.chainId !== 'bigint' || expected.chainId <= 0n ||
      !isHexString(expected.bytecode) || expected.bytecode === '0x' || !isHexString(plan.transactionData) || !isHexString(plan.deploymentDataHash, 32)) throw new TypeError('Invalid deployment plan');
  const address = (value) => { const result = getAddress(value); if (result === ZeroAddress) throw new TypeError('Zero address not allowed'); return result; };
  const token = address(expected.token), treasury = address(expected.treasury), quoteSigner = address(expected.quoteSigner), deployer = address(expected.deployer);
  if (BigInt(plan.chainId) !== expected.chainId || address(plan.token) !== token || address(plan.treasury) !== treasury ||
      address(plan.quoteSigner) !== quoteSigner || address(plan.deployer) !== deployer) throw new Error('Deployment details do not match the reviewed plan');
  const factory = new ContractFactory(['constructor(address,address,address)'], expected.bytecode);
  const transaction = await factory.getDeployTransaction(token, treasury, quoteSigner);
  if (transaction.data.toLowerCase() !== plan.transactionData.toLowerCase() || keccak256(transaction.data).toLowerCase() !== plan.deploymentDataHash.toLowerCase()) throw new Error('Deployment code does not match the reviewed contract');
  const gas = BigInt(plan.gasEstimate);
  if (gas <= 0n || gas > 25000000n) throw new RangeError('Invalid gas estimate');
  return { chainId: expected.chainId, token, treasury, quoteSigner, deployer, transactionData: transaction.data, deploymentDataHash: keccak256(transaction.data), gasLimit: (gas * 120n + 99n) / 100n };
}

/**
 * Never accepts a private key. A durable reserve callback must succeed before
 * the wallet is asked to send. Any uncertain outcome requires reconciliation.
 */
export async function deployWithWallet({ ethereum, plan, expected, reserve, markSubmitted, markConfirmed, onStatus = () => {}, timeoutMs = 120000 }) {
  const reviewed = await validateWalletDeploymentPlan(plan, expected);
  if (!ethereum?.request || typeof reserve !== 'function' || typeof markSubmitted !== 'function' || typeof markConfirmed !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) throw new TypeError('Wallet and durable record callbacks are required');
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || !accounts[0] || getAddress(accounts[0]) !== reviewed.deployer) throw new Error('Connect the reviewed deployer account');
  async function assertWallet() {
    const [chain, active] = await Promise.all([ethereum.request({ method: 'eth_chainId' }), ethereum.request({ method: 'eth_accounts' })]);
    if (BigInt(chain) !== reviewed.chainId || !Array.isArray(active) || !active[0] || getAddress(active[0]) !== reviewed.deployer) throw new Error('Wallet network or account changed');
  }
  await assertWallet();
  const rawNonce = await ethereum.request({ method: 'eth_getTransactionCount', params: [reviewed.deployer, 'pending'] });
  const nonceBig = BigInt(rawNonce);
  if (nonceBig < 0n || nonceBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Invalid account nonce');
  const nonce = Number(nonceBig), predictedAddress = getCreateAddress({ from: reviewed.deployer, nonce });
  const reservation = await reserve({ ...reviewed, nonce, predictedAddress });
  if (!reservation || reservation.nonce !== nonce || getAddress(reservation.predictedAddress) !== predictedAddress) throw new Error('Deployment record could not be reserved');
  let hash = null;
  try {
    await assertWallet();
    onStatus({ stage: 'wallet_confirmation', predictedAddress });
    hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: reviewed.deployer, data: reviewed.transactionData, nonce: toQuantity(nonce), gas: toQuantity(reviewed.gasLimit) }] });
    if (!isHexString(hash, 32)) throw new Error('Wallet returned an invalid transaction hash');
    onStatus({ stage: 'submitted', transactionHash: hash });
    await markSubmitted({ transactionHash: hash, nonce, predictedAddress });
    const provider = new BrowserProvider(ethereum);
    try {
      const receipt = await provider.waitForTransaction(hash, 1, timeoutMs);
      const tx = await provider.getTransaction(hash);
      if (!receipt || receipt.status !== 1 || !receipt.contractAddress || getAddress(receipt.contractAddress) !== predictedAddress || !tx || tx.to !== null ||
          getAddress(tx.from) !== reviewed.deployer || tx.nonce !== nonce || BigInt(tx.chainId) !== reviewed.chainId || keccak256(tx.data).toLowerCase() !== reviewed.deploymentDataHash.toLowerCase()) throw new Error('Deployment transaction does not match the reserved record');
      const verified = await validateDeployment({ provider, signer: { getAddress: async () => reviewed.quoteSigner }, chainId: reviewed.chainId, contract: predictedAddress, token: reviewed.token, tokenDecimals: 6 });
      if (verified.treasury !== reviewed.treasury) throw new Error('Deployed treasury does not match');
      await markConfirmed({ transactionHash: hash, contract: predictedAddress, blockNumber: receipt.blockNumber });
      return { transactionHash: hash, contract: predictedAddress, blockNumber: receipt.blockNumber };
    } finally { provider.destroy(); }
  } catch (error) {
    throw new DeploymentUncertainError('Deployment was reserved; inspect the record and wallet before retrying.', isHexString(hash, 32) ? hash : null);
  }
}
