import { BrowserProvider, Contract, getAddress, isHexString, MaxUint256, verifyTypedData, ZeroAddress, ZeroHash } from 'ethers';
import { QUOTE_TYPES } from '../payments/create-quote.mjs';

const tokenAbi = ['function allowance(address owner,address spender) view returns (uint256)', 'function approve(address spender,uint256 value) returns (bool)'];
const splitterAbi = ['function payInvoice((bytes32 invoiceId,address token,address merchant,uint256 merchantAmount,uint256 protocolFee,uint256 deadline) quote,bytes signature)'];
const integer = (value) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(value)) throw new TypeError('Invalid atomic amount');
  const result = BigInt(value);
  if (result > MaxUint256) throw new RangeError('Amount too large');
  return result;
};
const address = (value) => {
  const result = getAddress(value);
  if (result === ZeroAddress) throw new TypeError('Invalid address');
  return result;
};

/** Validate an untrusted public response against separately pinned deployment config. */
export function validateCheckout(session, deployment, now = Math.floor(Date.now() / 1000)) {
  if (!session || session.status !== 'pending' || !isHexString(session.id, 32) || session.id === ZeroHash ||
      !Number.isSafeInteger(session.deadline) || session.deadline <= now ||
      typeof session.chainId !== 'string' || !/^[1-9]\d{0,9}$/.test(session.chainId) || !['merchant', 'customer'].includes(session.feePayer)) throw new TypeError('Invalid or expired checkout');
  const chainId = BigInt(session.chainId);
  if (chainId !== deployment.chainId || address(session.contract) !== address(deployment.contract) || address(session.token) !== address(deployment.token)) throw new Error('Unexpected payment deployment');
  const merchant = address(session.merchant), merchantAmount = integer(session.merchantAmount), protocolFee = integer(session.protocolFee);
  const invoiceAmount = integer(session.invoiceAmount), totalPayable = integer(session.totalPayable);
  if (merchantAmount === 0n || invoiceAmount === 0n || totalPayable > MaxUint256 || merchantAmount + protocolFee !== totalPayable ||
      (session.feePayer === 'customer' ? invoiceAmount !== merchantAmount : invoiceAmount !== totalPayable)) throw new Error('Inconsistent payment amounts');
  const quote = { invoiceId: session.id, token: address(session.token), merchant, merchantAmount, protocolFee, deadline: BigInt(session.deadline) };
  const domain = { name: 'Fintree', version: '1', chainId, verifyingContract: address(session.contract) };
  if (address(verifyTypedData(domain, QUOTE_TYPES, quote, session.signature)) !== address(deployment.signer)) throw new Error('Invalid payment quote signature');
  return { quote, totalPayable, chainId, contract: domain.verifyingContract };
}

/** Submit payment; the server must independently verify the resulting receipt. */
export async function submitWalletPayment({ ethereum, session, deployment, onStatus = () => {} }) {
  const payment = validateCheckout(session, deployment);
  if (!ethereum?.request) throw new Error('Wallet not available');
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || !accounts[0]) throw new Error('Wallet account unavailable');
  const account = address(accounts[0]);
  async function assertWallet() {
    const [chain, active] = await Promise.all([ethereum.request({ method: 'eth_chainId' }), ethereum.request({ method: 'eth_accounts' })]);
    if (BigInt(chain) !== payment.chainId) throw new Error('Switch wallet to the required network');
    if (!Array.isArray(active) || !active[0] || address(active[0]) !== account) throw new Error('Wallet account changed');
  }
  await assertWallet();
  const provider = new BrowserProvider(ethereum);
  try {
  const signer = await provider.getSigner(account);
  const token = new Contract(payment.quote.token, tokenAbi, signer);
  const allowance = await token.allowance(account, payment.contract);
  if (allowance < payment.totalPayable) {
    if (allowance > 0n) {
      onStatus({ stage: 'reset_approval' });
      const reset = await token.approve(payment.contract, 0n);
      if ((await reset.wait()).status !== 1) throw new Error('Approval reset failed');
      await assertWallet();
    }
    onStatus({ stage: 'approval' });
    const approval = await token.approve(payment.contract, payment.totalPayable);
    if ((await approval.wait()).status !== 1) throw new Error('Token approval failed');
  }
  await assertWallet();
  if (Math.floor(Date.now() / 1000) >= session.deadline) throw new Error('Checkout expired');
  onStatus({ stage: 'payment' });
  const tx = await new Contract(payment.contract, splitterAbi, signer).payInvoice(payment.quote, session.signature);
  onStatus({ stage: 'submitted', transactionHash: tx.hash });
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Payment transaction failed');
  return { transactionHash: tx.hash, stage: 'awaiting_server_verification' };
  } finally { provider.destroy(); }
}
