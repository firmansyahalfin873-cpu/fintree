import { getAddress, isHexString } from 'ethers';

/** A changed paid block creates a persistent incident and a single notification. */
export async function monitorPaidPayments({ db, provider, chainId, contract, limit = 20 }) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid monitoring configuration');
  if ((await provider.getNetwork()).chainId !== chainId) throw new Error('Unexpected chain');
  const head = await provider.getBlockNumber();
  if (!Number.isSafeInteger(head) || head < 0) throw new Error('Invalid chain head');
  const rows = (await db.query(`select i.id,i.block_hash,i.block_number from fintree_private.invoices i
    where i.chain_id=$1::numeric and i.contract_address=$2 and i.status='paid'
      and not exists (select 1 from fintree_private.payment_incidents p where p.invoice_id=i.id)
    order by i.paid_rechecked_at asc nulls first,i.id limit $3`, [chainId.toString(), getAddress(contract).toLowerCase(), limit])).rows;
  let incidents = 0;
  for (const row of rows) {
    const number = Number(row.block_number);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid stored block');
    const block = head >= number ? await provider.getBlock(number) : null;
    if (block && isHexString(block.hash, 32) && block.hash.toLowerCase() !== row.block_hash.toLowerCase()) {
      const result = await db.query(`with affected as (
          select id,tx_hash,block_hash from fintree_private.invoices where id=$1 and status='paid' and block_hash=$2
        ), incident as (
          insert into fintree_private.payment_incidents (invoice_id,kind,original_block_hash,observed_block_hash)
          select id,'paid_block_changed',block_hash,$3 from affected on conflict (invoice_id) do nothing returning invoice_id
        ), queued as (
          insert into fintree_private.webhook_outbox (event_id,invoice_id,event_type,payload)
          select 'evt_review_' || a.id,a.id,'checkout.session.payment_review_required',
            jsonb_build_object('id','evt_review_' || a.id,'type','checkout.session.payment_review_required','schema_version',1,'created_at',now(),
              'data',jsonb_build_object('invoice_id',a.id,'tx_hash',a.tx_hash,'original_block_hash',a.block_hash,'observed_block_hash',$3))
          from affected a join incident p on p.invoice_id=a.id
          on conflict (invoice_id,event_type) do nothing returning event_id
        ) select event_id from queued`, [row.id, row.block_hash, block.hash.toLowerCase()]);
      incidents += result.rows.length;
    }
    await db.query("update fintree_private.invoices set paid_rechecked_at=clock_timestamp() where id=$1 and status='paid' and block_hash=$2", [row.id, row.block_hash]);
  }
  return { checked: rows.length, incidents };
}
