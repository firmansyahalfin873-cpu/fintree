import { authenticateApiKey } from '../auth/api-keys.mjs';
import { readBody } from './checkout-handler.mjs';

export function createWebhookSettingsHandler({ db, settings }) {
  const reply = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  return async (request) => {
    try {
      const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
      const identity = match ? await authenticateApiKey(db, match[1]) : null;
      if (!identity) return reply(401, { error: 'unauthorized' });
      if (!settings) return reply(503, { error: 'webhook_unavailable' });
      const pathname = new URL(request.url).pathname;
      const retry = /^\/api\/v1\/webhook\/events\/(evt_[a-z0-9_]{1,160})\/retry$/.exec(pathname);
      if (retry) return request.method === 'POST' && await settings.retryFailed(identity.merchantId, retry[1]) ? reply(200, { queued: true }) : reply(404, { error: 'not_found' });
      if (pathname === '/api/v1/webhook/attempts') {
        return request.method === 'GET' ? reply(200, { data: await settings.listAttempts(identity.merchantId) }) : reply(404, { error: 'not_found' });
      }
      if (pathname !== '/api/v1/webhook') return reply(404, { error: 'not_found' });
      if (request.method === 'GET') {
        const config = await settings.getPublic(identity.merchantId);
        return reply(200, config ? { configured: true, ...config } : { configured: false });
      }
      if (request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply(415, { error: 'content_type' });
        let body;
        try { body = await readBody(request); } catch { return reply(400, { error: 'invalid_request' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((field) => field !== 'url') || typeof body.url !== 'string') return reply(400, { error: 'invalid_request' });
        const config = await settings.configure(identity.merchantId, body.url);
        return reply(200, config);
      }
      return reply(404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) return reply(400, { error: 'invalid_request' });
      return reply(500, { error: 'internal_error' });
    }
  };
}
