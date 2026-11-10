import fs from 'node:fs/promises';
import path from 'node:path';
import { getAddress, getBytes, ZeroAddress } from 'ethers';
import { createSignerVault, unlockSignerVault, SignerVaultMismatchError } from './signer-vault.mjs';
import { prepareDeployment } from './prepare.mjs';
import { validateWalletDeploymentPlan } from './wallet-deploy.mjs';
import { createWalletDeploymentRecord } from './wallet-record.mjs';

export class SetupRecoveryRequiredError extends Error {
  constructor() { super('Existing setup files require recovery'); this.name = 'SetupRecoveryRequiredError'; }
}

/** Local testnet setup. Caller supplies fixed trusted network and token constants. */
export function createSetupService({ provider, artifact, chainId, token, directory, startRuntime, databasePath = '.fintree-data/testnet' }) {
  if (!provider || !artifact || typeof chainId !== 'bigint' || chainId <= 0n || !directory) throw new TypeError('Invalid setup configuration');
  token = getAddress(token);
  const vaultPath = path.join(directory, 'quote-signer.json');
  const webhookVaultPath = path.join(directory, 'webhook-master.json');
  const planPath = path.join(directory, 'wallet-plan.json');
  const recordPath = path.join(directory, 'wallet-deployment.json');
  let active = false, runtime = null;
  async function exclusive(action) {
    if (active) throw new Error('Setup operation already in progress');
    active = true;
    try { return await action(); } finally { active = false; }
  }
  async function loadPlan() {
    const saved = JSON.parse(await fs.readFile(planPath, 'utf8'));
    const plan = { ...saved, chainId: BigInt(saved.chainId), gasEstimate: BigInt(saved.gasEstimate), deployerBalance: BigInt(saved.deployerBalance) };
    if (plan.compiler !== artifact.compiler || plan.sourceHash !== artifact.sourceHash) throw new Error('Contract source changed since preparation');
    const expected = { chainId, token, deployer: plan.deployer, treasury: plan.treasury, quoteSigner: plan.quoteSigner, bytecode: artifact.bytecode };
    await validateWalletDeploymentPlan(plan, expected);
    return { plan, expected, records: createWalletDeploymentRecord({ provider, plan, recordPath }) };
  }
  async function readOrCreateSigner(password, filename = vaultPath) {
    try { return await unlockSignerVault({ filename, password }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await createSignerVault({ filename, password }); }
      catch (createError) { if (createError.code !== 'EEXIST') throw createError; }
      return unlockSignerVault({ filename, password });
    }
  }
  async function exists(filename) {
    try { await fs.access(filename); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  return {
    async prepare({ deployer, treasury, password }) {
      return exclusive(async () => {
        deployer = getAddress(deployer); treasury = getAddress(treasury);
        if (deployer === ZeroAddress || treasury === ZeroAddress) throw new TypeError('Zero address not allowed');
        const [hasPlan, hasRecord, hasVault] = await Promise.all([exists(planPath), exists(recordPath), exists(vaultPath)]);
        if (((hasPlan || hasRecord) && !hasVault) || (hasRecord && !hasPlan)) throw new SetupRecoveryRequiredError();
        const signer = hasPlan || hasRecord ? await unlockSignerVault({ filename: vaultPath, password }) : await readOrCreateSigner(password);
        let setup;
        try { setup = await loadPlan(); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const plan = await prepareDeployment({ provider, artifact, expectedChainId: chainId, deployer, token, treasury, quoteSigner: signer.address });
          await fs.mkdir(directory, { recursive: true });
          const file = await fs.open(planPath, 'wx', 0o600);
          try { await file.writeFile(JSON.stringify(plan, (_key, value) => typeof value === 'bigint' ? value.toString() : value)); await file.sync(); }
          finally { await file.close(); }
          setup = await loadPlan();
        }
        if (setup.plan.deployer !== deployer || setup.plan.treasury !== treasury || setup.plan.quoteSigner !== signer.address) throw new Error('Existing setup uses different addresses');
        let record = null;
        try { record = await setup.records.get(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        // Keep an existing reservation visible even when the network is offline.
        // Never estimate another deployment once a transaction has been reserved.
        let balance = null, gasEstimate = setup.plan.gasEstimate;
        if (record) {
          try { if ((await provider.getNetwork()).chainId === chainId) balance = await provider.getBalance(deployer); } catch { /* Status remains visible. */ }
        } else {
          if ((await provider.getNetwork()).chainId !== chainId) throw new Error('Unexpected network');
          [balance, gasEstimate] = await Promise.all([provider.getBalance(deployer), provider.estimateGas({ from: deployer, data: setup.plan.transactionData })]);
        }
        const plan = { ...setup.plan, deployerBalance: balance, gasEstimate };
        await validateWalletDeploymentPlan(plan, setup.expected);
        return { plan, expected: setup.expected, record };
      });
    },
    async reserve({ nonce, predictedAddress }) {
      return exclusive(async () => {
        const { plan, records } = await loadPlan();
        return records.reserve({ nonce, predictedAddress, deploymentDataHash: plan.deploymentDataHash, deployer: plan.deployer, chainId: plan.chainId });
      });
    },
    async submitted({ transactionHash }) { return exclusive(async () => (await loadPlan()).records.markSubmitted({ transactionHash })); },
    async confirm() { return exclusive(async () => (await loadPlan()).records.verifyAndConfirm()); },
    async recover({ transactionHash }) {
      return exclusive(async () => {
        const { records } = await loadPlan();
        await records.recoverSubmitted({ transactionHash });
        return records.verifyAndConfirm();
      });
    },
    async start({ password }) {
      return exclusive(async () => {
        if (runtime) return { origin: runtime.origin, webhookEnabled: true };
        if (typeof startRuntime !== 'function') throw new Error('Testnet runtime unavailable');
        const { plan, records } = await loadPlan();
        const signer = await unlockSignerVault({ filename: vaultPath, password, expectedAddress: plan.quoteSigner });
        const record = await records.verifyAndConfirm();
        if (record.status !== 'deployed') throw new Error('Deployment not confirmed');
        let webhookVault;
        if (record.webhookVaultAddress) {
          if (!await exists(webhookVaultPath)) throw new SetupRecoveryRequiredError();
          try { webhookVault = await unlockSignerVault({ filename: webhookVaultPath, password, expectedAddress: record.webhookVaultAddress }); }
          catch (error) { if (error instanceof SignerVaultMismatchError || error.code === 'ENOENT') throw new SetupRecoveryRequiredError(); throw error; }
        } else {
          // A legacy database without its key may contain encrypted secrets. Never replace it blindly.
          if (!await exists(webhookVaultPath) && await exists(databasePath)) throw new SetupRecoveryRequiredError();
          webhookVault = await readOrCreateSigner(password, webhookVaultPath);
          await records.bindWebhookVault(webhookVault.address);
        }
        const webhookMasterKey = Buffer.from(getBytes(webhookVault.privateKey));
        try { runtime = await startRuntime({ provider, signer, record, plan, webhookMasterKey }); }
        catch (error) { webhookMasterKey.fill(0); throw error; }
        const stopRuntime = runtime.stop.bind(runtime);
        runtime.stop = async () => { try { await stopRuntime(); } finally { webhookMasterKey.fill(0); } };
        return { origin: runtime.origin, webhookEnabled: true };
      });
    },
    async stop() { if (runtime) { await runtime.stop(); runtime = null; } },
  };
}
