# Architecture and trust boundaries

Fintree is an experimental payment gateway. This document describes the code in this repository, not a production deployment.

## Payment path

The merchant signs a wallet challenge and receives a test API key. An authenticated request creates a checkout session with an order reference, token amount, fee payer, and optional return URL. The service signs a time-limited quote for the configured token, merchant, amount, and fee. The customer opens the checkout and submits a wallet transaction to the configured splitter. The scanner validates the expected contract event and waits for the configured confirmation policy before marking an invoice paid. If enabled, a worker delivers signed webhook events to the merchant.

## Boundaries that matter

- **Customer wallet:** approval and payment are separate wallet actions where required. A submitted transaction is not a verified payment.
- **Merchant wallet:** the merchant controls the receiving wallet; the application must verify ownership for account access. Fintree never needs the merchant's seed phrase.
- **Quote signer:** the signer authorizes payment terms and is a critical service secret. Its compromise could undermine those terms. In the current contract the signer is immutable; replacing a compromised signer requires a new deployment and migration plan.
- **Smart contract:** `FintreeSplitter` supports one configured standard ERC-20 token. It checks signed quotes and tracks paid invoices. It is unaudited; no claim of safety follows from direct transfers or an expected zero balance.
- **Chain data:** the scanner depends on an RPC provider and a confirmation policy. Reorganizations, stale data, and RPC failures require operational handling.
- **Webhooks:** authenticity depends on checking the signature against the original request body. Receivers must handle repeated and out-of-order events safely. The current restricted HTTPS transport has not had an independent security review.
- **Hosting:** the local PGlite schema and migrations are not Supabase migrations. The testnet service listens on loopback and lacks production operations and access controls.

## Not yet supported

Production deployment, public end-to-end Base Sepolia verification, cross-chain routes, generalized token acceptance, subscription billing, affiliate settlement, vault deposits, and audited security are not complete. Do not use the software with real assets.
