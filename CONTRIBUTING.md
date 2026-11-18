# Contributing

Thank you for improving the extension.

## Development rules

- Keep the extension read-only with respect to reservations. Do not add reservation submission, payment, captcha bypass, or order mutation code.
- Keep network access limited to the documented official Tsinghua domains.
- Do not add telemetry, remote JavaScript, arbitrary URL proxying, or `eval`.
- Do not use real accounts, passwords, TOTP secrets, tokens, Webhooks, or browser profiles in tests.
- Keep automatic login opt-in and document any change to credential handling.
- Prefer browser and Node standard APIs. Do not add a dependency for a small helper.

## Local checks

From the repository root run:

```bash
node --test tests/chrome_extension.test.mjs
node --check background.mjs
node --check content.js
node --check login-content.js
node --check popup.mjs
python3 -m unittest discover -s tests -p 'test_release_check.py'
python3 scripts/check_release.py
python3 scripts/package_extension.py
```

The public repository's CI runs the same checks without contacting the official website.

## Pull requests

Describe the user-visible behavior, permission changes, storage changes, and tests. Keep unrelated Python project changes out of this repository. Do not include generated ZIP files, screenshots, logs, or local browser state in a pull request.
