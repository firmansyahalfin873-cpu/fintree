import fs from 'node:fs/promises';
import path from 'node:path';
import { Wallet, getAddress } from 'ethers';

export class SignerVaultMismatchError extends Error {
  constructor() { super('Signer vault does not match the deployment'); this.name = 'SignerVaultMismatchError'; }
}

// This is a separate testnet quote signer, never the user's browser wallet.
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new TypeError('Password must contain at least 12 characters');
}

export async function createSignerVault({ filename, password }) {
  validatePassword(password);
  if (typeof filename !== 'string' || !filename.trim()) throw new TypeError('A vault path is required');
  const wallet = Wallet.createRandom();
  const encrypted = await wallet.encrypt(password);
  const target = path.resolve(filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const file = await fs.open(target, 'wx', 0o600);
  try { await file.writeFile(encrypted, 'utf8'); await file.sync(); }
  finally { await file.close(); }
  return { address: wallet.address };
}

export async function unlockSignerVault({ filename, password, expectedAddress }) {
  validatePassword(password);
  const encrypted = await fs.readFile(filename, 'utf8');
  const wallet = await Wallet.fromEncryptedJson(encrypted, password);
  if (expectedAddress && wallet.address !== getAddress(expectedAddress)) throw new SignerVaultMismatchError();
  return wallet;
}
