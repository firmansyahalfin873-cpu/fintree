import { getAddress, hexlify, isHexString, MaxUint256, randomBytes, ZeroAddress, ZeroHash } from 'ethers';
import { calculateQuote, parseAmount } from '../domain/money.mjs';

export const QUOTE_TYPES = Object.freeze({ Quote: [
  { name: 'invoiceId', type: 'bytes32' },
  { name: 'token', type: 'address' },
  { name: 'merchant', type: 'address' },
  { name: 'merchantAmount', type: 'uint256' },
  { name: 'protocolFee', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
] });

function nonzeroAddress(value) {
  const address = getAddress(value);
  if (address === ZeroAddress) throw new RangeError('Zero address is not allowed');
  return address;
}

/** Create a quote for a trusted merchant and server-side chain configuration. */
export async function createQuote({ signer, config, merchant, amount, feePayer, now = Math.floor(Date.now() / 1000), invoiceId = hexlify(randomBytes(32)) }) {
  if (!config || typeof config.chainId !== 'bigint' || config.chainId <= 0n || config.chainId > MaxUint256 ||
      !Number.isSafeInteger(config.ttlSeconds) || config.ttlSeconds <= 0 ||
      !Number.isInteger(config.tokenDecimals) || config.tokenDecimals < 0 || config.tokenDecimals > 18 ||
      !Number.isInteger(config.feeBps) || config.feeBps < 0 || config.feeBps > 10000 ||
      !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + config.ttlSeconds)) throw new RangeError('Invalid quote configuration');
  if (typeof amount !== 'string' || amount.length > 80) throw new RangeError('Invalid amount');
  if (!isHexString(invoiceId, 32) || invoiceId === ZeroHash) throw new RangeError('Invalid invoice ID');
  const contract = nonzeroAddress(config.contract);
  const token = nonzeroAddress(config.token);
  const merchantAddress = nonzeroAddress(merchant);
  const expectedSigner = nonzeroAddress(config.signerAddress);
  if (getAddress(await signer.getAddress()) !== expectedSigner) throw new Error('Signer does not match configured contract signer');
  const amounts = calculateQuote(parseAmount(amount, config.tokenDecimals), feePayer, config.feeBps);
  if (amounts.merchantReceives <= 0n || amounts.totalPayable > MaxUint256) throw new RangeError('Amount cannot be settled');
  const quote = { invoiceId, token, merchant: merchantAddress, merchantAmount: amounts.merchantReceives, protocolFee: amounts.protocolFee, deadline: BigInt(now + config.ttlSeconds) };
  const domain = { name: 'Fintree', version: '1', chainId: config.chainId, verifyingContract: contract };
  const signature = await signer.signTypedData(domain, QUOTE_TYPES, quote);
  return { quote, signature, amounts, feePayer, chainId: config.chainId, contract, feeBps: config.feeBps };
}
