# Security policy

Fintree is experimental, has not undergone an independent audit, and must not be used for real funds. The current local testnet service is not designed to be exposed publicly.

## Reporting a vulnerability

Do not open a public issue for an unpatched security vulnerability. Use the repository's **Security → Report a vulnerability** feature if private reporting is enabled. If it is unavailable, open an issue asking a maintainer for a private reporting channel; do not include exploit details, credentials, or sensitive data in that request.

Include the affected version or commit, the component, steps to reproduce using test-only data, and the likely impact. Do not test against third-party systems or send real funds. Maintainers should acknowledge reports, coordinate remediation, and publish details only after a fix and an appropriate disclosure window have been agreed. Response times are not guaranteed at this stage.

## Scope and limitations

The local contract, API, checkout, wallet authentication, payment scanner, and webhook delivery logic are relevant to security reports. The simulated preview and testnet service are development environments, not production deployments. An automated test pass is not an audit or certification.
