# Security Policy

## Scope

This policy covers the Chrome extension in this repository. The parent project may contain private automation code and is outside the public extension release boundary.

## Do not report secrets publicly

Do not include passwords, TOTP secrets, login tokens, browser profile files, screenshots containing account data, or private URLs in a public issue or pull request.

For a suspected credential leak, revoke or rotate the credential first, then report the affected file and commit privately to the repository maintainer.

## Supported versions

Only the latest released extension version and the default branch receive security fixes.

## Reporting

Open a private security report through the hosting provider when available. If private reporting is unavailable, open an issue containing only a short description such as `security report requested`; do not include exploit details or credentials.

Useful reports include:

- unexpected network destinations;
- credential or token exposure;
- an extension permission broader than the documented scope;
- automatic actions that submit a reservation, order, or payment;
- a release package containing files outside the allowlist.

## Security limits

Automatic login is an opt-in convenience feature. Its password and TOTP values are stored in Chrome local extension storage without encryption provided by this project. Use a trusted operating-system account and a trusted Chrome profile, and disable automatic login when it is not needed.
