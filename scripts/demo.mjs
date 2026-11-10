// Self-contained demonstration only: ephemeral database, blockchain and wallets.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createLocalChain } from '../src/testing/local-chain.mjs';
import solc from 'solc';
import { BrowserProvider, ContractFactory, Wallet } from 'ethers';
import { PGlite } from '@electric-sql/pglite';
import { createOnboardingHandler } from '../src/api/onboarding-handler.mjs';
import { createCheckoutHandler } from '../src/api/checkout-handler.mjs';
import { scanPayments } from '../src/payments/scan-payments.mjs';
import { deliverNextWebhook } from '../src/webhooks/deliver-next.mjs';
import { generateWebhookSecret, verifyWebhook } from '../src/webhooks/signature.mjs';

const require = createRequire(import.meta.url);
const sources = Object.fromEntries(['contracts/FintreeSplitter.sol', 'contracts/test/TestToken.sol'].map((file) => [file, { content: fs.readFileSync(file, 'utf8') }]));
const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: (file) => {
  try { return { contents: fs.readFileSync(require.resolve(file), 'utf8') }; } catch { return { error: `Missing import: ${file}` }; }
} }));
const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join('\n'));
const rpc = await createLocalChain();
const db = new PGlite();
try {
  await db.exec(fs.readFileSync('db/schema-draft.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/local-migrations/003-checkout-details.sql', 'utf8'));
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }), payer = await provider.getSigner(0), treasury = await provider.getSigner(1);
  const signer = new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey);
  async function deploy(file, name, args = []) {
    const artifact = output.contracts[file][name];
    const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, payer).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  }
  const token = await deploy('contracts/test/TestToken.sol', 'TestToken');
  const splitter = await deploy('contracts/FintreeSplitter.sol', 'FintreeSplitter', [token.target, await treasury.getAddress(), signer.address]);
  await (await token.approve(splitter.target, 1_000_000_000n)).wait();
  const config = { chainId: (await provider.getNetwork()).chainId, contract: splitter.target, token: token.target, signerAddress: signer.address, tokenDecimals: 6, feeBps: 30, ttlSeconds: 900 };
  const origin = 'http://localhost:3000', merchant = Wallet.createRandom();
  const onboarding = createOnboardingHandler({ db, origin });
  const call = (handler, path, body, headers = {}) => handler(new Request(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  const challengeResponse = await call(onboarding, '/api/v1/wallet/challenge', { wallet: merchant.address });
  if (!challengeResponse.ok) throw new Error('Challenge failed');
  const challenge = await challengeResponse.json();
  const registration = await call(onboarding, '/api/v1/wallet/complete', { id: challenge.id, nonce: challenge.nonce, signature: await merchant.signMessage(challenge.message) });
  if (!registration.ok) throw new Error('Onboarding failed');
  const { apiKey } = await registration.json();
  const checkout = createCheckoutHandler({ db, signer, config, checkoutOrigin: origin });
  const response = await call(checkout, '/api/v1/checkout/sessions', { amount: '10', orderId: 'demo-order', feePayer: 'customer' }, { authorization: `Bearer ${apiKey}`, 'idempotency-key': 'demo-1' });
  if (!response.ok) throw new Error('Checkout creation failed');
  const session = await response.json();
  const quote = { invoiceId: session.id, token: session.token, merchant: session.merchant, merchantAmount: session.merchantAmount, protocolFee: session.protocolFee, deadline: session.deadline };
  const receipt = await (await splitter.payInvoice(quote, session.signature)).wait();
  const scan = await scanPayments({ db, provider: new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }), chainId: config.chainId, contract: config.contract, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber, confirmations: 1 });
  if (scan[0]?.status !== 'paid') throw new Error('Payment verification failed');
  const secret = generateWebhookSecret();
  const delivered = await deliverNextWebhook({ db, getDeliveryConfig: async () => ({ url: 'https://demo.invalid/webhook', secret }), transport: async ({ body, headers }) => {
    if (!verifyWebhook(body, headers['x-fintree-signature'], secret)) throw new Error('Invalid signature');
    return { status: 200 };
  } });
  if (delivered.status !== 'delivered') throw new Error('Webhook demonstration failed');
  console.log('Local demonstration successful: wallet verified → session created → test payment confirmed → simulated webhook verified.');
  console.log('All data and funds were temporary simulations; no public network or merchant endpoint was contacted.');
} finally {
  await db.close();
  await rpc.disconnect();
}
