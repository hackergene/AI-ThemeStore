# Changelog

## 0.1.3 — 2026-08-17

- Removed the global tiled dot overlay that had become unusually prominent on
  newer Codex task views, leaving theme artwork clean and uninterrupted.
- Removed both the 153px normal-task footer gradient and the 42px progress-state
  gradient that could leave a dark edge above the composer.
- Expanded regression and live verification gates to cover every
  `from-surface` footer variant and reject any restored global dot overlay.

## 0.1.2 — 2026-08-17

- Added Codex 26.810 compatibility for its renamed Home fade, project utility,
  and task composer footer surfaces.
- Matched Home and task brightness by removing the task-wide dimming layer and
  keeping both composers on one 54% / 18px glass surface.
- Removed the hidden 153px sticky footer compositing layer that could render as
  a large black rectangle above the task composer.
- Strengthened live verification for effective surface opacity, nested native
  blur and shadow layers, Home toolbar styling, and zero-sized footer gradients.

## 0.1.1 — 2026-08-16

- Restored themed composer glass on Codex 26.803 by clearing its new opaque
  semantic layout layer while preserving native controls.
- Removed the new Home top spacer that could appear as a dark horizontal band
  above the themed hero.
- Added live verification gates for native composer backgrounds and modern Home
  top alignment on both New Chat and active task routes.

## 0.1.0 — 2026-08-11

- Added a native, offline macOS App for applying and restoring Codex
  themes.
- Included three original starter themes and an open local theme format.
- Added loopback-only injection, signature validation, transactional theme
  switching, live verification, rollback, and native safe mode.
- Removed cloud accounts, analytics, remote devices, online catalog access,
  automatic updates, and production deployment dependencies.
