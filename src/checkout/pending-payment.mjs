import { getAddress, isHexString } from 'ethers';

/** A local hint only: the server still determines the payment status. */
export function createPendingPayment({ storage, chainId, contract, invoiceId }) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || !isHexString(invoiceId, 32)) throw new TypeError('Invalid checkout identity');
  const key = `fintree:payment:${chainId}:${getAddress(contract).toLowerCase()}:${invoiceId.toLowerCase()}`;
  return {
    get() {
      try { const value = storage?.getItem(key); return value === 'requesting' || isHexString(value, 32) ? value : null; }
      catch { return null; }
    },
    markRequested() { try { storage?.setItem(key, 'requesting'); } catch { /* Storage may be disabled. */ } },
    set(hash) {
      if (!isHexString(hash, 32)) throw new TypeError('Invalid transaction hash');
      try { storage?.setItem(key, hash.toLowerCase()); } catch { /* Checkout still works when storage is disabled. */ }
    },
    clear() { try { storage?.removeItem(key); } catch { /* Ignore unavailable storage. */ } },
  };
}
