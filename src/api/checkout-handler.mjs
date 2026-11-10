import { authenticateApiKey } from '../auth/api-keys.mjs';
import { createCheckoutSession, getMerchantCheckoutSession, listMerchantCheckoutSessions, IdempotencyConflict } from '../payments/checkout-sessions.mjs';

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function readBody(request, maxBytes = 8192) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new RangeError('Body too large');
  if (!request.body) throw new TypeError('Missing body');
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RangeError('Body too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
}

/** Server adapter for Web Request/Response; dependencies are injected and server-only. */
export function createCheckoutHandler({ db, signer, config, checkoutOrigin }) {
  // Test credentials must never authorize a mainnet endpoint.
  if (![1337n, 31337n, 84532n].includes(config?.chainId)) throw new RangeError('Only configured development and Base Sepolia networks are supported');
  const origin = new URL(checkoutOrigin);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.origin !== checkoutOrigin || origin.username || origin.password) throw new TypeError('Invalid checkout origin');
  const withUrl = (session) => ({ ...session, checkoutUrl: `${checkoutOrigin}/pay/${session.id}` });
  return async (request) => {
    try {
      const authorization = request.headers.get('authorization') ?? '';
      const match = /^Bearer (\S+)$/.exec(authorization);
      const identity = match ? await authenticateApiKey(db, match[1]) : null;
      if (!identity) return json(401, { error: 'unauthorized' });
      const url = new URL(request.url);
      const base = '/api/v1/checkout/sessions';
      if (url.pathname === base && request.method === 'GET') {
        const sessions = await listMerchantCheckoutSessions(db, identity.merchantId, url.searchParams.get('starting_after'));
        return json(200, { data: sessions.data.map(withUrl), nextCursor: sessions.nextCursor });
      }
      if (url.pathname === base && request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json(415, { error: 'content_type' });
        let body;
        try { body = await readBody(request); } catch (error) { return json(error instanceof RangeError ? 413 : 400, { error: 'invalid_body' }); }
        const result = await createCheckoutSession({ db, signer, config, merchantId: identity.merchantId, idempotencyKey: request.headers.get('idempotency-key'), request: body });
        return json(result.created ? 201 : 200, withUrl(result.session));
      }
      const matchId = /^\/api\/v1\/checkout\/sessions\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
      if (matchId && request.method === 'GET') {
        const session = await getMerchantCheckoutSession(db, identity.merchantId, matchId[1]);
        return session ? json(200, withUrl(session)) : json(404, { error: 'not_found' });
      }
      return json(404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof IdempotencyConflict) return json(409, { error: 'idempotency_conflict' });
      if (error instanceof TypeError || error instanceof RangeError) return json(400, { error: 'invalid_request' });
      return json(500, { error: 'internal_error' });
    }
  };
}
