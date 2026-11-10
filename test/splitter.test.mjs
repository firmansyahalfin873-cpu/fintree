import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { createLocalChain } from '../src/testing/local-chain.mjs';
import solc from 'solc';
import { build } from 'esbuild';
import { BrowserProvider, ContractFactory, Wallet, id, getBytes, getCreateAddress } from 'ethers';
import { verifyPayment } from '../src/payments/verify-payment.mjs';
import { createQuote } from '../src/payments/create-quote.mjs';
import { createCheckoutSession, getMerchantCheckoutSession } from '../src/payments/checkout-sessions.mjs';
import { submitWalletPayment, validateCheckout } from '../src/checkout/wallet-payment.mjs';
import { createPendingPayment } from '../src/checkout/pending-payment.mjs';
import { recordPaid } from '../src/payments/record-paid.mjs';
import { reconcilePayment } from '../src/payments/reconcile-payment.mjs';
import { runScannerCycle } from '../src/payments/scanner-cycle.mjs';
import { PGlite } from '@electric-sql/pglite';
import { validateDeployment } from '../src/server/validate-deployment.mjs';
import { loadTestnetAssets } from '../src/server/testnet-assets.mjs';
import { createApp } from '../src/server/app.mjs';
import { createPublicCheckoutHandler } from '../src/api/public-checkout-handler.mjs';
import { monitorPaidPayments } from '../src/payments/monitor-paid.mjs';
import { compileSplitter } from '../src/deployment/compile.mjs';
import { prepareDeployment } from '../src/deployment/prepare.mjs';
import { executeDeployment } from '../src/deployment/execute.mjs';
import { deployWithWallet, validateWalletDeploymentPlan, DeploymentUncertainError } from '../src/deployment/wallet-deploy.mjs';
import { createWalletDeploymentRecord } from '../src/deployment/wallet-record.mjs';
import { createSetupService, SetupRecoveryRequiredError } from '../src/deployment/setup-service.mjs';
import { startSetupTestnet } from '../src/server/start-testnet.mjs';
import { createSetupApp } from '../src/deployment/setup-app.mjs';
import { prepareWebhookDelivery } from '../src/webhooks/prepare-delivery.mjs';
import { createWebhookSettings } from '../src/webhooks/settings.mjs';
import { generateWebhookSecret, verifyWebhook } from '../src/webhooks/signature.mjs';
import { deliverNextWebhook } from '../src/webhooks/deliver-next.mjs';

const require = createRequire(import.meta.url);
const sources = Object.fromEntries(['contracts/FintreeSplitter.sol', 'contracts/test/TestToken.sol']
  .map((path) => [path, { content: fs.readFileSync(path, 'utf8') }]));
const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const compiled = JSON.parse(solc.compile(JSON.stringify(input), { import: (name) => {
  try { return { contents: fs.readFileSync(require.resolve(name), 'utf8') }; }
  catch { return { error: `Import not found: ${name}` }; }
} }));
const errors = (compiled.errors ?? []).filter((error) => error.severity === 'error');
if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
const artifact = (path, name) => compiled.contracts[path][name];
const types = { Quote: [
  { name: 'invoiceId', type: 'bytes32' }, { name: 'token', type: 'address' },
  { name: 'merchant', type: 'address' }, { name: 'merchantAmount', type: 'uint256' },
  { name: 'protocolFee', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
] };

async function setup(t, chainId = 1337) {
  const rpc = await createLocalChain({ chainId });
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  t.after(async () => { provider.destroy(); await rpc.disconnect(); });
  const payer = await provider.getSigner(0);
  const merchant = await provider.getSigner(1);
  const treasury = await provider.getSigner(2);
  const [signerKey] = Object.values(rpc.getInitialAccounts());
  const quoteSigner = new Wallet(signerKey.secretKey);
  const deploy = async (path, name, args = []) => {
    const a = artifact(path, name);
    const instance = await new ContractFactory(a.abi, a.evm.bytecode.object, payer).deploy(...args);
    await instance.waitForDeployment();
    return instance;
  };
  const token = await deploy('contracts/test/TestToken.sol', 'TestToken');
  const splitter = await deploy('contracts/FintreeSplitter.sol', 'FintreeSplitter', [token.target, await treasury.getAddress(), quoteSigner.address]);
  await (await token.approve(splitter.target, 1_000_000_000n)).wait();
  const network = await provider.getNetwork();
  const domain = { name: 'Fintree', version: '1', chainId: network.chainId, verifyingContract: splitter.target };
  const quote = { invoiceId: id('invoice-1'), token: token.target, merchant: await merchant.getAddress(), merchantAmount: 1000000n, protocolFee: 3000n, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) };
  const sign = (q = quote, d = domain) => quoteSigner.signTypedData(d, types, q);
  return { provider, payer, merchant, treasury, token, splitter, quote, domain, sign, quoteSigner, rpc };
}

test('valid payment atomically pays merchant and treasury and cannot be replayed', async (t) => {
  const { token, splitter, quote, sign, treasury } = await setup(t);
  const receipt = await (await splitter.payInvoice(quote, await sign())).wait();
  assert.equal(await token.balanceOf(quote.merchant), quote.merchantAmount);
  assert.equal(await token.balanceOf(await treasury.getAddress()), quote.protocolFee);
  assert.equal(await token.balanceOf(splitter.target), 0n);
  assert.equal(await splitter.processedInvoices(quote.invoiceId), true);
  assert.equal(receipt.logs.filter((log) => { try { return splitter.interface.parseLog(log)?.name === 'PaymentFulfilled'; } catch { return false; } }).length, 1);
  await assert.rejects(async () => (await splitter.payInvoice(quote, await sign(), { gasLimit: 1_000_000 })).wait());
});

test('deployment preparation checks the network and token without sending a transaction', async (t) => {
  const { provider, payer, treasury, token, splitter, quoteSigner } = await setup(t);
  const artifact = compileSplitter();
  const input = { provider, artifact, expectedChainId: (await provider.getNetwork()).chainId, deployer: await payer.getAddress(), token: token.target, treasury: await treasury.getAddress(), quoteSigner: quoteSigner.address };
  const before = await provider.getTransactionCount(input.deployer);
  const plan = await prepareDeployment(input);
  assert.equal(await provider.getTransactionCount(input.deployer), before);
  assert.equal(plan.tokenDecimals, 6);
  assert.match(plan.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(plan.gasEstimate > 0n);
  await assert.rejects(prepareDeployment({ ...input, expectedChainId: 1n }), /Unexpected network/);
  await assert.rejects(prepareDeployment({ ...input, token: input.deployer }), /Token is not deployed/);
  await assert.rejects(prepareDeployment({ ...input, quoteSigner: splitter.target }), /signing account/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintree-deploy-'));
  t.after(() => { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path'); fs.rmSync(dir, { recursive: true, force: true }); });
  const recordPath = path.join(dir, 'deployment.json');
  const failedPath = path.join(dir, 'uncertain.json');
  const failingSigner = { provider, getAddress: () => payer.getAddress(), sendTransaction: async () => { throw new Error('Simulated connection failure'); } };
  await assert.rejects(executeDeployment({ signer: failingSigner, plan, recordPath: failedPath }), /Simulated connection failure/);
  assert.equal(JSON.parse(fs.readFileSync(failedPath, 'utf8')).status, 'reserved');
  await assert.rejects(executeDeployment({ signer: failingSigner, plan, recordPath: failedPath }), { code: 'EEXIST' });
  let broadcast;
  const record = await executeDeployment({ signer: payer, plan, recordPath, onBroadcast: (value) => { broadcast = value; } });
  assert.equal(record.status, 'deployed');
  assert.equal(record.contract, broadcast.predictedAddress);
  assert.equal(JSON.parse(fs.readFileSync(recordPath, 'utf8')).transactionHash, broadcast.hash);
  await assert.rejects(executeDeployment({ signer: payer, plan, recordPath }), { code: 'EEXIST' });
  const deployed = await validateDeployment({ provider, signer: quoteSigner, chainId: input.expectedChainId, contract: record.contract, token: token.target, tokenDecimals: 6 });
  assert.equal(deployed.treasury, input.treasury);
});

test('wallet deployment verifies reviewed bytecode, reserves before sending, and checks the receipt', { timeout: 30000 }, async (t) => {
  const { provider, payer, treasury, token, quoteSigner, rpc } = await setup(t);
  const artifact = compileSplitter(), deployer = await payer.getAddress();
  const plan = await prepareDeployment({ provider, artifact, expectedChainId: (await provider.getNetwork()).chainId, deployer, token: token.target, treasury: await treasury.getAddress(), quoteSigner: quoteSigner.address });
  const expected = { chainId: plan.chainId, deployer, token: plan.token, treasury: plan.treasury, quoteSigner: plan.quoteSigner, bytecode: artifact.bytecode };
  let touched = false;
  await assert.rejects(deployWithWallet({ ethereum: { request: async () => { touched = true; } }, plan: { ...plan, transactionData: '0x00' }, expected, reserve: async () => {}, markSubmitted: async () => {}, markConfirmed: async () => {} }));
  assert.equal(touched, false);
  await assert.rejects(validateWalletDeploymentPlan(plan, { ...expected, treasury: deployer }), /reviewed plan/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintree-wallet-deploy-'));
  t.after(() => { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path'); fs.rmSync(dir, { recursive: true, force: true }); });
  const records = createWalletDeploymentRecord({ provider, plan, recordPath: path.join(dir, 'wallet-deployment.json') });
  const reviewed = await validateWalletDeploymentPlan(plan, expected), initialNonce = await provider.getTransactionCount(deployer, 'pending');
  await assert.rejects(records.reserve({ ...reviewed, nonce: initialNonce, predictedAddress: expected.treasury }), /Reservation does not match/);
  assert.equal(fs.existsSync(path.join(dir, 'wallet-deployment.json')), false);
  const wallet = { request: (args) => rpc.request({ ...args, method: args.method === 'eth_requestAccounts' ? 'eth_accounts' : args.method }) };
  const result = await deployWithWallet({ ethereum: wallet, plan, expected,
    reserve: (value) => records.reserve(value),
    markSubmitted: (value) => records.markSubmitted(value),
    markConfirmed: async () => { assert.equal((await records.verifyAndConfirm()).status, 'deployed'); },
  });
  const record = await records.get();
  assert.equal(record.status, 'deployed');
  assert.equal(record.contract, result.contract);
  assert.equal(record.predictedAddress, result.contract);
  const pendingRecords = createWalletDeploymentRecord({ provider, plan, recordPath: path.join(dir, 'pending.json') });
  const nextNonce = await provider.getTransactionCount(deployer, 'pending');
  await pendingRecords.reserve({ ...reviewed, nonce: nextNonce, predictedAddress: getCreateAddress({ from: deployer, nonce: nextNonce }) });
  const missingHash = id('missing-transaction');
  await pendingRecords.markSubmitted({ transactionHash: missingHash });
  assert.equal((await pendingRecords.verifyAndConfirm()).status, 'pending');
  await assert.rejects(pendingRecords.markSubmitted({ transactionHash: id('different') }), /not awaiting/);
  const fakeHash = id('uncertain-transaction');
  const uncertainWallet = { request: async (args) => args.method === 'eth_sendTransaction' ? fakeHash : wallet.request(args) };
  let reserved = false;
  await assert.rejects(deployWithWallet({ ethereum: uncertainWallet, plan, expected,
    reserve: async (value) => { reserved = true; return { nonce: value.nonce, predictedAddress: value.predictedAddress }; },
    markSubmitted: async () => { throw new Error('Disk unavailable'); }, markConfirmed: async () => {} }),
  (error) => error instanceof DeploymentUncertainError && error.transactionHash === fakeHash);
  assert.equal(reserved, true);
});

test('local setup resumes safely and records an extension wallet deployment', { timeout: 60000 }, async (t) => {
  const { provider, payer, treasury, token, rpc } = await setup(t, 84532);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintree-setup-'));
  t.after(() => { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path'); fs.rmSync(dir, { recursive: true, force: true }); });
  const options = { provider, artifact: compileSplitter(), chainId: (await provider.getNetwork()).chainId, token: token.target, directory: dir, databasePath: path.join(dir, 'database') };
  const service = createSetupService(options);
  const params = { deployer: await payer.getAddress(), treasury: await treasury.getAddress(), password: 'a test setup password' };
  await assert.rejects(service.prepare({ ...params, treasury: `0x${'0'.repeat(40)}` }), /Zero address/);
  assert.equal(fs.existsSync(path.join(dir, 'quote-signer.json')), false);
  const first = await service.prepare(params);
  assert.equal(first.record, null);
  assert.equal(first.plan.quoteSigner, first.expected.quoteSigner);
  const vaultPath = path.join(dir, 'quote-signer.json'), savedVault = path.join(dir, 'saved-signer.json');
  fs.renameSync(vaultPath, savedVault);
  try { await assert.rejects(service.prepare(params), SetupRecoveryRequiredError); assert.equal(fs.existsSync(vaultPath), false); }
  finally { fs.renameSync(savedVault, vaultPath); }
  assert.equal(fs.readFileSync(path.join(dir, 'quote-signer.json'), 'utf8').includes(params.password), false);
  await assert.rejects(service.prepare({ ...params, password: 'incorrect password' }));
  await assert.rejects(service.prepare({ ...params, treasury: params.deployer }), /different addresses/);
  const originalPlan = fs.readFileSync(path.join(dir, 'wallet-plan.json'), 'utf8');
  const differentProvider = new Proxy(provider, { get(target, key) {
    if (key === 'getBalance') return async () => 42n;
    if (key === 'estimateGas') return async () => first.plan.gasEstimate + 100n;
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const refreshed = await createSetupService({ ...options, provider: differentProvider }).prepare(params);
  assert.equal(refreshed.plan.deployerBalance, 42n);
  assert.equal(refreshed.plan.gasEstimate, first.plan.gasEstimate + 100n);
  assert.equal(refreshed.plan.deploymentDataHash, first.plan.deploymentDataHash);
  assert.equal(fs.readFileSync(path.join(dir, 'wallet-plan.json'), 'utf8'), originalPlan);
  const resumed = await createSetupService(options).prepare(params);
  assert.equal(resumed.plan.deploymentDataHash, first.plan.deploymentDataHash);
  const wallet = { request: (args) => rpc.request({ ...args, method: args.method === 'eth_requestAccounts' ? 'eth_accounts' : args.method }) };
  let lostHash;
  await assert.rejects(deployWithWallet({ ethereum: wallet, ...resumed,
    reserve: (value) => service.reserve(value),
    markSubmitted: async () => { throw new Error('Simulated interruption after broadcast'); },
    markConfirmed: async () => { throw new Error('Unexpected confirmation'); },
  }), (error) => { assert.ok(error instanceof DeploymentUncertainError); lostHash = error.transactionHash; return true; });
  assert.equal((await createSetupService(options).prepare(params)).record.status, 'reserved');
  const planPath = path.join(dir, 'wallet-plan.json'), savedPlan = path.join(dir, 'saved-plan.json');
  fs.renameSync(planPath, savedPlan);
  try { await assert.rejects(service.prepare(params), SetupRecoveryRequiredError); assert.equal(fs.existsSync(planPath), false); }
  finally { fs.renameSync(savedPlan, planPath); }
  await assert.rejects(service.recover({ transactionHash: id('unknown') }));
  await assert.rejects(service.recover({ transactionHash: token.deploymentTransaction().hash }));
  assert.equal((await createSetupService(options).prepare(params)).record.status, 'reserved');
  const result = await service.recover({ transactionHash: lostHash });
  assert.equal(result.status, 'deployed');
  assert.equal((await service.recover({ transactionHash: lostHash })).contract, result.contract);
  const after = await createSetupService(options).prepare(params);
  assert.equal(after.record.status, 'deployed');
  assert.equal(after.record.contract, result.contract);
  const noNewEstimate = new Proxy(provider, { get(target, key) {
    if (key === 'estimateGas') return async () => { throw new Error('must not estimate another deployment'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.equal((await createSetupService({ ...options, provider: noNewEstimate }).prepare(params)).record.status, 'deployed');
  const offline = new Proxy(provider, { get(target, key) {
    if (key === 'getNetwork') return async () => { throw new Error('offline'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const offlineView = await createSetupService({ ...options, provider: offline }).prepare(params);
  assert.equal(offlineView.record.status, 'deployed'); assert.equal(offlineView.plan.deployerBalance, null);
  await assert.rejects(service.reserve({ nonce: after.record.nonce, predictedAddress: after.record.predictedAddress }));
  let starts = 0, stops = 0;
  const runner = createSetupService({ ...options, startRuntime: async ({ signer, record }) => {
    starts++; assert.equal(signer.address, first.plan.quoteSigner); assert.equal(record.contract, result.contract);
    return { origin: 'http://127.0.0.1:4174', stop: async () => { stops++; } };
  } });
  await assert.rejects(runner.start({ password: 'incorrect password' }));
  assert.equal(starts, 0);
  assert.deepEqual(await runner.start({ password: params.password }), { origin: 'http://127.0.0.1:4174', webhookEnabled: true });
  await runner.start({ password: params.password });
  assert.equal(starts, 1);
  await runner.stop(); assert.equal(stops, 1);
  const webhookVaultPath = path.join(dir, 'webhook-master.json'), savedWebhook = path.join(dir, 'saved-webhook.json');
  const deploymentPath = path.join(dir, 'wallet-deployment.json');
  const recordWithBinding = fs.readFileSync(deploymentPath, 'utf8');
  assert.match(JSON.parse(recordWithBinding).webhookVaultAddress, /^0x[0-9a-f]{40}$/i);
  fs.renameSync(webhookVaultPath, savedWebhook);
  try {
    await assert.rejects(runner.start({ password: params.password }), SetupRecoveryRequiredError);
    assert.equal(fs.existsSync(webhookVaultPath), false);
    fs.copyFileSync(path.join(dir, 'quote-signer.json'), webhookVaultPath);
    await assert.rejects(runner.start({ password: params.password }), SetupRecoveryRequiredError);
    fs.unlinkSync(webhookVaultPath);
    const legacyRecord = JSON.parse(recordWithBinding); delete legacyRecord.webhookVaultAddress;
    fs.writeFileSync(deploymentPath, JSON.stringify(legacyRecord));
    fs.mkdirSync(options.databasePath);
    await assert.rejects(runner.start({ password: params.password }), SetupRecoveryRequiredError);
    assert.equal(fs.existsSync(webhookVaultPath), false);
    fs.rmdirSync(options.databasePath);
  } finally {
    if (fs.existsSync(webhookVaultPath)) fs.unlinkSync(webhookVaultPath);
    fs.renameSync(savedWebhook, webhookVaultPath);
    fs.writeFileSync(deploymentPath, recordWithBinding);
  }
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const actualRunner = createSetupService({ ...options, startRuntime: (input) => startSetupTestnet({ ...input, port, databasePath: path.join(dir, 'database') }) });
  t.after(() => actualRunner.stop());
  const runtime = await actualRunner.start({ password: params.password });
  assert.equal((await fetch(`${runtime.origin}/`)).status, 200);
  const serviceStatus = await (await fetch(`${runtime.origin}/api/v1/public/service-status`)).json();
  assert.ok(['starting', 'running', 'delayed'].includes(serviceStatus.scanner.state));
  assert.ok(['starting', 'running', 'delayed'].includes(serviceStatus.webhook.state));
  await actualRunner.stop();
});

test('setup page prepares and deploys through a simulated extension wallet', { timeout: 60000 }, async (t) => {
  const { provider, payer, treasury, token, rpc } = await setup(t, 84532);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintree-setup-page-'));
  t.after(() => { if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path'); fs.rmSync(dir, { recursive: true, force: true }); });
  const origin = 'http://127.0.0.1:4175';
  const service = createSetupService({ provider, artifact: compileSplitter(), chainId: 84532n, token: token.target, directory: dir, databasePath: path.join(dir, 'database'),
    startRuntime: async () => ({ origin: 'http://127.0.0.1:4174', stop: async () => {} }) });
  t.after(() => service.stop());
  const app = createSetupApp({ service, origin, assets: {} });
  const bundle = await build({ entryPoints: ['public/setup.js'], bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', logLevel: 'silent' });
  const saved = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const elements = new Map();
  globalThis.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { hidden: true, disabled: false, value: '', textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, fire(type) { return this.listeners[type]({ preventDefault() {}, submitter: this }); } }); return elements.get(id); } };
  let zeroBalance = true;
  globalThis.window = { ethereum: { request: (args) => zeroBalance && args.method === 'eth_getBalance' ? '0x0' : rpc.request({ ...args, method: args.method === 'eth_requestAccounts' ? 'eth_accounts' : args.method }) } };
  let loseSubmission = true;
  globalThis.fetch = (url, options) => {
    if (String(url) === '/api/submitted' && loseSubmission) { loseSubmission = false; return Promise.reject(new Error('Simulated lost submission')); }
    return app(new Request(new URL(url, origin), { ...options, headers: { ...options.headers, origin } }));
  };
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}#setup`);
  await document.getElementById('switch-network').fire('click');
  assert.match(document.getElementById('status').textContent, /Base Sepolia dipilih/);
  await document.getElementById('connect').fire('click');
  assert.match(document.getElementById('account').textContent, /Wallet: 0x/);
  assert.match(document.getElementById('balance').textContent, /0 ETH uji/);
  zeroBalance = false;
  await document.getElementById('refresh-balance').fire('click');
  assert.match(document.getElementById('balance').textContent, /Saldo Base Sepolia: [1-9]/);
  document.getElementById('treasury').value = await treasury.getAddress(); document.getElementById('password').value = 'a test setup password';
  document.getElementById('password-confirm').value = 'different password';
  await document.getElementById('form').fire('submit');
  assert.match(document.getElementById('status').textContent, /tidak sama/);
  assert.equal(fs.existsSync(path.join(dir, 'quote-signer.json')), false);
  document.getElementById('password').value = 'a test setup password'; document.getElementById('password-confirm').value = 'a test setup password';
  await document.getElementById('form').fire('submit');
  assert.equal(document.getElementById('password').value, '');
  assert.equal(document.getElementById('password-confirm').value, '');
  assert.match(document.getElementById('details').textContent, /Base Sepolia/);
  await document.getElementById('deploy').fire('click');
  assert.match(document.getElementById('status').textContent, /belum pasti/);
  assert.equal(document.getElementById('recover-form').hidden, false);
  assert.match(document.getElementById('recover-hash').value, /^0x[0-9a-f]{64}$/i);
  await document.getElementById('recover-form').fire('submit');
  assert.match(document.getElementById('status').textContent, /Kontrak terpasang/);
  assert.equal(document.getElementById('start-form').hidden, false);
  document.getElementById('unlock').value = 'a test setup password';
  await document.getElementById('start-form').fire('submit');
  assert.equal(document.getElementById('runtime-link').hidden, false);
  assert.equal(document.getElementById('unlock').value, '');
  assert.ok(await payer.getAddress());
});

test('server-issued quote is accepted by contract and verified against a real local receipt', async (t) => {
  const { provider, merchant, treasury, token, splitter, quoteSigner, rpc } = await setup(t);
  const config = { chainId: (await provider.getNetwork()).chainId, contract: splitter.target, token: token.target, signerAddress: quoteSigner.address, tokenDecimals: 6, feeBps: 30, ttlSeconds: 900 };
  assert.equal((await validateDeployment({ provider, signer: quoteSigner, chainId: config.chainId, contract: splitter.target, token: token.target, tokenDecimals: 6 })).signer, quoteSigner.address);
  await assert.rejects(validateDeployment({ provider, signer: quoteSigner, chainId: config.chainId, contract: splitter.target, token: token.target, tokenDecimals: 18 }));
  await assert.rejects(validateDeployment({ provider, signer: quoteSigner, chainId: config.chainId + 1n, contract: splitter.target, token: token.target, tokenDecimals: 6 }));
  const issued = await createQuote({ signer: quoteSigner, config, merchant: await merchant.getAddress(), amount: '15.000001', feePayer: 'merchant' });
  assert.equal(issued.amounts.protocolFee, 45000n);
  const receipt = await (await splitter.payInvoice(issued.quote, issued.signature)).wait();
  assert.equal(await token.balanceOf(await merchant.getAddress()), issued.amounts.merchantReceives);
  assert.equal(await token.balanceOf(await treasury.getAddress()), issued.amounts.protocolFee);
  const invoice = { ...issued.quote, chainId: issued.chainId, contract: issued.contract };
  const verified = await verifyPayment({ provider, transactionHash: receipt.hash, invoice, confirmations: 1 });
  assert.equal(verified.status, 'paid');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fs.readFileSync('db/schema-draft.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/local-migrations/003-checkout-details.sql', 'utf8'));
  const merchantId = '00000000-0000-0000-0000-000000000001';
  await db.query('insert into fintree_private.merchants (id, wallet_address, business_name) values ($1, $2, $3)', [merchantId, invoice.merchant.toLowerCase(), 'Local test']);
  await db.query(`insert into fintree_private.invoices
    (id, merchant_id, idempotency_key, request_hash, external_order_id, chain_id, contract_address, token_address,
     merchant_address, invoice_amount, merchant_amount, protocol_fee, total_payable, fee_bps, fee_payer, quote_signature, deadline)
    values ($1, $2, 'key-1', $3, 'order-1', $4, $5, $6, $7, $8, $9, $10, $11, 30, 'merchant', $12, to_timestamp($13))`,
  [invoice.invoiceId.toLowerCase(), merchantId, 'a'.repeat(64), invoice.chainId.toString(), invoice.contract.toLowerCase(), invoice.token.toLowerCase(), invoice.merchant.toLowerCase(),
    issued.amounts.invoiceAmount.toString(), invoice.merchantAmount.toString(), invoice.protocolFee.toString(), issued.amounts.totalPayable.toString(), issued.signature.toLowerCase(), Number(invoice.deadline)]);
  assert.equal((await recordPaid(db, invoice.invoiceId, { ...verified, evidence: { ...verified.evidence, merchantAmount: 1n } })).recorded, false);
  await db.query("insert into fintree_private.webhook_outbox (event_id, invoice_id, event_type, payload) values ('existing', $1, 'checkout.session.completed', '{}')", [invoice.invoiceId.toLowerCase()]);
  await assert.rejects(recordPaid(db, invoice.invoiceId, verified));
  assert.equal((await db.query('select status from fintree_private.invoices where id = $1', [invoice.invoiceId.toLowerCase()])).rows[0].status, 'pending');
  await db.query("delete from fintree_private.webhook_outbox where event_id = 'existing'");
  assert.equal((await recordPaid(db, invoice.invoiceId, verified)).recorded, true);
  assert.equal((await recordPaid(db, invoice.invoiceId, verified)).recorded, false);
  assert.equal((await db.query('select status from fintree_private.invoices where id = $1', [invoice.invoiceId.toLowerCase()])).rows[0].status, 'paid');
  assert.equal((await db.query('select count(*)::int as count from fintree_private.webhook_outbox')).rows[0].count, 1);
  const event = (await db.query('select payload from fintree_private.webhook_outbox')).rows[0].payload;
  assert.equal(event.schema_version, 1);
  assert.ok(Number.isFinite(Date.parse(event.created_at)));
  const secret = generateWebhookSecret();
  const delivery = prepareWebhookDelivery(event, secret, 1700000000);
  assert.equal(verifyWebhook(delivery.body, delivery.headers['x-fintree-signature'], secret, { now: 1700000000 }), true);
  assert.equal(JSON.parse(delivery.body).data.invoice_id, invoice.invoiceId.toLowerCase());
  const worker = { db, getDeliveryConfig: async () => ({ url: 'https://merchant.example/webhook', secret }) };
  let firstBody;
  assert.equal((await deliverNextWebhook({ ...worker, transport: async ({ body }) => { firstBody = Buffer.from(body); return { status: 503 }; } })).status, 'retry');
  assert.equal((await deliverNextWebhook({ ...worker, transport: async () => ({ status: 200 }) })).status, 'idle');
  await db.query('update fintree_private.webhook_outbox set next_attempt_at=now() where event_id=$1', [event.id]);
  assert.equal((await deliverNextWebhook({ ...worker, transport: async ({ body, headers }) => {
    assert.equal(verifyWebhook(body, headers['x-fintree-signature'], secret), true);
    assert.deepEqual(body, firstBody);
    return { status: 204 };
  } })).status, 'delivered');
  assert.deepEqual((await db.query('select outcome from fintree_private.webhook_attempts order by attempt_number')).rows.map((row) => row.outcome), ['retry', 'delivered']);
  await db.exec('create role fintree_test_reader; grant usage on schema fintree_private to fintree_test_reader; grant select on fintree_private.invoices to fintree_test_reader; set role fintree_test_reader');
  assert.equal((await db.query('select count(*)::int as count from fintree_private.invoices')).rows[0].count, 0);
  await db.exec('reset role');
  await assert.rejects(createQuote({ signer: quoteSigner, config: { ...config, signerAddress: await treasury.getAddress() }, merchant: await merchant.getAddress(), amount: '1', feePayer: 'customer' }), /Signer does not match/);
  await assert.rejects(createQuote({ signer: quoteSigner, config, merchant: await merchant.getAddress(), amount: '1.0000001', feePayer: 'customer' }), RangeError);
  await assert.rejects(createQuote({ signer: quoteSigner, config: { ...config, feeBps: 10000 }, merchant: await merchant.getAddress(), amount: '1', feePayer: 'merchant' }), RangeError);
  await assert.rejects(createQuote({ signer: quoteSigner, config: { ...config, feeBps: undefined }, merchant: await merchant.getAddress(), amount: '1', feePayer: 'customer' }), RangeError);
  const { session } = await createCheckoutSession({ db, signer: quoteSigner, config, merchantId, idempotencyKey: 'key-2', request: { amount: '10', orderId: 'order-2', feePayer: 'customer' } });
  assert.equal(session.totalPayable, '10030000');
  const deployment = { chainId: config.chainId, contract: config.contract, token: config.token, signer: quoteSigner.address };
  for (const bad of [
    { ...session, totalPayable: '1' },
    { ...session, merchantAmount: '1' },
    { ...session, merchant: await treasury.getAddress() },
    { ...session, contract: await treasury.getAddress() },
    { ...session, chainId: '1' },
    { ...session, deadline: 1 },
    { ...session, status: 'paid' },
  ]) assert.throws(() => validateCheckout(bad, deployment));
  const wrongSigner = await treasury.getAddress();
  assert.throws(() => validateCheckout(session, { ...deployment, signer: wrongSigner }));
  let requested = false;
  await assert.rejects(submitWalletPayment({ ethereum: { request: async () => { requested = true; } }, session: { ...session, merchantAmount: '1' }, deployment }));
  assert.equal(requested, false);
  await (await token.approve(splitter.target, 0n)).wait();
  const wallet = { request: (args) => rpc.request({ ...args, method: args.method === 'eth_requestAccounts' ? 'eth_accounts' : args.method }) };
  const stages = [];
  const submitted = await submitWalletPayment({ ethereum: wallet, session, deployment, onStatus: (entry) => stages.push(entry.stage) });
  assert.deepEqual(stages, ['approval', 'payment', 'submitted']);
  assert.equal(submitted.stage, 'awaiting_server_verification');
  const customerReceipt = await new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }).getTransactionReceipt(submitted.transactionHash);
  const scanConfig = { db, provider: new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }), chainId: config.chainId, contract: config.contract };
  const cycleConfig = { ...scanConfig, startBlock: customerReceipt.blockNumber, confirmations: 100, overlap: 2 };
  // A timely payment found after the invoice was marked expired must still settle.
  await db.query("update fintree_private.invoices set status='expired' where id=$1", [session.id]);
  const scan = await runScannerCycle(cycleConfig);
  assert.equal(scan.status, 'ok');
  assert.equal(scan.scanned, 1);
  assert.equal((await db.query('select status from fintree_private.invoices where id = $1', [session.id])).rows[0].status, 'confirming');
  const oldHash = customerReceipt.blockHash, newHash = `0x${'ab'.repeat(32)}`;
  const replacementProvider = (blockHash) => ({ getNetwork: () => provider.getNetwork(),
    getTransactionReceipt: async () => ({ hash: customerReceipt.hash, status: 0, blockNumber: customerReceipt.blockNumber, blockHash }),
    getBlock: async () => ({ hash: blockHash, timestamp: Math.floor(Date.now() / 1000) }) });
  assert.equal((await reconcilePayment({ db, provider: replacementProvider(oldHash), invoiceId: session.id, transactionHash: customerReceipt.hash, confirmations: 1 })).status, 'rejected');
  assert.equal((await db.query('select status from fintree_private.invoices where id=$1', [session.id])).rows[0].status, 'confirming');
  assert.equal((await reconcilePayment({ db, provider: replacementProvider(newHash), invoiceId: session.id, transactionHash: customerReceipt.hash, confirmations: 1 })).reason, 'reorg_payment_removed');
  assert.equal((await db.query('select status from fintree_private.invoices where id=$1', [session.id])).rows[0].status, 'pending');
  assert.equal((await runScannerCycle({ ...cycleConfig, provider: new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }) })).scanned, 1);
  assert.equal((await runScannerCycle({ ...cycleConfig, provider: new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }), confirmations: 1 })).rechecked, 1);
  assert.equal((await reconcilePayment({ db, provider: new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }), transactionHash: customerReceipt.hash, invoiceId: session.id, confirmations: 1 })).recorded, false);
  assert.equal((await db.query('select status from fintree_private.invoices where id = $1', [session.id])).rows[0].status, 'paid');
  assert.equal(await token.balanceOf(await merchant.getAddress()), issued.amounts.merchantReceives + 10000000n);
  const behind = { getNetwork: () => provider.getNetwork(), getBlockNumber: async () => customerReceipt.blockNumber - 1, getBlock: (number) => provider.getBlock(number) };
  assert.equal((await monitorPaidPayments({ db, provider: behind, chainId: config.chainId, contract: config.contract })).incidents, 0);
  const changed = { getNetwork: () => provider.getNetwork(), getBlockNumber: async () => customerReceipt.blockNumber,
    getBlock: async (number) => number === customerReceipt.blockNumber ? { hash: newHash } : provider.getBlock(number) };
  const collisionId = `evt_review_${session.id}`;
  await db.query("insert into fintree_private.webhook_outbox (event_id,invoice_id,event_type,payload) values ($1,$2,'collision','{}')", [collisionId, invoice.invoiceId]);
  await assert.rejects(monitorPaidPayments({ db, provider: changed, chainId: config.chainId, contract: config.contract }));
  assert.equal((await db.query('select count(*)::int as count from fintree_private.payment_incidents where invoice_id=$1', [session.id])).rows[0].count, 0);
  await db.query('delete from fintree_private.webhook_outbox where event_id=$1', [collisionId]);
  assert.equal((await monitorPaidPayments({ db, provider: changed, chainId: config.chainId, contract: config.contract })).incidents, 1);
  assert.equal((await monitorPaidPayments({ db, provider: changed, chainId: config.chainId, contract: config.contract })).incidents, 0);
  const incident = (await db.query('select * from fintree_private.payment_incidents where invoice_id=$1', [session.id])).rows[0];
  assert.equal(incident.original_block_hash, oldHash.toLowerCase());
  assert.equal(incident.observed_block_hash, newHash);
  const events = (await db.query("select payload from fintree_private.webhook_outbox where invoice_id=$1 and event_type='checkout.session.payment_review_required'", [session.id])).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.schema_version, 1);
  assert.ok(Number.isFinite(Date.parse(events[0].payload.created_at)));
  assert.equal(events[0].payload.data.invoice_id, session.id);
  assert.equal((await getMerchantCheckoutSession(db, merchantId, session.id)).reviewRequired, true);
  assert.equal((await createCheckoutSession({ db, signer: quoteSigner, config, merchantId, idempotencyKey: 'key-2', request: { amount: '10', orderId: 'order-2', feePayer: 'customer' } })).session.reviewRequired, true);
  const publicHandler = createPublicCheckoutHandler({ db });
  assert.equal((await (await publicHandler(new Request(`http://localhost/api/v1/public/checkout/sessions/${session.id}`))).json()).reviewRequired, true);
});

test('rejects changed quote, wrong domain, expired quote and wrong token', async (t) => {
  const { splitter, quote, domain, sign } = await setup(t);
  const signature = await sign();
  for (const changed of [
    { ...quote, merchantAmount: quote.merchantAmount + 1n },
    { ...quote, protocolFee: quote.protocolFee + 1n },
    { ...quote, merchant: '0x0000000000000000000000000000000000000001' },
    { ...quote, invoiceId: id('another') },
    { ...quote, token: '0x0000000000000000000000000000000000000001' },
  ]) await assert.rejects(splitter.payInvoice.staticCall(changed, signature));
  await assert.rejects(splitter.payInvoice.staticCall(quote, await sign(quote, { ...domain, chainId: domain.chainId + 1n })));
  await assert.rejects(splitter.payInvoice.staticCall(quote, await sign(quote, { ...domain, verifyingContract: '0x0000000000000000000000000000000000000001' })));
  const expired = { ...quote, deadline: 1n };
  await assert.rejects(splitter.payInvoice.staticCall(expired, await sign(expired)));
  assert.equal(await splitter.processedInvoices(quote.invoiceId), false);
});

test('a failing treasury transfer rolls back merchant payment and invoice state', async (t) => {
  const { token, splitter, quote, treasury, sign } = await setup(t);
  await (await token.setBlockedRecipient(await treasury.getAddress())).wait();
  await assert.rejects(async () => (await splitter.payInvoice(quote, await sign(), { gasLimit: 1_000_000 })).wait());
  assert.equal(await token.balanceOf(quote.merchant), 0n);
  assert.equal(await splitter.processedInvoices(quote.invoiceId), false);
});

test('verifies an actual local payment against trusted invoice and confirmation policy', async (t) => {
  const { provider, token, splitter, quote, sign } = await setup(t);
  const receipt = await (await splitter.payInvoice(quote, await sign())).wait();
  const invoice = { ...quote, chainId: (await provider.getNetwork()).chainId, contract: splitter.target };
  const verify = (overrides = {}) => verifyPayment({ provider, transactionHash: receipt.hash, invoice, confirmations: 1, ...overrides });
  assert.equal((await verify()).status, 'paid');
  assert.equal((await verify({ confirmations: 100 })).status, 'confirming');
  for (const changed of [
    { ...invoice, chainId: invoice.chainId + 1n },
    { ...invoice, invoiceId: id('different') },
    { ...invoice, merchantAmount: invoice.merchantAmount + 1n },
    { ...invoice, protocolFee: invoice.protocolFee + 1n },
    { ...invoice, token: '0x0000000000000000000000000000000000000001' },
    { ...invoice, merchant: '0x0000000000000000000000000000000000000001' },
    { ...invoice, contract: token.target },
    { ...invoice, deadline: 1n },
  ]) assert.equal((await verify({ invoice: changed })).status, 'rejected');
  assert.deepEqual(await verify({ transactionHash: id('unknown transaction') }), { status: 'pending', reason: 'receipt_not_found' });
  const reorgProvider = { getNetwork: () => provider.getNetwork(), getTransactionReceipt: () => provider.getTransactionReceipt(receipt.hash), getBlock: async () => null };
  assert.deepEqual(await verify({ provider: reorgProvider }), { status: 'pending', reason: 'noncanonical_receipt' });
  const failedProvider = { getNetwork: () => provider.getNetwork(), getTransactionReceipt: async () => ({ hash: receipt.hash, status: 0, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash }), getBlock: () => provider.getBlock(receipt.blockNumber) };
  assert.deepEqual(await verify({ provider: failedProvider }), { status: 'rejected', reason: 'transaction_failed', observedBlockHash: receipt.blockHash });
  await assert.rejects(verify({ confirmations: 0 }), TypeError);
});

test('bundled testnet page connects a wallet, creates checkout, and waits for server verification', { timeout: 60000 }, async (t) => {
  const { provider, payer, token, splitter, quoteSigner, rpc } = await setup(t);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fs.readFileSync('db/schema-draft.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/local-migrations/003-checkout-details.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/local-migrations/002-merchant-updated-at.sql', 'utf8'));
  const origin = 'http://127.0.0.1:4174';
  const config = { chainId: (await provider.getNetwork()).chainId, contract: splitter.target, token: token.target, signerAddress: quoteSigner.address, tokenDecimals: 6, feeBps: 30, ttlSeconds: 900 };
  const webhookSettings = createWebhookSettings({ db, masterKey: Buffer.alloc(32, 1) });
  const app = createApp({ db, signer: quoteSigner, config, origin, webhookSettings });
  const assets = await loadTestnetAssets();
  const bundle = Buffer.from(assets.javascript).toString('base64');
  const saved = { document: globalThis.document, window: globalThis.window, location: globalThis.location, fetch: globalThis.fetch };
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  function makeDocument() {
    const elements = new Map();
    const make = () => ({ hidden: true, disabled: false, value: '', textContent: '', className: '', children: [], listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; }, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }, click() { this.clicked = true; },
      fire(type) { return this.listeners[type]({ preventDefault() {}, currentTarget: this }); } });
    return { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, make()); return elements.get(selector); }, createElement: make };
  }
  let candidateHash = null, wasPendingBeforeReconcile = false, completedChallenges = 0, loseOrderResponse = false;
  const orderKeys = [];
  globalThis.fetch = async (url, options) => {
    if (String(url) === '/api/v1/wallet/complete') completedChallenges++;
    if (candidateHash && String(url).startsWith('/api/v1/public/checkout/sessions/')) {
      wasPendingBeforeReconcile = document.querySelector('#status').textContent === 'Pending';
      const fresh = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
      try { await reconcilePayment({ db, provider: fresh, invoiceId: String(url).split('/').pop(), transactionHash: candidateHash, confirmations: 1 }); }
      finally { fresh.destroy(); }
      candidateHash = null;
    }
    const response = await app(new Request(new URL(url, origin), options));
    if (String(url) === '/api/v1/checkout/sessions' && options?.method === 'POST') {
      orderKeys.push(options.headers['idempotency-key']);
      if (loseOrderResponse) { loseOrderResponse = false; throw new Error('Response lost after server commit'); }
    }
    return response;
  };
  const merchant = Wallet.createRandom();
  let accountsChanged, chainChanged, walletChain = `0x${config.chainId.toString(16)}`, deferSignature = true, resumeSignature, signalSignStarted;
  const signStarted = new Promise((resolve) => { signalSignStarted = resolve; });
  const merchantEthereum = { on(event, callback) { if (event === 'accountsChanged') accountsChanged = callback; if (event === 'chainChanged') chainChanged = callback; }, request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [merchant.address];
    if (method === 'eth_chainId') return walletChain;
    if (method === 'personal_sign') {
      if (deferSignature) { await new Promise((resolve) => { resumeSignature = resolve; signalSignStarted(); }); }
      return merchant.signMessage(getBytes(params[0]));
    }
    throw new Error(`Unexpected wallet method: ${method}`);
  } };
  const merchantStorageValues = new Map();
  const merchantStorage = { getItem: (key) => merchantStorageValues.get(key) ?? null, setItem: (key, value) => merchantStorageValues.set(key, value), removeItem: (key) => merchantStorageValues.delete(key) };
  let copiedLink = null;
  globalThis.document = makeDocument(); globalThis.window = { ethereum: merchantEthereum, localStorage: merchantStorage, navigator: { clipboard: { async writeText(value) { copiedLink = value; } } } }; globalThis.location = { pathname: '/', href: `${origin}/` };
  await import(`data:text/javascript;base64,${bundle}#merchant`);
  document.querySelector('#amount').value = '100'; document.querySelector('#fee').value = 'customer';
  document.querySelector('#amount').fire('input');
  assert.equal(document.querySelector('#fee-preview').hidden, false);
  assert.equal(document.querySelector('#fee-preview').children[0].children[1].textContent, '0.30 test tokens');
  assert.equal(document.querySelector('#fee-preview').children[1].children[1].textContent, '100.30 test tokens');
  document.querySelector('#fee').value = 'merchant'; document.querySelector('#fee').fire('change');
  assert.equal(document.querySelector('#fee-preview').children[2].children[1].textContent, '99.70 test tokens');
  document.querySelector('#amount').value = '1.0000001'; document.querySelector('#amount').fire('input');
  assert.equal(document.querySelector('#fee-preview').hidden, true);
  await document.querySelector('#refresh-service').fire('click');
  assert.match(document.querySelector('#service-status').textContent, /unavailable/);
  const interruptedLogin = document.querySelector('#connect').fire('click');
  await signStarted; accountsChanged([]); resumeSignature(); await interruptedLogin;
  assert.equal(completedChallenges, 0);
  assert.equal(document.querySelector('#api-key').value, '');
  assert.match(document.querySelector('#wallet-state').textContent, /Account changed/);
  deferSignature = false;
  await document.querySelector('#connect').fire('click');
  assert.match(document.querySelector('#api-key').value, /^fintree_test_/);
  assert.equal(document.querySelector('#disconnect-area').hidden, false);
  assert.match(document.querySelector('#network-state').textContent, /matches the configured network/);
  walletChain = '0x1'; await chainChanged();
  assert.match(document.querySelector('#network-state').textContent, /Wallet is on chain 1/);
  walletChain = `0x${config.chainId.toString(16)}`; await chainChanged();
  assert.match(document.querySelector('#network-state').textContent, /matches the configured network/);
  const initialKey = document.querySelector('#api-key').value;
  assert.equal(document.querySelector('#api-key').type, 'password');
  document.querySelector('#api-key-toggle').fire('click');
  assert.equal(document.querySelector('#api-key').type, 'text');
  assert.equal(document.querySelector('#api-key-toggle')['aria-pressed'], 'true');
  await document.querySelector('#api-key-copy').fire('click');
  assert.equal(copiedLink, initialKey);
  assert.equal(document.querySelector('#api-key-copy-state').textContent, 'Copied. Store it securely.');
  await document.querySelector('#new-key').fire('click');
  const newKey = document.querySelector('#api-key').value;
  assert.notEqual(newKey, initialKey);
  assert.equal(document.querySelector('#api-key').type, 'password');
  const newKeyRow = document.querySelector('#api-key-list').children.find((row) => row.children[0]?.textContent.startsWith(newKey.slice(0, 21)));
  assert.ok(newKeyRow);
  await newKeyRow.children[1].fire('click');
  assert.equal(document.querySelector('#key-status').textContent, 'Key revoked.');
  document.querySelector('#business-name').value = 'Merchant Uji';
  await document.querySelector('#business-form').fire('submit');
  assert.equal(document.querySelector('#business-state').textContent, 'Business name saved.');
  document.querySelector('#webhook-url').value = 'https://merchant.example/hook';
  await document.querySelector('#webhook-form').fire('submit');
  assert.match(document.querySelector('#webhook-secret').value, /^whsec_/);
  assert.equal(document.querySelector('#webhook-secret').type, 'password');
  await document.querySelector('#webhook-secret-copy').fire('click');
  assert.equal(copiedLink, document.querySelector('#webhook-secret').value);
  window.navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
  await document.querySelector('#webhook-secret-copy').fire('click');
  assert.match(document.querySelector('#webhook-secret-copy-state').textContent, /copy it manually/);
  window.navigator.clipboard.writeText = async (value) => { copiedLink = value; };
  document.querySelector('#order').value = 'browser-order'; document.querySelector('#amount').value = '4.50'; document.querySelector('#fee').value = 'customer';
  document.querySelector('#return-url').value = 'http://merchant.example/thanks';
  await document.querySelector('#invoice-form').fire('submit');
  assert.match(document.querySelector('#return-url-error').textContent, /valid HTTPS URL/);
  assert.equal(orderKeys.length, 0);
  document.querySelector('#return-url').value = 'https://merchant.example/thanks';
  loseOrderResponse = true;
  await document.querySelector('#invoice-form').fire('submit');
  assert.equal((await db.query('select count(*)::int as count from fintree_private.invoices')).rows[0].count, 1);
  await document.querySelector('#refresh-list').fire('click');
  assert.equal(document.querySelector('#invoices').children.length, 1);
  assert.equal(document.querySelector('#summary-loaded').textContent, '1');
  assert.equal(document.querySelector('#summary-awaiting').textContent, '1');
  assert.equal(document.querySelector('#summary-paid').textContent, '0');
  assert.equal(document.querySelector('#summary-review').textContent, '0');
  const summaryInvoice = (await db.query('select id from fintree_private.invoices limit 1')).rows[0].id;
  await db.query("insert into fintree_private.payment_incidents (invoice_id,kind,original_block_hash,observed_block_hash) values ($1,'paid_block_changed',$2,$3)", [summaryInvoice, `0x${'3'.repeat(64)}`, `0x${'4'.repeat(64)}`]);
  await document.querySelector('#refresh-list').fire('click');
  assert.equal(document.querySelector('#summary-awaiting').textContent, '0');
  assert.equal(document.querySelector('#summary-review').textContent, '1');
  await db.query('delete from fintree_private.payment_incidents where invoice_id=$1', [summaryInvoice]);
  await document.querySelector('#refresh-list').fire('click');
  assert.equal(document.querySelector('#export-payments').disabled, false);
  document.querySelector('#export-payments').fire('click');
  assert.match(document.querySelector('#export-payment-state').textContent, /1 visible payment/);
  const paymentRow = document.querySelector('#invoices').children[0];
  const detailRows = paymentRow.children[2].children[1].children;
  assert.ok(detailRows.some((row) => row.children[0].textContent === 'Network'));
  assert.ok(detailRows.some((row) => row.children[0].textContent === 'Token address' && row.children[1].textContent.toLowerCase() === token.target.toLowerCase()));
  assert.ok(detailRows.some((row) => row.children[0].textContent === 'Order amount' && row.children[1].textContent === '4.50 test tokens'));
  assert.ok(detailRows.some((row) => row.children[0].textContent === 'Fee paid by' && row.children[1].textContent === 'Customer'));
  await paymentRow.children[1].fire('click');
  assert.match(copiedLink, /^http:\/\/127\.0\.0\.1:4174\/pay\/0x[0-9a-f]{64}$/);
  assert.equal(document.querySelector('#copy-payment-state').textContent, 'Checkout link copied.');
  assert.equal(document.querySelector('#local-link-warning').hidden, false);
  window.navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
  await paymentRow.children[1].fire('click');
  assert.match(document.querySelector('#copy-payment-state').textContent, /Open the payment/);
  document.querySelector('#payment-search').value = 'no-match';
  document.querySelector('#payment-search').fire('input');
  assert.equal(document.querySelector('#invoices').children.length, 0);
  assert.equal(document.querySelector('#export-payments').disabled, true);
  assert.match(document.querySelector('#invoices').textContent, /No payments match/);
  document.querySelector('#payment-search').value = 'browser-order';
  document.querySelector('#payment-search').fire('input');
  assert.equal(document.querySelector('#invoices').children.length, 1);
  document.querySelector('#status-filter').value = 'paid';
  document.querySelector('#status-filter').fire('change');
  assert.equal(document.querySelector('#invoices').children.length, 0);
  document.querySelector('#status-filter').value = 'all';
  const invoiceForRetry = (await db.query('select id from fintree_private.invoices limit 1')).rows[0].id;
  await db.query("insert into fintree_private.webhook_outbox (event_id,invoice_id,event_type,payload,status,attempts) values ('evt_ui_retry',$1,'test.ui',$2::jsonb,'failed',1)", [invoiceForRetry, JSON.stringify({ id: 'evt_ui_retry', type: 'test.ui' })]);
  await db.query("insert into fintree_private.webhook_attempts (id,event_id,attempt_number,response_status,outcome) values ('00000000-0000-0000-0000-000000000010','evt_ui_retry',1,503,'failed')");
  globalThis.document = makeDocument();
  await import(`data:text/javascript;base64,${bundle}#merchant-reloaded`);
  await document.querySelector('#connect').fire('click');
  const retryRow = document.querySelector('#webhook-attempts').children.find((row) => row.children.some((child) => child.textContent === 'Try again'));
  assert.ok(retryRow);
  await retryRow.children.find((child) => child.textContent === 'Try again').fire('click');
  assert.match(document.querySelector('#webhook-retry-state').textContent, /rescheduled/);
  assert.equal((await db.query("select status from fintree_private.webhook_outbox where event_id='evt_ui_retry'")).rows[0].status, 'pending');
  document.querySelector('#order').value = 'browser-order'; document.querySelector('#amount').value = '4.50'; document.querySelector('#fee').value = 'customer';
  document.querySelector('#return-url').value = 'https://merchant.example/thanks';
  await document.querySelector('#invoice-form').fire('submit');
  assert.equal(orderKeys.length, 2); assert.equal(orderKeys[0], orderKeys[1]);
  assert.equal((await db.query('select count(*)::int as count from fintree_private.invoices')).rows[0].count, 1);
  assert.equal(document.querySelector('#created-payment').hidden, false);
  assert.equal(location.href, `${origin}/`);
  assert.equal(document.querySelector('#order').value, '');
  assert.equal(document.querySelector('#return-url').value, '');
  const createdUrl = document.querySelector('#created-payment-link').value;
  assert.equal(document.querySelector('#open-created-payment').href, createdUrl);
  window.navigator.clipboard.writeText = async (value) => { copiedLink = value; };
  await document.querySelector('#copy-created-payment').fire('click');
  assert.equal(copiedLink, createdUrl);
  assert.equal(document.querySelector('#created-payment-state').textContent, 'Checkout link copied.');
  const issuedBeforeDisconnect = document.querySelector('#api-key').value;
  document.querySelector('#disconnect').fire('click');
  assert.equal(document.querySelector('#api-key').value, '');
  assert.equal(document.querySelector('#disconnect-area').hidden, true);
  assert.match(document.querySelector('#wallet-state').textContent, /wallet remains connected/);
  assert.equal((await app(new Request(`${origin}/api/v1/merchant`, { headers: { authorization: `Bearer ${issuedBeforeDisconnect}` } }))).status, 200);
  assert.equal(document.querySelector('#created-payment').hidden, true);
  assert.equal(document.querySelector('#created-payment-link').value, '');
  assert.equal(document.querySelector('#summary-loaded').textContent, '—');
  assert.equal(document.querySelector('#check-network').disabled, true);
  assert.match(document.querySelector('#network-state').textContent, /Connect a wallet/);
  const checkoutId = new URL(createdUrl).pathname.split('/').pop();
  assert.match(checkoutId, /^0x[0-9a-f]{64}$/);
  assert.equal((await db.query('select return_url from fintree_private.invoices where id=$1', [checkoutId])).rows[0].return_url, 'https://merchant.example/thanks');
  await (await token.approve(splitter.target, 0n)).wait();
  let paymentFailure = null, wrongBuyerNetwork = false, switchError = null, switchRequests = 0;
  const wallet = { on() {}, request: async (args) => {
    if (args.method === 'eth_chainId' && wrongBuyerNetwork) return '0x1';
    if (args.method === 'wallet_switchEthereumChain') {
      switchRequests++;
      assert.equal(args.params[0].chainId, `0x${config.chainId.toString(16)}`);
      if (switchError) { const error = new Error('Switch failed'); error.code = switchError; throw error; }
      wrongBuyerNetwork = false; return null;
    }
    if (paymentFailure && args.method === 'eth_sendTransaction' && args.params?.[0]?.to?.toLowerCase() === splitter.target.toLowerCase()) {
      const error = new Error(paymentFailure === 'rejected' ? 'User rejected request' : 'Connection lost');
      error.code = paymentFailure === 'rejected' ? 4001 : -32603;
      throw error;
    }
    const result = await rpc.request({ ...args, method: args.method === 'eth_requestAccounts' ? 'eth_accounts' : args.method });
    if (args.method === 'eth_sendTransaction' && args.params?.[0]?.to?.toLowerCase() === splitter.target.toLowerCase()) candidateHash = result;
    return result;
  } };
  const savedPayments = new Map();
  const storage = { getItem: (key) => savedPayments.get(key) ?? null, setItem: (key, value) => savedPayments.set(key, value), removeItem: (key) => savedPayments.delete(key) };
  const hint = createPendingPayment({ storage, chainId: config.chainId, contract: config.contract, invoiceId: checkoutId });
  await db.query("insert into fintree_private.payment_incidents (invoice_id,kind,original_block_hash,observed_block_hash) values ($1,'paid_block_changed',$2,$3)", [checkoutId, `0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`]);
  globalThis.document = makeDocument(); globalThis.window = { ethereum: wallet, localStorage: storage }; globalThis.location = { pathname: `/pay/${checkoutId}`, href: `${origin}/pay/${checkoutId}` };
  await import(`data:text/javascript;base64,${bundle}#buyer-review`);
  assert.equal(document.querySelector('#pay').disabled, true);
  assert.match(document.querySelector('#checkout-step').textContent, /requires review/);
  await db.query('delete from fintree_private.payment_incidents where invoice_id=$1', [checkoutId]);
  hint.set(id('submitted-but-not-yet-seen'));
  globalThis.document = makeDocument(); globalThis.window = { ethereum: wallet, localStorage: storage }; globalThis.location = { pathname: `/pay/${checkoutId}`, href: `${origin}/pay/${checkoutId}` };
  await import(`data:text/javascript;base64,${bundle}#buyer-reloaded`);
  assert.equal(document.querySelector('#pay').disabled, true);
  assert.match(document.querySelector('#message').textContent, /submitted/);
  hint.clear();
  globalThis.document = makeDocument();
  await import(`data:text/javascript;base64,${bundle}#buyer`);
  assert.equal(document.querySelector('#title').textContent, 'Merchant Uji');
  assert.equal(document.querySelector('#status').textContent, 'Pending');
  assert.equal(document.querySelector('#total').textContent, '4.5135');
  assert.ok(document.querySelector('#details').children.some((row) => row.children[0].textContent === 'Order amount' && row.children[1].textContent === '4.50 test tokens'));
  assert.match(document.querySelector('#checkout-step').textContent, /Review the network/);
  assert.ok(document.querySelector('#details').children.some((row) => row.children[0].textContent === 'Network'));
  assert.ok(document.querySelector('#details').children.some((row) => row.children[0].textContent === 'Token address'));
  assert.equal(document.querySelector('#return-link').hidden, true);
  wrongBuyerNetwork = true;
  await document.querySelector('#pay').fire('click');
  assert.equal(document.querySelector('#switch-network').hidden, false);
  assert.equal(document.querySelector('#pay').disabled, false);
  assert.equal(candidateHash, null);
  switchError = 4902; await document.querySelector('#switch-network').fire('click');
  assert.match(document.querySelector('#error').textContent, /Add the required test network/);
  switchError = 4001; await document.querySelector('#switch-network').fire('click');
  assert.match(document.querySelector('#error').textContent, /cancelled/);
  switchError = null; await document.querySelector('#switch-network').fire('click');
  assert.equal(switchRequests, 3);
  assert.equal(document.querySelector('#switch-network').hidden, true);
  assert.match(document.querySelector('#checkout-step').textContent, /select Pay/);
  assert.equal(candidateHash, null);
  paymentFailure = 'rejected';
  await document.querySelector('#pay').fire('click');
  assert.equal(document.querySelector('#pay').disabled, false);
  assert.equal(hint.get(), null);
  assert.match(document.querySelector('#error').textContent, /cancelled/);
  paymentFailure = 'uncertain';
  await document.querySelector('#pay').fire('click');
  assert.equal(document.querySelector('#pay').disabled, true);
  assert.equal(hint.get(), 'requesting');
  assert.match(document.querySelector('#error').textContent, /unknown/);
  globalThis.document = makeDocument();
  await import(`data:text/javascript;base64,${bundle}#buyer-uncertain`);
  assert.equal(document.querySelector('#pay').disabled, true);
  assert.match(document.querySelector('#message').textContent, /unknown/);
  hint.clear(); paymentFailure = null;
  globalThis.document = makeDocument();
  await import(`data:text/javascript;base64,${bundle}#buyer-retry`);
  await document.querySelector('#pay').fire('click');
  assert.equal(wasPendingBeforeReconcile, true);
  assert.equal(document.querySelector('#status').textContent, 'Paid');
  assert.match(document.querySelector('#checkout-step').textContent, /payment has been verified/);
  assert.equal(document.querySelector('#message').textContent, 'The server verified this payment.');
  assert.equal(document.querySelector('#return-link').hidden, false);
  assert.equal(document.querySelector('#return-link').href, 'https://merchant.example/thanks');
  assert.ok((await token.balanceOf(merchant.address)) > 0n);
  assert.ok(await payer.getAddress());
});
