# Privacy Notice

This document describes the data handled by the open-source 羽毛球空场 Chrome extension. The extension does not use a project-owned server.

## Data handled

- Venue availability requests use the official Tsinghua sports website and include the current browser login token when the user is logged in.
- The extension stores query settings, cached availability results, run status, and the token received from the official website in the current Chrome profile's extension storage.
- Optional automatic login stores the account name, password, and TOTP secret in the current Chrome profile's extension local storage. Chrome local storage is not encrypted by this extension and is not synced by `chrome.storage.sync`.
- The extension generates the short-lived TOTP code locally. The TOTP secret is not sent to the official login page.

## Network destinations

The extension requests only:

- `https://www.sports.tsinghua.edu.cn/` for venue pages and read-only availability APIs.
- `https://id.tsinghua.edu.cn/` for the optional official identity-login flow, after the user grants the optional permission.

No request is sent to a project-maintained API, analytics service, advertising network, email provider, Bark endpoint, or Feishu endpoint.

## User control

- Automatic login is disabled by default.
- The user can disable automatic queries and clear stored credentials, login state, and cached results from the extension.
- The extension does not submit a reservation, lock a court, create an order, pay, or bypass a captcha.
- The final reservation decision remains on the official website.

## Data retention

Data remains in the current Chrome profile until the user clears it through the extension, removes the extension, or clears the profile's extension storage. Cached availability data is operational state and may become stale.

## Review the source

The extension is distributed under GPLv3. The source code, tests, and release checks are included in this repository so users can inspect the network scope and storage behavior.
