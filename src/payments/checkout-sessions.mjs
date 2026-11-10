import { createHash } from 'node:crypto';
import { parseAmount } from '../domain/money.mjs';
import { createQuote } from './create-quote.mjs';

export class IdempotencyConflict extends Error {
  constructor() { super('Idempotency key was already used for a different request'); this.name = 'IdempotencyConflict'; }
}

function publicSession(row) {
  if (!row) return null;
  return {
    id: row.id, status: row.status, reviewRequired: Boolean(row.review_required), orderId: row.external_order_id,
    chainId: String(row.chain_id), contract: row.contract_address, token: row.token_address,
    merchant: row.merchant_address, invoiceAmount: String(row.invoice_amount),
    merchantAmount: String(row.merchant_amount), protocolFee: String(row.protocol_fee),
    totalPayable: String(row.total_payable), feePayer: row.fee_payer, feeBps: row.fee_bps,
    deadline: Math.floor(new Date(row.deadline).getTime() / 1000), signature: row.quote_signature,
    returnUrl: row.return_url ?? null, metadata: row.metadata ?? null,
  };
}

/** merchantId is obtained from server-side authentication, never from the request body. */
export async function createCheckoutSession({ db, signer, config, merchantId, idempotencyKey, request }) {
  if (typeof merchantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(merchantId)) throw new TypeError('Invalid merchant identity');
  if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new TypeError('Invalid idempotency key');
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some((key) => !['amount', 'orderId', 'feePayer', 'returnUrl', 'metadata'].includes(key)) ||
      typeof request.orderId !== 'string' || request.orderId.length < 1 || request.orderId.length > 200 || /[\x00-\x1f\x7f]/.test(request.orderId) ||
      typeof request.amount !== 'string' || request.amount.length > 80 || !['customer', 'merchant'].includes(request.feePayer)) throw new TypeError('Invalid checkout request');
  const atomicAmount = parseAmount(request.amount, config.tokenDecimals);
  if (atomicAmount <= 0n) throw new RangeError('Amount must be positive');
  let returnUrl = null, metadata = null;
  if (request.returnUrl != null) {
    if (typeof request.returnUrl !== 'string' || request.returnUrl.length > 2048) throw new TypeError('Invalid return URL');
    let url; try { url = new URL(request.returnUrl); } catch { throw new TypeError('Invalid return URL'); }
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password) throw new TypeError('Invalid return URL');
    returnUrl = url.href;
  }
  if (request.metadata != null) {
    if (typeof request.metadata !== 'object' || Array.isArray(request.metadata)) throw new TypeError('Invalid metadata');
    const entries = Object.entries(request.metadata).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (entries.length > 20 || entries.some(([key, value]) => !/^[a-zA-Z0-9_.-]{1,40}$/.test(key) || typeof value !== 'string' || value.length > 500 || /[\x00-\x1f\x7f]/.test(value))) throw new TypeError('Invalid metadata');
    metadata = Object.fromEntries(entries);
    if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 4096) throw new RangeError('Metadata too large');
  }
  const hashParts = [request.orderId, atomicAmount.toString(), request.feePayer];
  if (returnUrl !== null || metadata !== null) hashParts.push(returnUrl, metadata);
  const requestHash = createHash('sha256').update(JSON.stringify(hashParts)).digest('hex');
  const find = () => db.query('select i.*,exists(select 1 from fintree_private.payment_incidents p where p.invoice_id=i.id) as review_required from fintree_private.invoices i where i.merchant_id = $1 and i.idempotency_key = $2', [merchantId, idempotencyKey]);
  const existing = (await find()).rows[0];
  if (existing) {
    if (existing.request_hash !== requestHash) throw new IdempotencyConflict();
    return { session: publicSession(existing), created: false };
  }
  const merchant = (await db.query('select wallet_address from fintree_private.merchants where id = $1', [merchantId])).rows[0];
  if (!merchant) throw new Error('Merchant not found');
  const issued = await createQuote({ signer, config, merchant: merchant.wallet_address, amount: request.amount, feePayer: request.feePayer });
  const { quote, amounts } = issued;
  const insert = await db.query(`insert into fintree_private.invoices
    (id, merchant_id, idempotency_key, request_hash, external_order_id, chain_id, contract_address, token_address,
     merchant_address, invoice_amount, merchant_amount, protocol_fee, total_payable, fee_bps, fee_payer, quote_signature, deadline, return_url, metadata)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,to_timestamp($17::double precision),$18,$19::jsonb)
    on conflict (merchant_id, idempotency_key) do nothing returning *`,
  [quote.invoiceId.toLowerCase(), merchantId, idempotencyKey, requestHash, request.orderId, issued.chainId.toString(), issued.contract.toLowerCase(), quote.token.toLowerCase(),
    quote.merchant.toLowerCase(), amounts.invoiceAmount.toString(), quote.merchantAmount.toString(), quote.protocolFee.toString(), amounts.totalPayable.toString(),
    issued.feeBps, issued.feePayer, issued.signature.toLowerCase(), quote.deadline.toString(), returnUrl, metadata === null ? null : JSON.stringify(metadata)]);
  const row = insert.rows[0] ?? (await find()).rows[0];
  if (!row) throw new Error('Unable to retrieve checkout session');
  if (row.request_hash !== requestHash) throw new IdempotencyConflict();
  return { session: publicSession(row), created: insert.rows.length === 1 };
}

export async function getMerchantCheckoutSession(db, merchantId, sessionId) {
  const result = await db.query('select i.*,exists(select 1 from fintree_private.payment_incidents p where p.invoice_id=i.id) as review_required from fintree_private.invoices i where i.merchant_id = $1 and i.id = $2', [merchantId, sessionId.toLowerCase()]);
  return publicSession(result.rows[0]);
}

export async function listMerchantCheckoutSessions(db, merchantId, cursor = null) {
  if (cursor !== null && (typeof cursor !== 'string' || !/^0x[0-9a-f]{64}$/i.test(cursor))) throw new TypeError('Invalid pagination cursor');
  const result = await db.query(`select i.*,exists(select 1 from fintree_private.payment_incidents p where p.invoice_id=i.id) as review_required
    from fintree_private.invoices i where i.merchant_id=$1
    and ($2::text is null or (i.created_at, i.id) < (select a.created_at, a.id from fintree_private.invoices a where a.merchant_id=$1 and a.id=$2))
    order by i.created_at desc,i.id desc limit 51`, [merchantId, cursor?.toLowerCase() ?? null]);
  const hasMore = result.rows.length > 50, rows = result.rows.slice(0, 50);
  return { data: rows.map(publicSession), nextCursor: hasMore ? rows.at(-1).id : null };
}
