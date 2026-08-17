import assert from "node:assert/strict";
import {
  chatPaneDividerParityPass,
  compositedSurfaceAlpha,
  composerNativeLayerCoveragePass,
  homeTopFadeCoveragePass,
  optionalSidebarVisibilityPass,
  probeCodexShellDocument,
  resolveChatPaneDocument,
  resolveComposerSurfaceDocument,
  resolveShellMainDocument,
  resolveToolPaneDocument,
  shellMainCoveragePass,
  workspaceSurfaceCoveragePass,
} from "../engine/scripts/codex-shell-probe.mjs";

assert.equal(compositedSurfaceAlpha(0, 0.54), 0.54,
  "Home composer effective alpha must equal its only glass layer");
assert.ok(Math.abs(compositedSurfaceAlpha(0.3, 0.34) - 0.538) < 1e-9,
  "surface alpha composition must remain mathematically explicit");
assert.ok(Math.abs(compositedSurfaceAlpha(0.5, 0.54) - 0.77) < 1e-9,
  "the former stacked task surfaces must expose their 77% effective darkness");
assert.equal(compositedSurfaceAlpha(-0.1, 0.5), null,
  "invalid surface alpha must be rejected");

const canonicalLocation = Object.freeze({
  protocol: "app:",
  host: "-",
  pathname: "/index.html",
  href: "app://-/index.html",
});

function fakeDocument(markers, title = "Codex") {
  const selectors = new Map([
    ["main", markers.shell],
    ["aside.app-shell-left-panel", markers.sidebar],
    [".composer-surface-chrome", markers.composer],
    [
      '.composer-surface-chrome, [data-codex-composer-root] [data-codex-composer="true"]',
      markers.composer || markers.semanticComposer,
    ],
    ['[role="main"]', markers.main],
  ]);
  return {
    title,
    querySelector(selector) {
      return selectors.get(selector) ? { selector } : null;
    },
  };
}

const expandedModern = probeCodexShellDocument(fakeDocument({
  shell: true,
  sidebar: true,
  composer: true,
  main: false,
}), canonicalLocation);
assert.equal(expandedModern.codex, true, "expanded modern Codex shell must pass");

const collapsedModern = probeCodexShellDocument(fakeDocument({
  shell: true,
  sidebar: false,
  composer: true,
  main: false,
}), canonicalLocation);
assert.equal(collapsedModern.codex, true, "collapsed modern Codex shell must pass");

const semanticComposerModern = probeCodexShellDocument(fakeDocument({
  shell: true,
  sidebar: true,
  composer: false,
  semanticComposer: true,
  main: false,
}), canonicalLocation);
assert.equal(semanticComposerModern.codex, true,
  "Codex 26.730 semantic composer shell must pass without the removed legacy class");

const expandedLegacy = probeCodexShellDocument(fakeDocument({
  shell: true,
  sidebar: true,
  composer: false,
  main: true,
}), canonicalLocation);
assert.equal(expandedLegacy.codex, true, "expanded legacy Codex shell must pass");

const avatarOverlay = probeCodexShellDocument(fakeDocument({
  shell: true,
  sidebar: false,
  composer: false,
  main: false,
}), {
  ...canonicalLocation,
  href: "app://-/index.html?initialRoute=%2Favatar-overlay",
});
assert.equal(avatarOverlay.codex, false, "avatar overlay must remain rejected");

const genericAppPage = probeCodexShellDocument(fakeDocument({
  shell: true,
  sidebar: false,
  composer: false,
  main: true,
}), canonicalLocation);
assert.equal(genericAppPage.codex, false, "generic app main page must remain rejected");

const wrongOrigin = probeCodexShellDocument(fakeDocument({
  shell: true,
  sidebar: true,
  composer: true,
  main: true,
}), {
  protocol: "https:",
  host: "example.com",
  pathname: "/index.html",
  href: "https://example.com/index.html",
});
assert.equal(wrongOrigin.codex, false, "non-app origin must remain rejected");

assert.equal(optionalSidebarVisibilityPass(false, false), true,
  "collapsed sidebar must not fail runtime verification");
assert.equal(optionalSidebarVisibilityPass(true, true), true,
  "visible sidebar must pass runtime verification");
assert.equal(optionalSidebarVisibilityPass(true, false), false,
  "present but hidden sidebar must fail runtime verification");

const invisibleOverlayMain = {
  closest(selector) {
    return selector.includes(".invisible") ? {} : null;
  },
};
const visibleFallbackMain = { closest: () => null };
const semanticShellMain = {};
assert.equal(resolveShellMainDocument({
  querySelector(selector) {
    return selector === 'main[data-app-shell-main-surface]' ? semanticShellMain : null;
  },
  querySelectorAll: () => [invisibleOverlayMain, visibleFallbackMain],
}), semanticShellMain, "Codex 26.803 semantic main surface must take priority");
assert.equal(resolveShellMainDocument({
  querySelector: () => null,
  querySelectorAll: () => [invisibleOverlayMain, visibleFallbackMain],
}), visibleFallbackMain, "an invisible overlay main must not become the themed shell");

assert.equal(shellMainCoveragePass({
  visible: true,
  homeRoute: true,
  backgroundAlpha: 0,
  backgroundImage: "none",
}), true, "Home must keep the wallpaper continuous through a transparent main surface");
assert.equal(shellMainCoveragePass({
  visible: true,
  homeRoute: true,
  backgroundAlpha: 0.3,
  backgroundImage: "none",
}), false, "Home must reject the dark main-surface band below the native header");
assert.equal(shellMainCoveragePass({
  visible: true,
  homeRoute: true,
  backgroundAlpha: 0,
  backgroundImage: "linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0))",
}), false, "Home must reject a native main-surface background image");
assert.equal(shellMainCoveragePass({
  visible: true,
  homeRoute: false,
  backgroundAlpha: 0,
  backgroundImage: "none",
}), true, "task routes must expose the same un-dimmed artwork as Home");
assert.equal(shellMainCoveragePass({
  visible: true,
  homeRoute: false,
  backgroundAlpha: 0.3,
  backgroundImage: "none",
}), false, "task routes must reject a full-workspace dimming layer");

const rightToolPane = {};
assert.equal(resolveToolPaneDocument({
  querySelector(selector) {
    return selector === 'aside[data-app-shell-focus-area="right-panel"]'
      ? rightToolPane
      : null;
  },
}), rightToolPane, "Codex 26.803 right tool panel must resolve semantically");

function fakePane({ sidebar = false, thread = false, composer = false }) {
  return {
    matches(selector) {
      return selector === "aside.app-shell-left-panel" && sidebar;
    },
    querySelector(selector) {
      if (selector === ".thread-scroll-container") return thread ? {} : null;
      if (selector === ".composer-surface-chrome") return composer ? {} : null;
      if (selector === '.composer-surface-chrome, [data-codex-composer-root] [data-codex-composer="true"]') {
        return composer ? {} : null;
      }
      return null;
    },
  };
}

const markedChatPane = fakePane({ thread: true, composer: true });
assert.equal(resolveChatPaneDocument({
  querySelector: () => markedChatPane,
  querySelectorAll: () => [],
}), markedChatPane, "the renderer marker must remain the preferred Ask pane identity");

const leftSidebar = fakePane({ sidebar: true });
const structuralChatPane = fakePane({ thread: true, composer: true });
assert.equal(resolveChatPaneDocument({
  querySelector: () => null,
  querySelectorAll: () => [leftSidebar, structuralChatPane],
}), structuralChatPane, "live verification must find Ask before its renderer marker settles");

assert.equal(resolveChatPaneDocument({
  querySelector: () => null,
  querySelectorAll: () => [leftSidebar, fakePane({ thread: true })],
}), null, "a non-composer aside must not be mistaken for Ask");

const legacyComposerSurface = {};
const legacyComposerScope = {
  querySelector(selector) {
    return selector === ".composer-surface-chrome" ? legacyComposerSurface : null;
  },
};
assert.equal(resolveComposerSurfaceDocument(legacyComposerScope), legacyComposerSurface,
  "legacy Codex composer surfaces must remain supported");

const semanticComposerSurface = {};
const semanticComposerRoot = {
  contains(node) {
    return node === semanticComposerSurface;
  },
};
const semanticComposerEditor = {
  closest(selector) {
    if (selector === "[data-codex-composer-root]") return semanticComposerRoot;
    if (selector === '[data-composer-surface-variant][data-composer-radius-variant]') {
      return semanticComposerSurface;
    }
    return null;
  },
};
const semanticComposerScope = {
  querySelector(selector) {
    if (selector === ".composer-surface-chrome") return null;
    if (selector === '[data-codex-composer="true"]') return semanticComposerEditor;
    return null;
  },
  contains(node) {
    return node === semanticComposerRoot;
  },
};
assert.equal(resolveComposerSurfaceDocument(semanticComposerScope), semanticComposerSurface,
  "Codex 26.730 semantic composer surface must resolve through stable data attributes");

assert.equal(composerNativeLayerCoveragePass([]), true,
  "legacy composers without a semantic native body must remain supported");
assert.equal(composerNativeLayerCoveragePass([{
  backgroundAlpha: 0,
  backgroundImage: "none",
  backdropFilter: "none",
  boxShadow: "none",
}]), true, "a transparent Codex semantic composer body must preserve theme glass");
assert.equal(composerNativeLayerCoveragePass([{
  backgroundAlpha: 0.864706,
  backgroundImage: "none",
  backdropFilter: "none",
  boxShadow: "none",
}]), false, "an opaque Codex semantic composer body must fail verification");
assert.equal(composerNativeLayerCoveragePass([{
  backgroundAlpha: 0,
  backgroundImage: "linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0))",
  backdropFilter: "none",
  boxShadow: "none",
}]), false, "a native composer background image must fail verification");
assert.equal(composerNativeLayerCoveragePass([{
  backgroundAlpha: 0,
  backgroundImage: "none",
  backdropFilter: "blur(16px)",
  boxShadow: "none",
}]), false, "a second native composer blur layer must fail verification");
assert.equal(composerNativeLayerCoveragePass([{
  backgroundAlpha: 0,
  backgroundImage: "none",
  backdropFilter: "none",
  boxShadow: "rgb(24, 24, 24) 0px 0px 0px 0.5px",
}]), false, "a native dark composer shadow must fail verification");

assert.equal(homeTopFadeCoveragePass({
  homeRoute: true,
  present: true,
  backgroundImage: "none",
  backdropFilter: "none",
  boxShadow: "none",
}), true, "Home must clear the native content-frame top fade");
assert.equal(homeTopFadeCoveragePass({
  homeRoute: true,
  present: true,
  backgroundImage: "linear-gradient(rgb(24, 24, 24), transparent)",
  backdropFilter: "none",
  boxShadow: "none",
}), false, "Home must reject the native dark horizontal top fade");
assert.equal(homeTopFadeCoveragePass({
  homeRoute: false,
  present: true,
  backgroundImage: "linear-gradient(rgb(24, 24, 24), transparent)",
}), true, "task routes may retain their native top fade");

assert.equal(workspaceSurfaceCoveragePass({
  homeRoute: true,
  present: true,
  backgroundAlpha: 0.54,
  backdropFilter: "blur(18px) saturate(1.12)",
}), true, "Home workspace controls must retain the locked 54% / 18px surface");
assert.equal(workspaceSurfaceCoveragePass({
  homeRoute: true,
  present: true,
  backgroundAlpha: 0,
  backdropFilter: "none",
}), false, "Home must reject a washed-out transparent workspace toolbar");
assert.equal(workspaceSurfaceCoveragePass({
  homeRoute: false,
  present: false,
}), true, "task routes do not require the Home workspace toolbar");

assert.equal(chatPaneDividerParityPass({ chatPanePresent: false }), true,
  "absent Ask pane must not require divider verification");
assert.equal(chatPaneDividerParityPass({
  chatPanePresent: true,
  sidebarPresent: false,
  paneLeftWidth: "1px",
  paneLeftStyle: "solid",
  paneLeftColor: "rgb(10, 20, 30)",
  nativeDividerLeftWidth: "0px",
}), true, "Ask pane must verify its designed divider when the sidebar is collapsed");
assert.equal(chatPaneDividerParityPass({
  chatPanePresent: true,
  sidebarPresent: true,
  paneLeftWidth: "1px",
  paneLeftStyle: "solid",
  paneLeftColor: "rgb(10, 20, 30)",
  sidebarRightWidth: "1px",
  sidebarRightStyle: "solid",
  sidebarRightColor: "rgb(10, 20, 30)",
  nativeDividerLeftWidth: "0px",
}), true, "Ask and sidebar dividers must match when both are visible");
assert.equal(chatPaneDividerParityPass({
  chatPanePresent: true,
  sidebarPresent: false,
  paneLeftWidth: "0px",
  paneLeftStyle: "none",
  nativeDividerLeftWidth: "1px",
}), false, "Ask pane must reject a missing designed divider");

console.log("codex shell probe tests passed");
