import { verifyWebhook } from '../webhooks/signature.mjs';

export class FintreeApiError extends Error {
  constructor(status, code) { super(`Fintree request failed (${status})`); this.name = 'FintreeApiError'; this.status = status; this.code = code; }
}

/** Server-side SDK. Never embed an API key in browser or mobile code. */
export class FintreeClient {
  #apiKey;
  constructor({ apiKey, baseUrl, fetchImpl = fetch }) {
    if (typeof apiKey !== 'string' || !/^fintree_test_[0-9a-f]{64}$/.test(apiKey)) throw new TypeError('Invalid test API key');
    const url = new URL(baseUrl);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new TypeError('Invalid API base URL');
    if (typeof fetchImpl !== 'function') throw new TypeError('Invalid fetch implementation');
    this.baseUrl = url.origin;
    this.fetch = fetchImpl;
    this.#apiKey = apiKey;
  }

  async #request(path, options) {
    const response = await this.fetch(`${this.baseUrl}${path}`, { ...options, headers: { ...options.headers, authorization: `Bearer ${this.#apiKey}` }, redirect: 'error' });
    let body;
    try { body = await response.json(); } catch { throw new FintreeApiError(response.status, 'invalid_response'); }
    if (!response.ok) throw new FintreeApiError(response.status, typeof body?.error === 'string' ? body.error : 'unknown_error');
    return body;
  }

  async createCheckoutSession(params, { idempotencyKey } = {}) {
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new TypeError('A valid idempotency key is required');
    return this.#request('/api/v1/checkout/sessions', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify(params) });
  }

  async getCheckoutSession(id) {
    if (typeof id !== 'string' || !/^0x[0-9a-f]{64}$/i.test(id)) throw new TypeError('Invalid checkout session ID');
    return this.#request(`/api/v1/checkout/sessions/${id}`, { method: 'GET' });
  }

  async getWebhookSettings() { return this.#request('/api/v1/webhook', { method: 'GET' }); }

  async getMerchant() { return this.#request('/api/v1/merchant', { method: 'GET' }); }

  async listApiKeys({ startingAfter } = {}) {
    if (startingAfter !== undefined && (typeof startingAfter !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(startingAfter))) throw new TypeError('Invalid API key cursor');
    return this.#request(`/api/v1/api-keys${startingAfter ? `?starting_after=${encodeURIComponent(startingAfter)}` : ''}`, { method: 'GET' });
  }

  /** Returns the new raw key once; store it securely. */
  async createApiKey() { return this.#request('/api/v1/api-keys', { method: 'POST' }); }

  async revokeApiKey(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new TypeError('Invalid API key ID');
    return this.#request(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
  }

  async updateBusinessName(businessName) {
    if (typeof businessName !== 'string') throw new TypeError('Business name is required');
    return this.#request('/api/v1/merchant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName }) });
  }

  /** Creates a new secret every time; the secret is returned only in this response. */
  async configureWebhook(url) {
    if (typeof url !== 'string') throw new TypeError('Webhook URL is required');
    return this.#request('/api/v1/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  }

  async listWebhookAttempts() { return this.#request('/api/v1/webhook/attempts', { method: 'GET' }); }
  async retryWebhook(eventId) {
    if (typeof eventId !== 'string' || !/^evt_[a-z0-9_]{1,160}$/.test(eventId)) throw new TypeError('Invalid webhook event ID');
    return this.#request(`/api/v1/webhook/events/${eventId}/retry`, { method: 'POST' });
  }
}

export { verifyWebhook };
