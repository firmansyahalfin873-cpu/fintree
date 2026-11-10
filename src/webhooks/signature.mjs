import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET_PATTERN = /^whsec_[0-9a-f]{64}$/;
const HEADER_PATTERN = /^t=(0|[1-9][0-9]{0,15}),v1=([0-9a-f]{64})$/;

export function generateWebhookSecret() {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

function checkSecret(secret) {
  if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) throw new TypeError('Invalid webhook secret');
}

function checkTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid timestamp');
}

function digest(body, secret, timestamp) {
  return createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(body).digest();
}

/** Sign the exact bytes sent to the merchant, not a parsed JSON representation. */
export function signWebhook(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(body)) throw new TypeError('Webhook body must be a Buffer');
  checkSecret(secret);
  checkTimestamp(timestamp);
  return `t=${timestamp},v1=${digest(body, secret, timestamp).toString('hex')}`;
}

/** Returns false for malformed, stale, future, or incorrect signatures. */
export function verifyWebhook(body, header, secret, { now = Math.floor(Date.now() / 1000), toleranceSeconds = 300 } = {}) {
  if (!Buffer.isBuffer(body)) throw new TypeError('Webhook body must be a Buffer');
  checkSecret(secret);
  checkTimestamp(now);
  if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 0) throw new RangeError('Invalid tolerance');
  if (typeof header !== 'string' || header.length > 100) return false;
  const match = HEADER_PATTERN.exec(header);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) return false;
  const actual = Buffer.from(match[2], 'hex');
  return timingSafeEqual(actual, digest(body, secret, timestamp));
}
