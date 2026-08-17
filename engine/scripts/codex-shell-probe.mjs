export function probeCodexShellDocument(documentRef, locationRef) {
  const canonicalShell = documentRef.title === "Codex" &&
    locationRef.protocol === "app:" &&
    locationRef.host === "-" &&
    locationRef.pathname === "/index.html";
  const markers = {
    shell: Boolean(documentRef.querySelector("main")),
    sidebar: Boolean(documentRef.querySelector("aside.app-shell-left-panel")),
    composer: Boolean(documentRef.querySelector(
      ".composer-surface-chrome, [data-codex-composer-root] [data-codex-composer=\"true\"]",
    )),
    main: Boolean(documentRef.querySelector('[role="main"]')),
  };
  const modernShell = markers.shell && markers.composer;
  const legacyShell = markers.shell && markers.sidebar && markers.main;
  return {
    title: documentRef.title,
    href: locationRef.href,
    markers,
    codex: canonicalShell && (modernShell || legacyShell),
  };
}

export const CODEX_SHELL_PROBE_EXPRESSION =
  `(${probeCodexShellDocument.toString()})(document, location)`;

export function resolveShellMainDocument(documentRef) {
  const appShellMain = documentRef.querySelector('main[data-app-shell-main-surface]');
  if (appShellMain) return appShellMain;
  const nativeShellMain = documentRef.querySelector(
    "main.main-surface:not(.ai-themestore-main-compat)",
  );
  if (nativeShellMain) return nativeShellMain;
  return [...documentRef.querySelectorAll("main")].find((candidate) =>
    !candidate.closest?.('[aria-hidden="true"], [inert], .invisible')) ?? null;
}

export const SHELL_MAIN_RESOLVER_EXPRESSION =
  `(${resolveShellMainDocument.toString()})(document)`;

export function shellMainCoveragePass({
  visible,
  homeRoute,
  backgroundAlpha,
  backgroundImage,
}) {
  if (!visible || backgroundAlpha == null) return false;
  return backgroundAlpha <= 0.035 &&
    (backgroundImage === "none" || backgroundImage === null);
}

export const SHELL_MAIN_COVERAGE_EXPRESSION =
  `(${shellMainCoveragePass.toString()})`;

export function compositedSurfaceAlpha(backdropAlpha, foregroundAlpha) {
  if (!Number.isFinite(backdropAlpha) || !Number.isFinite(foregroundAlpha)) return null;
  if (backdropAlpha < 0 || backdropAlpha > 1 || foregroundAlpha < 0 || foregroundAlpha > 1) {
    return null;
  }
  return backdropAlpha + foregroundAlpha * (1 - backdropAlpha);
}

export const COMPOSITED_SURFACE_ALPHA_EXPRESSION =
  `(${compositedSurfaceAlpha.toString()})`;

export function resolveToolPaneDocument(documentRef) {
  return documentRef.querySelector(
    'aside[data-app-shell-focus-area="right-panel"]',
  );
}

export const TOOL_PANE_RESOLVER_EXPRESSION =
  `(${resolveToolPaneDocument.toString()})(document)`;

export function resolveComposerSurfaceDocument(documentRef, scopeRef = documentRef) {
  const legacy = scopeRef.querySelector(".composer-surface-chrome");
  if (legacy) return legacy;
  const editor = scopeRef.querySelector('[data-codex-composer="true"]');
  const root = editor?.closest?.("[data-codex-composer-root]") ?? null;
  if (!root || !scopeRef.contains(root)) return null;
  const surface = editor.closest?.(
    '[data-composer-surface-variant][data-composer-radius-variant]',
  ) ?? null;
  return surface && root.contains(surface) ? surface : null;
}

export const COMPOSER_SURFACE_RESOLVER_EXPRESSION =
  `(${resolveComposerSurfaceDocument.toString()})(document)`;

export function composerNativeLayerCoveragePass(layers) {
  return layers.every((layer) =>
    layer.backgroundAlpha <= 0.035 &&
    (layer.backgroundImage === "none" || layer.backgroundImage === null) &&
    (layer.backdropFilter === "none" || layer.backdropFilter === null) &&
    (layer.boxShadow === "none" || layer.boxShadow === null));
}

export const COMPOSER_NATIVE_LAYER_COVERAGE_EXPRESSION =
  `(${composerNativeLayerCoveragePass.toString()})`;

export function homeTopFadeCoveragePass({ homeRoute, present, backgroundImage, backdropFilter, boxShadow }) {
  if (!homeRoute || !present) return true;
  return (backgroundImage === "none" || backgroundImage === null) &&
    (backdropFilter === "none" || backdropFilter === null) &&
    (boxShadow === "none" || boxShadow === null);
}

export const HOME_TOP_FADE_COVERAGE_EXPRESSION =
  `(${homeTopFadeCoveragePass.toString()})`;

export function workspaceSurfaceCoveragePass({
  homeRoute,
  present,
  backgroundAlpha,
  backdropFilter,
}) {
  if (!homeRoute) return true;
  return Boolean(
    present && backgroundAlpha != null &&
    backgroundAlpha >= 0.505 && backgroundAlpha <= 0.575 &&
    backdropFilter?.includes("blur(18px)"),
  );
}

export const WORKSPACE_SURFACE_COVERAGE_EXPRESSION =
  `(${workspaceSurfaceCoveragePass.toString()})`;

export function resolveChatPaneDocument(documentRef) {
  const marked = documentRef.querySelector("aside.ai-themestore-chat-pane");
  if (marked) return marked;
  return [...documentRef.querySelectorAll("aside")].find((candidate) =>
    !candidate.matches("aside.app-shell-left-panel") &&
    Boolean(candidate.querySelector(".thread-scroll-container")) &&
    Boolean(candidate.querySelector(
      ".composer-surface-chrome, [data-codex-composer-root] [data-codex-composer=\"true\"]",
    ))) ?? null;
}

export const CHAT_PANE_RESOLVER_EXPRESSION =
  `(${resolveChatPaneDocument.toString()})(document)`;

export function optionalSidebarVisibilityPass(sidebarPresent, sidebarVisible) {
  return !sidebarPresent || Boolean(sidebarVisible);
}

export function chatPaneDividerParityPass({
  chatPanePresent,
  sidebarPresent,
  paneLeftWidth,
  paneLeftStyle,
  paneLeftColor,
  sidebarRightWidth,
  sidebarRightStyle,
  sidebarRightColor,
  nativeDividerLeftWidth,
}) {
  if (!chatPanePresent) return true;
  const designedDividerPass = paneLeftWidth === "1px" &&
    paneLeftStyle === "solid" && nativeDividerLeftWidth === "0px";
  if (!sidebarPresent) return designedDividerPass;
  return designedDividerPass &&
    paneLeftWidth === sidebarRightWidth &&
    paneLeftStyle === sidebarRightStyle &&
    paneLeftColor === sidebarRightColor;
}

export const OPTIONAL_SIDEBAR_VISIBILITY_EXPRESSION =
  `(${optionalSidebarVisibilityPass.toString()})`;
export const CHAT_PANE_DIVIDER_PARITY_EXPRESSION =
  `(${chatPaneDividerParityPass.toString()})`;
