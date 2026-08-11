# AI ThemeStore Community

An open-source, offline, and recoverable macOS theme app for Codex Desktop.

> Unofficial and not affiliated with OpenAI. It does not modify the official
> `.app`, `app.asar`, binaries, or code signature.

## Included

- Native SwiftUI Mac app
- Local theme browsing, apply, verification, and restore actions
- Three redistributable original starter themes
- An open local `theme.json` format
- A loopback-only CDP theme engine
- Signature validation for the official Codex app and its bundled Node.js
- Transactional switching, live verification, rollback, and native safe mode

The Community edition has no account, telemetry, remote-device, cloud Registry,
online theme download, or automatic update code.

## Requirements

- macOS 13 or newer
- The official Codex Desktop app
- Xcode Command Line Tools when building from source

## Build

```bash
./scripts/build-app.sh
open "dist/AI ThemeStore Community.app"
```

The output uses a local ad-hoc signature. It does not re-sign or modify Codex.

## Test

```bash
./tests/run-tests.sh
```

See [the theme format guide](docs/theme-format.md) to create a local theme.

## Security

The local debugging port is sensitive while a theme is active. Do not run
untrusted local software at the same time. See [SECURITY.md](SECURITY.md).

## Full edition

The Community edition focuses on offline themes. The complete theme catalog is
available at [themestore.ai](https://themestore.ai).

## License

Source code and the three original bundled themes use the [MIT License](LICENSE).
See [NOTICE.md](NOTICE.md) for trademark and third-party exclusions.
