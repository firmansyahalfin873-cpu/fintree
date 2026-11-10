import fs from 'node:fs/promises';
import path from 'node:path';
import { getAddress, getCreateAddress, keccak256 } from 'ethers';
import { validateDeployment } from '../server/validate-deployment.mjs';

/** A record is reserved before sending. Existing records must be reconciled, not overwritten. */
export async function executeDeployment({ signer, plan, recordPath, onBroadcast = () => {} }) {
  if (!signer.provider || typeof recordPath !== 'string' || !recordPath.trim()) throw new TypeError('Deployment configuration missing');
  if ((await signer.provider.getNetwork()).chainId !== plan.chainId || getAddress(await signer.getAddress()) !== plan.deployer || keccak256(plan.transactionData) !== plan.deploymentDataHash) throw new Error('Deployment plan no longer matches signer or network');
  const nonce = await signer.provider.getTransactionCount(plan.deployer, 'pending');
  const predictedAddress = getCreateAddress({ from: plan.deployer, nonce });
  const filename = path.resolve(recordPath);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const record = { version: 1, status: 'reserved', chainId: plan.chainId.toString(), deployer: plan.deployer, nonce, predictedAddress,
    token: plan.token, treasury: plan.treasury, quoteSigner: plan.quoteSigner, compiler: plan.compiler, sourceHash: plan.sourceHash, deploymentDataHash: plan.deploymentDataHash };
  const file = await fs.open(filename, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(record, null, 2)); } finally { await file.close(); }
  const transaction = await signer.sendTransaction({ data: plan.transactionData, chainId: plan.chainId, nonce });
  onBroadcast({ hash: transaction.hash, predictedAddress });
  record.status = 'submitted'; record.transactionHash = transaction.hash;
  await fs.writeFile(filename, JSON.stringify(record, null, 2), { mode: 0o600 });
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress || getAddress(receipt.contractAddress) !== predictedAddress) throw new Error('Deployment receipt does not match the reserved record');
  const verified = await validateDeployment({ provider: signer.provider, signer: { getAddress: async () => plan.quoteSigner }, chainId: plan.chainId, contract: receipt.contractAddress, token: plan.token, tokenDecimals: 6 });
  if (verified.treasury !== plan.treasury) throw new Error('Deployed treasury does not match the reserved record');
  record.status = 'deployed'; record.contract = getAddress(receipt.contractAddress); record.blockNumber = receipt.blockNumber;
  await fs.writeFile(filename, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}
