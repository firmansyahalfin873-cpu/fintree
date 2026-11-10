import { createWalletChallenge, completeWalletChallenge } from '../auth/wallet-onboarding.mjs';
import { readBody } from './checkout-handler.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** origin must be trusted server configuration, never a request header. */
export function createOnboardingHandler({ db, origin }) {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/api/v1/wallet/challenge', '/api/v1/wallet/complete'].includes(pathname)) return json(404, { error: 'not_found' });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json(415, { error: 'content_type' });
    try {
      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid_request' });
      if (pathname.endsWith('/challenge')) {
        if (Object.keys(body).some((key) => key !== 'wallet') || typeof body.wallet !== 'string') return json(400, { error: 'invalid_request' });
        return json(201, await createWalletChallenge(db, body.wallet, origin));
      }
      if (Object.keys(body).some((key) => !['id', 'nonce', 'signature'].includes(key))) return json(400, { error: 'invalid_request' });
      const issued = await completeWalletChallenge(db, { ...body, origin });
      return issued ? json(201, issued) : json(401, { error: 'invalid_challenge' });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) return json(400, { error: 'invalid_request' });
      return json(500, { error: 'internal_error' });
    }
  };
}
