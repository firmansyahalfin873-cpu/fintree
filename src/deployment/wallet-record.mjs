import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAddress, getCreateAddress, isHexString, keccak256 } from 'ethers';
import { validateDeployment } from '../server/validate-deployment.mjs';

/** The local service owns this file. Never delete an uncertain record automatically. */
export function createWalletDeploymentRecord({ provider, plan, recordPath }) {
  if (!provider || !plan || typeof recordPath !== 'string' || !recordPath.trim()) throw new TypeError('Invalid deployment record configuration');
  const filename = path.resolve(recordPath), lockname = `${filename}.lock`;
  async function locked(action) {
    const lock = await fs.open(lockname, 'wx', 0o600);
    try { return await action(); }
    finally { await lock.close(); await fs.unlink(lockname); }
  }
  async function read() {
    const record = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (record.version !== 1 || record.mode !== 'wallet' || record.chainId !== plan.chainId.toString() ||
        record.deployer !== plan.deployer || record.token !== plan.token || record.treasury !== plan.treasury ||
        record.quoteSigner !== plan.quoteSigner || record.deploymentDataHash !== plan.deploymentDataHash) throw new Error('Deployment record does not match plan');
    return record;
  }
  async function replace(record) {
    const temp = `${filename}.${randomUUID()}.tmp`;
    const file = await fs.open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(record, null, 2)); await file.sync(); }
    finally { await file.close(); }
    try { await fs.rename(temp, filename); }
    catch (error) { try { await fs.unlink(temp); } catch {} throw error; }
  }
  return {
    async reserve({ nonce, predictedAddress, deploymentDataHash, deployer, chainId }) {
      if ((await provider.getNetwork()).chainId !== plan.chainId || chainId !== plan.chainId || getAddress(deployer) !== plan.deployer || deploymentDataHash !== plan.deploymentDataHash ||
          !Number.isSafeInteger(nonce) || nonce < 0 || nonce !== await provider.getTransactionCount(plan.deployer, 'pending') || getAddress(predictedAddress) !== getCreateAddress({ from: plan.deployer, nonce })) throw new Error('Reservation does not match the current deployment plan');
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const record = { version: 1, mode: 'wallet', status: 'reserved', chainId: plan.chainId.toString(), deployer: plan.deployer, nonce, predictedAddress: getAddress(predictedAddress),
        token: plan.token, treasury: plan.treasury, quoteSigner: plan.quoteSigner, compiler: plan.compiler, sourceHash: plan.sourceHash, deploymentDataHash: plan.deploymentDataHash };
      const file = await fs.open(filename, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(record, null, 2)); await file.sync(); } finally { await file.close(); }
      return { nonce, predictedAddress: record.predictedAddress };
    },
    async markSubmitted({ transactionHash }) {
      if (!isHexString(transactionHash, 32)) throw new TypeError('Invalid transaction hash');
      return locked(async () => {
        const record = await read();
        if (record.status === 'submitted' && record.transactionHash.toLowerCase() === transactionHash.toLowerCase()) return record;
        if (record.status !== 'reserved') throw new Error('Deployment record is not awaiting a transaction');
        record.status = 'submitted'; record.transactionHash = transactionHash.toLowerCase();
        await replace(record);
        return record;
      });
    },
    async recoverSubmitted({ transactionHash }) {
      if (!isHexString(transactionHash, 32)) throw new TypeError('Invalid transaction hash');
      return locked(async () => {
        const record = await read();
        if (record.status !== 'reserved') {
          if (['submitted', 'deployed', 'failed'].includes(record.status) && record.transactionHash?.toLowerCase() === transactionHash.toLowerCase()) return record;
          throw new Error('Transaction does not match the existing record');
        }
        if ((await provider.getNetwork()).chainId !== plan.chainId) throw new Error('Unexpected network');
        const tx = await provider.getTransaction(transactionHash);
        if (!tx || tx.hash.toLowerCase() !== transactionHash.toLowerCase() || getAddress(tx.from) !== record.deployer || tx.to !== null ||
            tx.nonce !== record.nonce || BigInt(tx.chainId) !== plan.chainId || keccak256(tx.data).toLowerCase() !== record.deploymentDataHash.toLowerCase()) throw new Error('Transaction does not match the reserved deployment');
        record.status = 'submitted'; record.transactionHash = transactionHash.toLowerCase();
        await replace(record);
        return record;
      });
    },
    async bindWebhookVault(address) {
      const expected = getAddress(address);
      return locked(async () => {
        const record = await read();
        if (record.status !== 'deployed') throw new Error('Deployment not confirmed');
        if (record.webhookVaultAddress && getAddress(record.webhookVaultAddress) !== expected) throw new Error('Webhook vault does not match deployment record');
        if (!record.webhookVaultAddress) { record.webhookVaultAddress = expected; await replace(record); }
        return record;
      });
    },
    async verifyAndConfirm() {
      return locked(async () => {
        const record = await read();
        if (record.status === 'deployed' || record.status === 'failed') return record;
        if (record.status !== 'submitted' || !isHexString(record.transactionHash, 32)) throw new Error('Deployment transaction is not recorded');
        if ((await provider.getNetwork()).chainId !== plan.chainId) throw new Error('Unexpected network');
        const [tx, receipt] = await Promise.all([provider.getTransaction(record.transactionHash), provider.getTransactionReceipt(record.transactionHash)]);
        if (!tx || !receipt) return { status: 'pending', transactionHash: record.transactionHash };
        if (getAddress(tx.from) !== record.deployer || tx.to !== null || tx.nonce !== record.nonce || BigInt(tx.chainId) !== plan.chainId || keccak256(tx.data).toLowerCase() !== record.deploymentDataHash.toLowerCase()) throw new Error('Transaction does not match the reserved deployment');
        const block = await provider.getBlock(receipt.blockNumber);
        if (!block || block.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase()) return { status: 'pending', transactionHash: record.transactionHash };
        if (receipt.status !== 1) { record.status = 'failed'; record.blockNumber = receipt.blockNumber; await replace(record); return record; }
        if (!receipt.contractAddress || getAddress(receipt.contractAddress) !== record.predictedAddress) throw new Error('Deployed contract address does not match');
        const checked = await validateDeployment({ provider, signer: { getAddress: async () => plan.quoteSigner }, chainId: plan.chainId, contract: record.predictedAddress, token: plan.token, tokenDecimals: 6 });
        if (checked.treasury !== plan.treasury) throw new Error('Deployed treasury does not match');
        record.status = 'deployed'; record.contract = record.predictedAddress; record.blockNumber = receipt.blockNumber;
        await replace(record);
        return record;
      });
    },
    async get() { return read(); },
  };
}
