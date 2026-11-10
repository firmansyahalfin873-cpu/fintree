import { signWebhook } from './signature.mjs';

/** Return the exact body and headers that an eventual delivery worker must send. */
export function prepareWebhookDelivery(event, secret, timestamp) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.id !== 'string' || typeof event.type !== 'string') {
    throw new TypeError('Invalid webhook event');
  }
  const body = Buffer.from(JSON.stringify(event), 'utf8');
  return { body, headers: { 'content-type': 'application/json', 'x-fintree-signature': signWebhook(body, secret, timestamp) } };
}
