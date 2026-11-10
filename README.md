# Fintree MVP — development workspace

Fintree is an experimental open-source payment gateway for merchants and developers. The intended flow is to create a checkout session, verify the on-chain payment, and notify the merchant. The software is not ready for real payments.

## Repository guide

The `contracts/` directory contains the experimental Solidity payment splitter; `src/` contains the API, scanner, webhook delivery, and SDK; `public/` contains the merchant workspace and checkout; and `db/`, `scripts/`, `test/`, and `docs/` contain the database drafts, local tooling, tests, and documentation. See [architecture](docs/architecture.md) for trust boundaries, [CONTRIBUTING](CONTRIBUTING.md) for contribution guidance, and [SECURITY](SECURITY.md) for private vulnerability reporting.

Cross-chain routing, broad token support, recurring subscriptions, AI metering, affiliate settlement, production hosting, and fiat settlement are not implemented as production features.

Fintree is an experimental, non-custodial payment gateway under development. This workspace contains an early local implementation; it is not ready to accept real payments. The project goals are in [PROJECT_GOALS.md](PROJECT_GOALS.md) and the initial specification is in [MVP_SPEC.md](MVP_SPEC.md).

## Run the local demonstration

With Node.js 22.13 or newer installed, open a terminal in this folder and run:

```sh
npm ci
npm run demo
```

The demonstration creates a temporary in-memory database, blockchain, token, and wallets. It verifies a wallet signature, creates a checkout session, simulates a token payment, verifies the payment, and checks a simulated webhook. Nothing is deployed and the temporary data disappears when the command exits. No real funds or merchant endpoint are used.

Run automated checks with `npm test`. The local blockchain simulator uses temporary test-only accounts and funds.

To try the browser preview, run `npm run preview` and open the local address printed in the terminal. The page creates and pays test invoices using temporary simulated wallets; it is not connected to a personal wallet. Keep the command running while using the preview and stop it with Ctrl+C. All preview data is erased when it stops.

## Current scope and remaining work

The code includes experimental smart contract logic, exact-value calculations, test API keys and wallet verification, checkout handlers, payment scanning and reconciliation, a webhook queue, and an experimental restricted HTTPS transport. A local browser preview demonstrates the merchant and buyer flow with simulated wallets and funds. It is not a deployable production dashboard or checkout. Persistent deployment, independently reviewed webhook transport, production monitoring, and public testnet verification remain incomplete. The test API handler only accepts configured local development chains and Base Sepolia.

The SQL in `db/schema-draft.sql` is a local draft, not an applied Supabase migration. Before deployment, database roles and migrations, secrets, rate limits, key management, network configuration, chain finality/reorg handling, webhook URL and DNS safety, dependency vulnerabilities, and an independent contract security review require completion. Do not use this prototype for real funds.

A separate local service with a wallet checkout and persistent database for a configured Base Sepolia deployment is under development. See [testnet service](docs/testnet-service.md); no public testnet deployment is included or verified yet.

## License

The project is intended to be released under the [MIT License](LICENSE), subject to [third-party notices](THIRD_PARTY_NOTICES.md). Names, logos, and trademarks may require separate permission.
