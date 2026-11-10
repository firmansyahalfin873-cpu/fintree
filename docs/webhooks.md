# Webhook protocol — development draft

After verified settlement, the outbox stores one stable event ID and a `checkout.session.completed` payload per invoice. Amounts in that payload are strings representing the smallest token units. Delivery is intended to be at least once: the receiver must store processed event IDs and make its business action idempotent. Verification alone does not prevent replay inside the timestamp window.

New events contain `schema_version: 1` and an ISO 8601 `created_at` timestamp fixed when the event is enqueued. The signature timestamp is separate and changes for each delivery attempt. Events already queued by older local builds can lack these fields; existing queued payloads are not silently rewritten.

If a previously paid block later changes, the service records an incident and queues one `checkout.session.payment_review_required` event. It includes the invoice ID, transaction hash, and original and observed block hashes; it does not assert that funds were lost. Merchant applications should pause automated fulfillment and investigate `reviewRequired` on the checkout session. Events may be delayed or delivered out of order, so do not infer current state from arrival order alone.

The server serializes the event once to UTF-8 bytes, signs those exact bytes, and sends those same bytes with `Content-Type: application/json` and `X-Fintree-Signature: t=<unix-seconds>,v1=<lowercase-hmac-sha256>`. The HMAC input is the UTF-8 timestamp, a literal period, then the raw request body bytes. Each attempt uses a fresh timestamp. Secrets have the format `whsec_` followed by 64 lowercase hexadecimal characters generated from 32 random bytes; protect them as credentials.

Node receiver example, assuming `rawBody` is the unmodified request body `Buffer` and the secret is securely loaded on the server:

```js
import { verifyWebhook } from '../src/webhooks/signature.mjs';

const valid = verifyWebhook(rawBody, request.headers['x-fintree-signature'], secret);
if (!valid) throw new Error('Invalid webhook');
const event = JSON.parse(rawBody.toString('utf8'));
// Atomically record event.id and apply business changes only once.
```

The default acceptance window is five minutes in either direction; the receiver needs a synchronized clock. Read and verify the raw bytes before JSON parsing, and do not log the secret. The testnet service can configure a destination and creates a fresh secret each time configuration is saved; the receiver must update its secret, including when a delivery is already in flight. The secret is displayed once and stored encrypted using a separate master key. Pending events created before configuration are eligible for delivery once an endpoint is configured.

A queue worker tracks attempts and retries. The experimental HTTPS transport restricts destinations to public IPv4, pins the resolved address, does not follow redirects and applies a timeout. The service and secret storage have been tested locally with mocked network calls; a real endpoint test and independent security review remain necessary. The SDK has not been published as a package.

When automatic attempts are exhausted, an authenticated merchant may queue its own failed event again from the dashboard or with `client.retryWebhook(eventId)`. Pending and already delivered events cannot be manually retried through this action. Attempt numbers and history remain intact; the retry begins a new bounded set of attempts using the currently configured endpoint and secret. A queued response does not mean the receiver has received it. Receivers must continue deduplicating event IDs.
