import { getAddress } from 'ethers';

/** Expiration is provisional: a timely event found later can still settle. */
export async function expireInvoices({ db, chainId, contract, limit = 500 }) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || !Number.isInteger(limit) || limit < 1 || limit > 5000) throw new RangeError('Invalid expiration configuration');
  const result = await db.query(`with due as (
    select id from fintree_private.invoices where chain_id=$1::numeric and contract_address=$2 and status='pending' and deadline < now()
    order by deadline,id for update skip locked limit $3
  ) update fintree_private.invoices i set status='expired' from due where i.id=due.id and i.status='pending' returning i.id`,
  [chainId.toString(), getAddress(contract).toLowerCase(), limit]);
  return result.rows.length;
}
