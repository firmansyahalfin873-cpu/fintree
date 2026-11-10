import { authenticateApiKey } from '../auth/api-keys.mjs';
import { readBody } from './checkout-handler.mjs';

export function createMerchantHandler({ db }) {
  const reply = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  return async (request) => {
    try {
      const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
      const identity = match ? await authenticateApiKey(db, match[1]) : null;
      if (!identity) return reply(401, { error: 'unauthorized' });
      if (request.method === 'GET') {
        const row = (await db.query('select wallet_address,business_name,updated_at from fintree_private.merchants where id=$1', [identity.merchantId])).rows[0];
        return row ? reply(200, { walletAddress: row.wallet_address, businessName: row.business_name, updatedAt: new Date(row.updated_at).toISOString() }) : reply(404, { error: 'not_found' });
      }
      if (request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply(415, { error: 'content_type' });
        let body;
        try { body = await readBody(request); } catch { return reply(400, { error: 'invalid_request' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((field) => field !== 'businessName') || typeof body.businessName !== 'string') return reply(400, { error: 'invalid_request' });
        const name = body.businessName.trim();
        if (!name || Array.from(name).length > 200 || /[\x00-\x1f\x7f]/.test(name)) return reply(400, { error: 'invalid_request' });
        const row = (await db.query('update fintree_private.merchants set business_name=$2,updated_at=now() where id=$1 returning wallet_address,business_name,updated_at', [identity.merchantId, name])).rows[0];
        return row ? reply(200, { walletAddress: row.wallet_address, businessName: row.business_name, updatedAt: new Date(row.updated_at).toISOString() }) : reply(404, { error: 'not_found' });
      }
      return reply(404, { error: 'not_found' });
    } catch { return reply(500, { error: 'internal_error' }); }
  };
}
