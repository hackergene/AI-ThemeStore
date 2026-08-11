# Security policy

## Supported version

Security fixes are provided for the latest release.

## Runtime boundary

AI ThemeStore does not modify the official Codex application. It
launches Codex with a Chromium DevTools endpoint bound to `127.0.0.1`, validates
the official app and bundled Node.js signatures, and injects only into verified
Codex renderer targets.

The local debugging port is security-sensitive while a themed session is
running. Do not run untrusted local software at the same time. Use **Restore
official appearance** to stop the themed runtime and return to Codex defaults.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not include credentials, private conversations, or customer data in an issue.
