# Contributing to Fintree

Thank you for helping improve Fintree. The project is experimental and does not support real funds. Small, focused changes with a clear explanation are easiest to review.

## Before starting

- For a substantial feature or architectural change, open an issue describing the problem and proposed approach before investing significant effort.
- For a suspected vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Never commit wallet seeds, private keys, API tokens, merchant data, or real payment details. Use generated test-only values.
- Contributions must be your own work or compatible with the repository license and must retain required third-party notices.

## Local workflow

1. Install Node.js 22.13 or later and run `npm ci`.
2. Create a branch for your change.
3. Run `npm test`. For UI changes, also check the local preview at desktop and mobile widths where applicable.
4. Add or update meaningful tests and documentation when behavior changes.
5. Open a pull request describing the problem, the change, and the checks you ran.

Payment and security changes need particular care: preserve precise arithmetic, verify payment on the server, isolate merchants, and handle retries without repeating business actions. Tests and review do not replace an independent audit.

By submitting a contribution for inclusion, you agree it may be distributed under the repository's MIT license. Please identify third-party material and its license in your contribution.
