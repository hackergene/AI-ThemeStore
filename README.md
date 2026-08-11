<p align="right">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

# AI ThemeStore Community

An open-source, offline theme app for **Codex Desktop on macOS**. It gives the
Codex workspace a visual identity while keeping the official app intact and
making every change reversible.

[![macOS 13+](https://img.shields.io/badge/macOS-13%2B-111827?logo=apple)](https://github.com/hackergene/AI-ThemeStore-Community/releases/latest)
[![SwiftUI App](https://img.shields.io/badge/app-SwiftUI-F05138?logo=swift&logoColor=white)](#technology-stack)
[![JavaScript Engine](https://img.shields.io/badge/engine-JavaScript-F7DF1E?logo=javascript&logoColor=111827)](#technology-stack)
[![MIT License](https://img.shields.io/badge/license-MIT-25D9FF.svg)](./LICENSE)
[![Offline](https://img.shields.io/badge/runtime-offline-8A6CFF.svg)](#privacy-and-safety)

> AI ThemeStore Community is an independent, unofficial project. It is not
> affiliated with, endorsed by, or sponsored by OpenAI.

## Codex, themed

This sanitized, high-fidelity showcase brings together four visual worlds from
the wider ThemeStore catalog: **Fortune Code Workshop**, **Azure Lotus Dharma**,
**Ember Ninja Legacy**, and **Silver Nocturne Rose**. It demonstrates both New
Chat and active task surfaces without using real account, project, or
conversation data.

![Fortune Code Workshop, Azure Lotus Dharma, Ember Ninja Legacy, and Silver Nocturne Rose themes for Codex](./docs/images/codex-theme-showcase.png)

The ninja panel uses the original, non-franchise `Ember Ninja Legacy` artwork.
No third-party character fan art is included in this repository.

## What this project provides

- A native SwiftUI app for browsing, applying, verifying, and restoring themes
- Three bundled redistributable themes: Minimal Glass, Cyber Neon, and Pink Future City
- An open, local `theme.json` format for creating your own Codex themes
- A loopback-only theme runtime with transactional switching and rollback
- Signature checks for the official Codex app and its bundled Node.js runtime
- No accounts, analytics, cloud registry, remote devices, or automatic updates

## Technology stack

AI ThemeStore Community is a hybrid native macOS app: **Swift and SwiftUI**
provide the application interface, while a local **JavaScript and CSS theme
engine** handles Codex theming, verification, and recovery.

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Native app | Swift, SwiftUI | Theme library, controls, status, and user-facing recovery |
| Theme engine | JavaScript (ESM), CSS | Apply themes and verify New Chat and active task surfaces |
| Lifecycle tools | POSIX shell | Start, pause, restore, diagnose, and build the app |
| Build system | Swift Package Manager | Compile and package the native macOS application |

GitHub's language label is based on source-code byte count, so it may show
JavaScript even though the user-facing application is native SwiftUI.

## What we learned from theming Codex

Codex is a living product, so a durable theme cannot be just a wallpaper or a
collection of fragile selectors. The Community engine is built around a few
practical lessons:

1. **Theme the complete workflow.** New Chat and active tasks must share the
   same visual language, including cards, editors, sidebars, and layered panels.
2. **Adapt to the visible surface.** Modern app shells may contain hidden or
   transitional layers. The runtime targets the visible main surface instead
   of assuming the first matching element is the one users see.
3. **Preserve interaction and readability.** Glass, opacity, blur, text
   contrast, focus states, and responsive layouts are treated as one system.
4. **Verify after applying.** A theme switch is only complete after the runtime
   confirms the expected New Chat and task surfaces; otherwise it rolls back.
5. **Keep customization reversible.** The engine does not patch Codex binaries,
   `app.asar`, application signatures, API keys, or service URLs.

These constraints make themes feel integrated with Codex while keeping the
customization boundary understandable and recoverable.

## Get started

### Download

Download the latest build from [GitHub Releases](https://github.com/hackergene/AI-ThemeStore-Community/releases/latest).

### Build from source

Requirements: macOS 13 or newer, the official Codex Desktop app, and Xcode
Command Line Tools.

```bash
git clone https://github.com/hackergene/AI-ThemeStore-Community.git
cd AI-ThemeStore-Community
./scripts/build-app.sh
open "dist/AI ThemeStore Community.app"
```

The build script creates the Community app locally. It does not modify or
re-sign the official Codex app.

### Use the app

1. Open AI ThemeStore Community.
2. Select a local theme and choose **Apply Theme**.
3. The app restarts Codex and verifies the themed New Chat and task surfaces.
4. Choose **Restore Codex Appearance** whenever you want the native look back.

Custom themes live in:

```text
~/Library/Application Support/AIThemeStore/themes
```

Each theme is a folder containing a `theme.json` file and its referenced local
assets. See the [theme format guide](./docs/theme-format.md) for the schema and
a minimal example.

## Test

```bash
./tests/run-tests.sh
```

## Privacy and safety

The Community edition works offline and contains no telemetry or account code.
Its debugging connection is bound to `127.0.0.1` only. Because a local debugging
port is sensitive while a theme is active, avoid running untrusted local
software at the same time. Read the full boundary in [SECURITY.md](./SECURITY.md).

## Community and full edition

This repository is intentionally focused on a small, auditable, offline Codex
theme experience. The broader theme catalog and hosted browsing experience are
available at [themestore.ai](https://themestore.ai).

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
before opening an issue or pull request.

## License

The source code and the three original bundled themes are licensed under the
[MIT License](./LICENSE). OpenAI and Codex names, official application UI, and
other third-party marks are excluded; see [NOTICE.md](./NOTICE.md).
