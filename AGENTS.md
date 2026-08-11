# Repository Guidelines

## Scope

This repository contains the offline macOS App, its loopback-only
theme engine, three original starter themes, and tests. Do not add production
backend, deployment, Firebase, analytics, remote-device, account, or update
infrastructure.

## Development

- Use two-space indentation in shell, JavaScript, JSON, CSS, and Swift.
- Shell entry points use `set -euo pipefail`; Node files use ESM.
- Run `./tests/run-tests.sh` before opening a pull request.
- Keep CDP loopback-only and preserve strict app/runtime signature checks.
- Theme changes must work on New Chat and active task routes.

## Safety

- Never modify the official Codex app, `app.asar`, its signature, API keys, or
  Base URLs.
- Never commit credentials, production configuration, customer data, or
  third-party artwork without redistribution rights.
- Configuration writes must remain strict UTF-8, atomic, backed up, and
  recoverable.
