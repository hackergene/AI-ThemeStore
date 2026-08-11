import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_PANE_DIVIDER_PARITY_EXPRESSION,
  CHAT_PANE_RESOLVER_EXPRESSION,
  CODEX_SHELL_PROBE_EXPRESSION,
  COMPOSER_SURFACE_RESOLVER_EXPRESSION,
  OPTIONAL_SIDEBAR_VISIBILITY_EXPRESSION,
  SHELL_MAIN_RESOLVER_EXPRESSION,
  TOOL_PANE_RESOLVER_EXPRESSION,
  resolveComposerSurfaceDocument,
} from "./codex-shell-probe.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const SKIN_VERSION = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_ART_BYTES = 16 * 1024 * 1024;
const MAX_MOTION_BYTES = 8 * 1024 * 1024;
const LOCKED_VISUAL_BASELINE = Object.freeze({
  backgroundMode: "full",
  heroHeight: 272,
  contentMaxWidth: 980,
  blur: 14,
  panelOpacity: 0.72,
  homeSurfaceOpacity: 0.5,
  controlSurfaceOpacity: 0.54,
  controlSurfaceBlur: 18,
  sidebarOpacity: 0.5,
  sidebarBlur: 0,
  shellRadius: 17,
  heroRadius: 22,
  cardRadius: 18,
  composerRadius: 21,
});
const THEME_ICONS = JSON.parse(await fs.readFile(path.join(root, "assets", "theme-icons.json"), "utf8"));
const THEME_ICON_ASSIGNMENTS = JSON.parse(await fs.readFile(path.join(root, "assets", "theme-icon-assignments.json"), "utf8"));
const COMPOSER_ICONS = Object.keys(THEME_ICONS);

function parseArgs(argv) {
  const options = {
    port: 9341,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    themeDir: null,
    desiredGeneration: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--check-payload") options.mode = "check";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--desired-generation") options.desiredGeneration = Number(argv[++i]);
    else if (arg === "--reload") options.reload = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (!Number.isSafeInteger(options.desiredGeneration) || options.desiredGeneration < 0) {
    throw new Error(`Invalid desired generation: ${options.desiredGeneration}`);
  }
  return options;
}

function validatedDebuggerUrl(target, port) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname) || Number(url.port) !== port) {
    throw new Error(`Rejected non-loopback CDP WebSocket URL: ${url.href}`);
  }
  return url.href;
}

class CdpSession {
  constructor(target, port) {
    this.target = target;
    this.ws = new WebSocket(validatedDebuggerUrl(target, port));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP WebSocket open timed out")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP WebSocket open failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    if (!this.closed) this.ws.close();
    this.closed = true;
  }
}

async function listAppTargets(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const targets = await response.json();
    return targets.filter((item) => {
      if (item.type !== "page" || !item.url?.startsWith("app://") || !item.webSocketDebuggerUrl) return false;
      try {
        validatedDebuggerUrl(item, port);
        return true;
      } catch {
        return false;
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeSession(session) {
  return session.evaluate(CODEX_SHELL_PROBE_EXPRESSION);
}

async function connectTarget(target, port) {
  return new CdpSession(target, port).open();
}

async function connectCodexTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await listAppTargets(port);
      const connected = [];
      for (const target of targets) {
        let session;
        try {
          session = await connectTarget(target, port);
          const probe = await probeSession(session);
          if (probe?.codex) connected.push({ target, session, probe });
          else session.close();
        } catch (error) {
          session?.close();
          lastError = error;
        }
      }
      if (connected.length) return connected;
      lastError = new Error("No page matched the expected Codex shell markers");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No verified Codex renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

async function loadTheme(themeDir) {
  const assetsRoot = themeDir ?? path.join(root, "assets");
  const configPath = path.join(assetsRoot, "theme.json");
  let config;
  try {
    const configStat = await fs.lstat(configPath);
    if (!configStat.isFile()) throw new Error(`Theme config must be a regular file: ${configPath}`);
    config = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (themeDir && error.code === "ENOENT") {
      throw new Error(`Explicit theme directory is missing theme.json: ${configPath}`);
    }
    throw error;
  }
  const raw = JSON.parse(config);
  if (![1, 2].includes(raw.schemaVersion)) {
    throw new Error(`${configPath} has an unsupported schema version`);
  }
  const assetName = (value, fallback, label) => {
    const selected = typeof value === "string" && value.trim() ? value.trim() : fallback;
    if (!selected || path.basename(selected) !== selected) {
      throw new Error(`${label} must stay inside its theme directory`);
    }
    return selected;
  };
  const legacyImage = typeof raw.image === "string" ? raw.image : "";
  const heroImage = assetName(raw.assets?.hero, legacyImage, "Theme hero image");
  const taskImage = assetName(raw.assets?.taskBackground, heroImage, "Theme task background");
  const text = (value, fallback, max) => typeof value === "string" && value.trim()
    ? value.trim().slice(0, max) : fallback;
  const color = (value, fallback) => {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim();
    return /^#[0-9a-f]{6}$/i.test(normalized) || /^rgba?\([0-9., %]+\)$/i.test(normalized)
      ? normalized
      : fallback;
  };
  const number = (value, fallback, min, max) => Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback;
  const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  const flag = (value, fallback = true) => typeof value === "boolean" ? value : fallback;
  const position = (value, fallback) => {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().toLowerCase();
    const atom = "(?:left|center|right|top|bottom|(?:100|[0-9]{1,2})%)";
    return new RegExp(`^${atom}(?:\\s+${atom})?$`).test(normalized) ? normalized : fallback;
  };
  const appearance = raw.appearance && typeof raw.appearance === "object" ? raw.appearance : {};
  const layout = raw.layout && typeof raw.layout === "object" ? raw.layout : {};
  const effects = raw.effects && typeof raw.effects === "object" ? raw.effects : {};
  const decorations = raw.decorations && typeof raw.decorations === "object" ? raw.decorations : {};
  const rawColors = appearance.colors && typeof appearance.colors === "object"
    ? appearance.colors : raw.colors;
  const theme = {
    schemaVersion: raw.schemaVersion,
    id: text(raw.id, "custom", 80),
    name: text(raw.name, "AI ThemeStore", 80),
    version: text(raw.version, "1.0.0", 32),
    author: text(raw.author, "themestore.ai", 80),
    description: text(raw.description, "", 240),
    brandSubtitle: text(raw.brandSubtitle, "AI THEMESTORE", 80),
    tagline: text(raw.tagline, "Make something wonderful.", 160),
    projectPrefix: text(raw.projectPrefix, "选择项目 · ", 80),
    projectLabel: text(raw.projectLabel, "◉  选择项目", 80),
    statusText: text(raw.statusText, "AI THEMESTORE ONLINE", 80),
    quote: text(raw.quote, "MAKE SOMETHING WONDERFUL", 80),
    assets: {
      hero: heroImage,
      taskBackground: taskImage,
    },
    appearance: {
      preferredMode: choice(appearance.preferredMode, ["auto", "light", "dark"], "auto"),
    },
    layout: {
      backgroundMode: LOCKED_VISUAL_BASELINE.backgroundMode,
      heroHeight: LOCKED_VISUAL_BASELINE.heroHeight,
      heroPosition: position(layout.heroPosition, "right center"),
      taskPosition: position(layout.taskPosition, "76% center"),
      contentMaxWidth: LOCKED_VISUAL_BASELINE.contentMaxWidth,
    },
    effects: {
      blur: LOCKED_VISUAL_BASELINE.blur,
      panelOpacity: LOCKED_VISUAL_BASELINE.panelOpacity,
      homeSurfaceOpacity: LOCKED_VISUAL_BASELINE.homeSurfaceOpacity,
      controlSurfaceOpacity: LOCKED_VISUAL_BASELINE.controlSurfaceOpacity,
      controlSurfaceBlur: LOCKED_VISUAL_BASELINE.controlSurfaceBlur,
      sidebarOpacity: LOCKED_VISUAL_BASELINE.sidebarOpacity,
      sidebarBlur: LOCKED_VISUAL_BASELINE.sidebarBlur,
      backgroundDim: number(effects.backgroundDim, 0, 0, 0.6),
      shellRadius: LOCKED_VISUAL_BASELINE.shellRadius,
      heroRadius: LOCKED_VISUAL_BASELINE.heroRadius,
      cardRadius: LOCKED_VISUAL_BASELINE.cardRadius,
      composerRadius: LOCKED_VISUAL_BASELINE.composerRadius,
      motion: choice(effects.motion, ["full", "reduced", "none"], "full"),
    },
    decorations: {
      brand: flag(decorations.brand),
      status: flag(decorations.status),
      quote: flag(decorations.quote),
      particles: choice(decorations.particles, ["none", "soft", "sparkles"], "soft"),
      orbit: flag(decorations.orbit),
      composerMark: choice(
        decorations.composerMark,
        ["portal", "wave", "sun", "spark", "moon", "leaf", "compass", "snow", "star", "flame", "diamond", "none"],
        "portal",
      ),
      composerIcon: choice(
        decorations.composerIcon,
        COMPOSER_ICONS,
        choice(THEME_ICON_ASSIGNMENTS[text(raw.id, "custom", 80)], COMPOSER_ICONS, ""),
      ),
      composerMarkStyle: choice(decorations.composerMarkStyle, ["anchor", "notch", "dot", "none"], "anchor"),
    },
    colors: {
      background: color(rawColors?.background, "#071116"),
      panel: color(rawColors?.panel, "#0b1a20"),
      panelAlt: color(rawColors?.panelAlt, "#10272c"),
      accent: color(rawColors?.accent, "#7cff46"),
      accentAlt: color(rawColors?.accentAlt, "#b8ff3d"),
      secondary: color(rawColors?.secondary, "#36d7e8"),
      highlight: color(rawColors?.highlight, "#642a8c"),
      text: color(rawColors?.text, "#e9fff1"),
      muted: color(rawColors?.muted, "#9ebdb3"),
      line: color(rawColors?.line, "rgba(124, 255, 70, .28)"),
    },
  };
  const rawBackground = raw.background && typeof raw.background === "object" && !Array.isArray(raw.background)
    ? raw.background : null;
  if (rawBackground) {
    if (rawBackground.type !== "video") {
      throw new Error("Theme background type must be video when background metadata is present");
    }
    const source = assetName(rawBackground.source, "", "Theme motion source");
    const poster = assetName(rawBackground.poster, heroImage, "Theme motion poster");
    if (theme.layout.backgroundMode !== "full" || theme.effects.motion !== "full" ||
        path.extname(source).toLowerCase() !== ".mp4" ||
        poster !== heroImage || rawBackground.playback !== "loop-muted") {
      throw new Error("Dynamic themes require a full-window MP4, the hero poster, and loop-muted playback");
    }
    theme.background = { type: "video", source, poster, playback: "loop-muted" };
  } else {
    theme.background = { type: "static" };
  }
  const validateImage = async (filename, label) => {
    const imagePath = path.join(assetsRoot, filename);
    const imageStat = await fs.lstat(imagePath);
    if (!imageStat.isFile() || imageStat.size < 1 || imageStat.size > MAX_ART_BYTES) {
      throw new Error(`${label} must be a non-empty file no larger than ${MAX_ART_BYTES} bytes`);
    }
    const extension = path.extname(filename).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp", ".avif"].includes(extension)) {
      throw new Error(`Unsupported ${label.toLowerCase()} format: ${extension || "missing"}`);
    }
    return { imagePath, imageStat };
  };
  const hero = await validateImage(theme.assets.hero, "Theme hero image");
  const task = theme.assets.taskBackground === theme.assets.hero
    ? hero : await validateImage(theme.assets.taskBackground, "Theme task background");
  let motion = null;
  if (theme.background.type === "video") {
    const motionPath = path.join(assetsRoot, theme.background.source);
    const motionStat = await fs.lstat(motionPath);
    if (!motionStat.isFile() || motionStat.nlink !== 1 || motionStat.size < 12 || motionStat.size > MAX_MOTION_BYTES) {
      throw new Error(`Theme motion must be a private MP4 no larger than ${MAX_MOTION_BYTES} bytes`);
    }
    const handle = await fs.open(motionPath, "r");
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== header.length || header.subarray(4, 8).toString("ascii") !== "ftyp") {
        throw new Error("Theme motion does not have a valid MP4 header");
      }
    } finally {
      await handle.close();
    }
    motion = { motionPath, motionStat };
  }
  return { assetsRoot, hero, task, motion, theme };
}

async function loadPayload(themeDir, desiredGeneration = 0) {
  const [css, template, loaded] = await Promise.all([
    fs.readFile(path.join(root, "assets", "ai-themestore.css"), "utf8"),
    fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
    loadTheme(themeDir),
  ]);
  const { hero, task, motion, theme } = loaded;
  const imageDataUrl = async (imagePath) => {
    const art = await fs.readFile(imagePath);
    const extension = path.extname(imagePath).toLowerCase();
    const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".webp" ? "image/webp"
        : extension === ".avif" ? "image/avif" : "image/png";
    return { bytes: art.length, url: `data:${mime};base64,${art.toString("base64")}` };
  };
  const heroArt = await imageDataUrl(hero.imagePath);
  const taskArt = task.imagePath === hero.imagePath ? heroArt : await imageDataUrl(task.imagePath);
  const motionArt = motion
    ? { bytes: motion.motionStat.size, url: `data:video/mp4;base64,${(await fs.readFile(motion.motionPath)).toString("base64")}` }
    : { bytes: 0, url: "" };
  const payload = template
    .replace("__AI_THEMESTORE_CSS_JSON__", JSON.stringify(css))
    .replace("__AI_THEMESTORE_ART_JSON__", JSON.stringify(heroArt.url))
    .replace("__AI_THEMESTORE_TASK_ART_JSON__", JSON.stringify(taskArt.url))
    .replace("__AI_THEMESTORE_MOTION_JSON__", JSON.stringify(motionArt.url))
    .replace("__AI_THEMESTORE_THEME_JSON__", JSON.stringify({ ...theme, desiredGeneration }))
    .replace("__AI_THEMESTORE_ICONS_JSON__", JSON.stringify(THEME_ICONS))
    .replace("__AI_THEMESTORE_VERSION_JSON__", JSON.stringify(SKIN_VERSION));
  return {
    imageBytes: heroArt.bytes + (taskArt === heroArt ? 0 : taskArt.bytes),
    motionBytes: motionArt.bytes,
    payload,
    theme,
  };
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__AI_THEMESTORE_DISABLED__ = true;
    const state = window.__AI_THEMESTORE_STATE__;
    if (state?.cleanup) return state.cleanup();
    document.documentElement?.classList.remove('ai-themestore');
    document.documentElement?.style.removeProperty('--ai-themestore-art');
    document.getElementById('ai-themestore-style')?.remove();
    document.getElementById('ai-themestore-chrome')?.remove();
    document.getElementById('ai-themestore-motion')?.remove();
    delete window.__AI_THEMESTORE_STATE__;
    return true;
  })()`);
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() =>
    !document.documentElement.classList.contains('ai-themestore') &&
    !document.getElementById('ai-themestore-style') &&
    !document.getElementById('ai-themestore-chrome') &&
    !document.getElementById('ai-themestore-motion') &&
    !window.__AI_THEMESTORE_STATE__
  )()`);
}

async function verifySession(session, expected = null) {
  return session.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      };
    };
    const rgb = (value) => {
      if (!value) return null;
      const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
      if (hex) {
        const number = Number.parseInt(hex[1], 16);
        return { r: number >> 16, g: (number >> 8) & 255, b: number & 255 };
      }
      const legacy = String(value).match(/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)/i);
      if (legacy) return { r: Number(legacy[1]), g: Number(legacy[2]), b: Number(legacy[3]) };
      const srgb = String(value).match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/i);
      if (srgb) return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255 };
      return null;
    };
    const luminance = (color) => {
      if (!color) return null;
      const channels = [color.r, color.g, color.b].map((component) => {
        const value = component / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const colorMetric = (node, pseudo = null) => {
      if (!node) return null;
      const value = getComputedStyle(node, pseudo).color;
      return { value, luminance: luminance(rgb(value)) };
    };
    const polarityPass = (metric, shell, muted = false) => {
      if (!metric || metric.luminance == null) return false;
      if (shell === 'dark') return metric.luminance >= (muted ? 0.28 : 0.50);
      return metric.luminance <= (muted ? 0.48 : 0.34);
    };
    const backgroundAlpha = (value) => {
      if (!value || value === 'transparent') return 0;
      const slash = String(value).match(/\\/\\s*([\\d.]+)(%)?\\s*\\)$/);
      if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
      const legacy = String(value).match(/rgba\\([^)]*,\\s*([\\d.]+)\\s*\\)$/i);
      if (legacy) return Number(legacy[1]);
      return 1;
    };
    const homeIndicator = document.querySelector('[data-testid="home-icon"]');
    const modernHomeSignal = document.querySelector('[data-home-ambient-suggestions]');
    const homeSignal = homeIndicator ?? document.querySelector('[data-feature="game-source"]') ??
      document.querySelector('.group\\\\/home-suggestions') ?? modernHomeSignal;
    const homeRoute = homeSignal?.closest('[role="main"]') ?? null;
    const home = document.querySelector('[role="main"].ai-themestore-home');
    const modernHome = Boolean(home?.classList.contains('ai-themestore-home-v2'));
    const suggestions = home?.querySelector('.ai-themestore-home-suggestions') ??
      home?.querySelector('.group\\\\/home-suggestions') ?? null;
    const cardBoxes = suggestions ? [...suggestions.querySelectorAll('button')].map(box) : [];
    const visibleCards = cardBoxes.filter((item) => item?.visible);
    const hero = box(home?.querySelector('.ai-themestore-home-hero') ??
      home?.firstElementChild?.firstElementChild?.firstElementChild);
    const homeBox = box(home);
    const projectSelector = home?.querySelector('.group\\\\/project-selector') ??
      home?.querySelector('[data-composer-navigation-target="workspace-project"]') ?? null;
    const projectButton = box(projectSelector?.matches('button')
      ? projectSelector
      : projectSelector?.querySelector(':scope > button') ?? projectSelector);
    const projectScrollArea = projectSelector?.closest('[data-composer-utility-bar-scroll-area]') ?? null;
    const projectUtilityBar = projectScrollArea?.parentElement ?? null;
    const projectHintNode = projectUtilityBar?.querySelector(':scope > .ai-themestore-project-hint') ?? null;
    const projectRightControl = projectScrollArea?.nextElementSibling ?? null;
    const composerNode = ${COMPOSER_SURFACE_RESOLVER_EXPRESSION};
    const composer = box(composerNode);
    const signatureNode = composerNode?.querySelector(':scope > .ai-themestore-composer-signature') ?? null;
    const signature = box(signatureNode);
    const quoteNode = composerNode?.querySelector(':scope > .ai-themestore-composer-quote') ?? null;
    const quoteBox = box(quoteNode);
    const orbitNode = composerNode?.querySelector(':scope > .ai-themestore-composer-orbit') ?? null;
    const orbitBox = box(orbitNode);
    const editor = composerNode?.querySelector('.ProseMirror') ?? null;
    const placeholder = editor?.querySelector('.placeholder') ?? null;
    const composerSurfaceMetric = (node) => {
      const style = node ? getComputedStyle(node) : null;
      return {
        backgroundColor: style?.backgroundColor ?? null,
        backgroundAlpha: style ? backgroundAlpha(style.backgroundColor) : null,
        backdropFilter: style?.backdropFilter ?? null,
        borderRadius: style?.borderRadius ?? null,
        pass: false,
      };
    };
    const composerSurface = composerSurfaceMetric(composerNode);
    const taskText = [...document.querySelectorAll('[data-content-search-unit-key] p')]
      .find((node) => box(node)?.visible) ?? null;
    const sidebarNode = document.querySelector('aside.app-shell-left-panel');
    const sidebar = box(sidebarNode);
    const shellMainNode = ${SHELL_MAIN_RESOLVER_EXPRESSION};
    const shellMain = box(shellMainNode);
    const shellMainStyle = shellMainNode ? getComputedStyle(shellMainNode) : null;
    const shellMainCoverage = {
      ...shellMain,
      semantic: shellMainNode?.hasAttribute('data-app-shell-main-surface') ?? false,
      backgroundColor: shellMainStyle?.backgroundColor ?? null,
      backgroundAlpha: shellMainStyle ? backgroundAlpha(shellMainStyle.backgroundColor) : null,
      pass: false,
    };
    const chrome = document.getElementById('ai-themestore-chrome');
    const chromeBox = box(chrome);
    const composerNodes = [...document.querySelectorAll('.ai-themestore-composer-surface')];
    const chatPaneNode = ${CHAT_PANE_RESOLVER_EXPRESSION};
    const chatPaneExpected = composerNodes.length > 1 || Boolean(chatPaneNode);
    const chatPaneBox = box(chatPaneNode);
    const chatPaneComposerNode = chatPaneNode
      ? (${resolveComposerSurfaceDocument.toString()})(document, chatPaneNode)
      : null;
    const chatPaneComposer = box(chatPaneComposerNode);
    const chatPaneNativeSurfaces = chatPaneNode
      ? [...chatPaneNode.querySelectorAll('.bg-token-main-surface-primary')]
      : [];
    const chatPaneGradientSurfaces = chatPaneNode
      ? [...chatPaneNode.querySelectorAll(
        '[class~="bg-gradient-to-t"][class~="from-token-main-surface-primary"]',
      )]
      : [];
    const taskGradientSurfaces = [...document.querySelectorAll(
      '[class~="bg-gradient-to-t"][class~="from-token-main-surface-primary"]',
    )].filter((node) => !chatPaneNode?.contains(node));
    const nativeSurfacesClear = chatPaneNativeSurfaces.every((node) => {
      const style = getComputedStyle(node);
      return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none';
    });
    const gradientSurfacesClear = chatPaneGradientSurfaces.every(
      (node) => getComputedStyle(node).backgroundImage === 'none',
    );
    const taskGradientsClear = taskGradientSurfaces.every(
      (node) => getComputedStyle(node).backgroundImage === 'none',
    );
    const chatPaneNativeDivider = chatPaneNode?.querySelector(
      '[class~="bg-token-main-surface-primary"][class~="border-l"][class~="border-token-border-default"]',
    ) ?? null;
    const chatPaneStyle = chatPaneNode ? getComputedStyle(chatPaneNode) : null;
    const sidebarStyle = sidebarNode ? getComputedStyle(sidebarNode) : null;
    const nativeDividerStyle = chatPaneNativeDivider
      ? getComputedStyle(chatPaneNativeDivider)
      : null;
    const dividerParity = {
      paneLeftWidth: chatPaneStyle?.borderLeftWidth ?? null,
      paneLeftStyle: chatPaneStyle?.borderLeftStyle ?? null,
      paneLeftColor: chatPaneStyle?.borderLeftColor ?? null,
      sidebarRightWidth: sidebarStyle?.borderRightWidth ?? null,
      sidebarRightStyle: sidebarStyle?.borderRightStyle ?? null,
      sidebarRightColor: sidebarStyle?.borderRightColor ?? null,
      nativeDividerLeftWidth: nativeDividerStyle?.borderLeftWidth ?? null,
    };
    dividerParity.pass = ${CHAT_PANE_DIVIDER_PARITY_EXPRESSION}({
      chatPanePresent: Boolean(chatPaneNode),
      sidebarPresent: Boolean(sidebarNode),
      ...dividerParity,
    });
    const artworkSpansChatPane = !chatPaneBox || Boolean(
      chromeBox?.visible &&
      chromeBox.x <= chatPaneBox.x + 2 &&
      chromeBox.x + chromeBox.width >= chatPaneBox.x + chatPaneBox.width - 2
    );
    const chatPaneCoverage = {
      expected: chatPaneExpected,
      present: Boolean(chatPaneNode),
      ...chatPaneBox,
      composer: chatPaneComposer,
      composerSurface: composerSurfaceMetric(chatPaneComposerNode),
      nativeSurfaceCount: chatPaneNativeSurfaces.length,
      nativeSurfacesClear,
      gradientSurfaceCount: chatPaneGradientSurfaces.length,
      gradientSurfacesClear,
      dividerParity,
      artworkSpansChatPane,
    };
    chatPaneCoverage.pass = !chatPaneExpected || Boolean(
      chatPaneNode && chatPaneBox?.visible && chatPaneComposer?.visible &&
      chatPaneNativeSurfaces.length >= 2 &&
      nativeSurfacesClear && gradientSurfacesClear &&
      dividerParity.pass && artworkSpansChatPane
    );
    const taskSurfaceCoverage = {
      gradientSurfaceCount: taskGradientSurfaces.length,
      gradientsClear: taskGradientsClear,
      pass: taskGradientsClear,
    };
    const toolPaneNode = ${TOOL_PANE_RESOLVER_EXPRESSION};
    const toolPane = box(toolPaneNode);
    const toolPaneNativeSurfaces = toolPaneNode
      ? [...toolPaneNode.querySelectorAll('.bg-token-main-surface-primary')]
      : [];
    const toolPaneNativeSurfacesClear = toolPaneNativeSurfaces.every((node) => {
      const style = getComputedStyle(node);
      return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none';
    });
    const toolPaneNativeDivider = toolPaneNode?.querySelector(
      '[class~="border-l"][class~="border-token-border-default"]',
    ) ?? null;
    const toolPaneStyle = toolPaneNode ? getComputedStyle(toolPaneNode) : null;
    const toolPaneDividerStyle = toolPaneNativeDivider
      ? getComputedStyle(toolPaneNativeDivider)
      : null;
    const toolPaneDividerParity = {
      paneLeftWidth: toolPaneStyle?.borderLeftWidth ?? null,
      paneLeftStyle: toolPaneStyle?.borderLeftStyle ?? null,
      paneLeftColor: toolPaneStyle?.borderLeftColor ?? null,
      sidebarRightWidth: sidebarStyle?.borderRightWidth ?? null,
      sidebarRightStyle: sidebarStyle?.borderRightStyle ?? null,
      sidebarRightColor: sidebarStyle?.borderRightColor ?? null,
      nativeDividerLeftWidth: toolPaneDividerStyle?.borderLeftWidth ?? null,
    };
    toolPaneDividerParity.pass = ${CHAT_PANE_DIVIDER_PARITY_EXPRESSION}({
      chatPanePresent: Boolean(toolPaneNode),
      sidebarPresent: Boolean(sidebarNode),
      ...toolPaneDividerParity,
    });
    const toolPaneCoverage = {
      present: Boolean(toolPaneNode),
      ...toolPane,
      nativeSurfaceCount: toolPaneNativeSurfaces.length,
      nativeSurfacesClear: toolPaneNativeSurfacesClear,
      dividerParity: toolPaneDividerParity,
      pass: !toolPaneNode || Boolean(
        toolPane?.visible && toolPaneNativeSurfaces.length >= 2 &&
        toolPaneNativeSurfacesClear && toolPaneDividerParity.pass
      ),
    };
    const rootStyle = getComputedStyle(document.documentElement);
    const nativeTaskWidth = Number.parseFloat(rootStyle.getPropertyValue('--ds-native-task-width')) || 736;
    const alignedHeroHeight = Number.parseFloat(rootStyle.getPropertyValue('--ds-aligned-hero-height')) || 202;
    const visualBaseline = {
      backgroundMode: document.documentElement.dataset.themestoreBackground ?? null,
      heroHeight: rootStyle.getPropertyValue('--ds-hero-height').trim(),
      contentMaxWidth: rootStyle.getPropertyValue('--ds-content-max-width').trim(),
      panelMix: rootStyle.getPropertyValue('--ds-panel-mix').trim(),
      cardSurfaceMix: rootStyle.getPropertyValue('--ds-card-surface-mix').trim(),
      workspaceSurfaceMix: rootStyle.getPropertyValue('--ds-workspace-surface-mix').trim(),
      composerSurfaceMix: rootStyle.getPropertyValue('--ds-composer-surface-mix').trim(),
      controlSurfaceBlur: rootStyle.getPropertyValue('--ds-control-surface-blur').trim(),
      sidebarSurfaceMix: rootStyle.getPropertyValue('--ds-sidebar-surface-mix').trim(),
      sidebarSurfaceBlur: rootStyle.getPropertyValue('--ds-sidebar-surface-blur').trim(),
      shellRadius: rootStyle.getPropertyValue('--ds-shell-radius').trim(),
      heroRadius: rootStyle.getPropertyValue('--ds-hero-radius').trim(),
      cardRadius: rootStyle.getPropertyValue('--ds-card-radius').trim(),
      composerRadius: rootStyle.getPropertyValue('--ds-composer-radius').trim(),
    };
    visualBaseline.pass = Boolean(
      visualBaseline.backgroundMode === 'full' &&
      visualBaseline.heroHeight === '272px' &&
      visualBaseline.contentMaxWidth === '980px' &&
      visualBaseline.panelMix === '72%' &&
      visualBaseline.cardSurfaceMix === '50%' &&
      visualBaseline.workspaceSurfaceMix === '54%' &&
      visualBaseline.composerSurfaceMix === '54%' &&
      visualBaseline.controlSurfaceBlur === '18px' &&
      visualBaseline.sidebarSurfaceMix === '50%' &&
      visualBaseline.sidebarSurfaceBlur === '0px' &&
      visualBaseline.shellRadius === '17px' &&
      visualBaseline.heroRadius === '22px' &&
      visualBaseline.cardRadius === '18px' &&
      visualBaseline.composerRadius === '21px'
    );
    const result = {
      installed: document.documentElement.classList.contains('ai-themestore'),
      version: window.__AI_THEMESTORE_STATE__?.version ?? null,
      themeId: window.__AI_THEMESTORE_STATE__?.themeId ?? null,
      themeVersion: window.__AI_THEMESTORE_STATE__?.themeVersion ?? null,
      themeSchemaVersion: window.__AI_THEMESTORE_STATE__?.themeSchemaVersion ?? null,
      desiredGeneration: window.__AI_THEMESTORE_STATE__?.desiredGeneration ?? null,
      stylePresent: Boolean(document.getElementById('ai-themestore-style')),
      chromePresent: Boolean(chrome),
      chromePointerEvents: getComputedStyle(chrome || document.body).pointerEvents,
      homeRoute: Boolean(homeRoute),
      homePresent: Boolean(home),
      modernHome,
      homeBox,
      hero,
      cards: cardBoxes,
      visibleCardCount: visibleCards.length,
      projectButton,
      projectUtility: {
        bar: box(projectUtilityBar),
        scrollArea: box(projectScrollArea),
        hint: {
          ...box(projectHintNode),
          text: projectHintNode?.textContent?.trim() ?? '',
          ariaHidden: projectHintNode?.getAttribute('aria-hidden') === 'true',
          pointerEvents: projectHintNode ? getComputedStyle(projectHintNode).pointerEvents : null,
          role: projectHintNode?.getAttribute('role') ?? null,
          immediatelyBeforeScrollArea: projectHintNode?.nextElementSibling === projectScrollArea,
        },
        rightControl: box(projectRightControl),
      },
      composer,
      composerSurface,
      shellMainCoverage,
      chatPaneCoverage,
      taskSurfaceCoverage,
      toolPaneCoverage,
      signature: {
        ...signature,
        ariaHidden: signatureNode?.getAttribute('aria-hidden') === 'true',
        pointerEvents: signatureNode ? getComputedStyle(signatureNode).pointerEvents : null,
        role: signatureNode?.getAttribute('role') ?? null,
        tabIndex: signatureNode?.tabIndex ?? null,
        style: document.documentElement.dataset.themestoreMarkStyle ?? null,
      },
      composerDecorations: {
        quote: {
          ...quoteBox,
          ariaHidden: quoteNode?.getAttribute('aria-hidden') === 'true',
          pointerEvents: quoteNode ? getComputedStyle(quoteNode).pointerEvents : null,
        },
        orbit: {
          ...orbitBox,
          ariaHidden: orbitNode?.getAttribute('aria-hidden') === 'true',
          pointerEvents: orbitNode ? getComputedStyle(orbitNode).pointerEvents : null,
        },
      },
      sidebar,
      visualBaseline,
      homeGeometry: null,
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    const shell = document.documentElement.getAttribute('data-themestore-shell') || 'unknown';
    result.shellMainCoverage.pass = Boolean(
      result.shellMainCoverage.visible &&
      result.shellMainCoverage.backgroundAlpha != null &&
      result.shellMainCoverage.backgroundAlpha >= 0.28 &&
      result.shellMainCoverage.backgroundAlpha <= 0.55
    );
    const expectedComposerAlpha = shell === 'light' ? 0.94 : 0.54;
    const composerSurfacePass = (metric) => Boolean(
      metric.backgroundAlpha != null &&
      Math.abs(metric.backgroundAlpha - expectedComposerAlpha) <= 0.035 &&
      metric.backdropFilter?.includes('blur(18px)') &&
      metric.borderRadius === '21px'
    );
    result.composerSurface.pass = composerSurfacePass(result.composerSurface);
    result.chatPaneCoverage.composerSurface.pass = !result.chatPaneCoverage.expected ||
      composerSurfacePass(result.chatPaneCoverage.composerSurface);
    result.chatPaneCoverage.pass = result.chatPaneCoverage.pass &&
      result.chatPaneCoverage.composerSurface.pass;
    const nativeForegroundValue = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-token-foreground').trim();
    const nativeForeground = {
      value: nativeForegroundValue,
      luminance: luminance(rgb(nativeForegroundValue)),
    };
    const editorText = colorMetric(editor);
    const placeholderText = colorMetric(placeholder, '::before') ?? colorMetric(placeholder);
    const taskBodyText = colorMetric(taskText);
    const nativeShellPass = nativeForeground.luminance == null ||
      (shell === 'dark' ? nativeForeground.luminance >= 0.55 :
        shell === 'light' ? nativeForeground.luminance <= 0.45 : false);
    const taskTextPass = !taskText || polarityPass(taskBodyText, shell);
    result.readability = {
      shell,
      nativeForeground,
      nativeShellPass,
      editorText,
      editorTextPass: polarityPass(editorText, shell),
      placeholderText,
      placeholderTextPass: !placeholder || polarityPass(placeholderText, shell, true),
      taskBodyText,
      taskTextPass,
    };
    result.readability.pass = Boolean(
      result.readability.nativeShellPass &&
      result.readability.editorTextPass &&
      result.readability.placeholderTextPass &&
      result.readability.taskTextPass
    );
    if (result.modernHome && result.hero?.visible && result.composer?.visible && visibleCards.length) {
      const scale = result.composer.width / nativeTaskWidth;
      const firstCard = visibleCards[0];
      const lastCard = visibleCards.at(-1);
      const heroToCardsGap = firstCard.y - (result.hero.y + result.hero.height);
      const tolerance = Math.max(4, scale * 8);
      const minimumHeroToCardsGap = innerHeight <= 760 ? -8 : 72;
      const heroAlignsToTaskGrid =
        Math.abs(result.hero.x - firstCard.x) <= tolerance &&
        Math.abs((result.hero.x + result.hero.width) - (lastCard.x + lastCard.width)) <= tolerance;
      result.homeGeometry = {
        scale,
        heroToCardsGap,
        expectedHeroHeight: alignedHeroHeight * scale,
        minimumHeroToCardsGap,
        heroAlignsToTaskGrid,
        pass: Boolean(
          heroAlignsToTaskGrid &&
          Math.abs(result.hero.height - alignedHeroHeight * scale) <= tolerance &&
          firstCard.height >= 120 && firstCard.height <= 190 &&
          heroToCardsGap >= minimumHeroToCardsGap &&
          visibleCards.every((card) => Math.abs(card.height - firstCard.height) <= tolerance)
        ),
      };
    }
    const signatureHidden = result.signature.style === 'none';
    const signatureBoundsPass = signatureHidden || Boolean(
      result.signature.visible && result.composer?.visible &&
      result.signature.x >= result.composer.x - 24 &&
      result.signature.x + result.signature.width <= result.composer.x + result.composer.width &&
      result.signature.y >= result.composer.y - 24 &&
      result.signature.y + result.signature.height <= result.composer.y + 24
    );
    result.signature.pass = Boolean(
      (signatureHidden ? !result.signature.visible : result.signature.visible) &&
      result.signature.ariaHidden && result.signature.pointerEvents === 'none' &&
      result.signature.role === null && result.signature.tabIndex === -1 && signatureBoundsPass
    );
    const quote = result.composerDecorations.quote;
    const quoteBoundsPass = !quote.visible || Boolean(
      result.composer?.visible && quote.x >= result.composer.x &&
      quote.x + quote.width <= result.composer.x + result.composer.width &&
      quote.y >= result.composer.y &&
      quote.y + quote.height <= result.composer.y + result.composer.height
    );
    const orbit = result.composerDecorations.orbit;
    const orbitBoundsPass = !orbit.visible || Boolean(
      result.composer?.visible && orbit.x >= result.composer.x &&
      orbit.x + orbit.width <= result.composer.x + result.composer.width &&
      orbit.y >= result.composer.y - 60 &&
      orbit.y + orbit.height <= result.composer.y + 8
    );
    result.composerDecorations.pass = Boolean(
      quote.ariaHidden && quote.pointerEvents === 'none' && quoteBoundsPass &&
      orbit.ariaHidden && orbit.pointerEvents === 'none' && orbitBoundsPass
    );
    const projectUtility = result.projectUtility;
    const hintShouldBeVisible = innerWidth > 1120;
    const hintSingleRowPass = !projectUtility.hint.visible || Boolean(
      projectUtility.bar?.visible && result.projectButton?.visible &&
      Math.abs(
        (projectUtility.hint.y + projectUtility.hint.height / 2) -
        (result.projectButton.y + result.projectButton.height / 2)
      ) <= 4
    );
    const hintBeforeProjectPass = !projectUtility.hint.visible || Boolean(
      projectUtility.hint.x + projectUtility.hint.width <= result.projectButton?.x
    );
    const rightControlSafePass = !projectUtility.rightControl?.visible || Boolean(
      projectUtility.scrollArea?.visible &&
      projectUtility.scrollArea.x + projectUtility.scrollArea.width <= projectUtility.rightControl.x
    );
    projectUtility.pass = Boolean(
      result.homeRoute ? (
        projectUtility.bar?.visible && projectUtility.scrollArea?.visible && result.projectButton?.visible &&
        projectUtility.hint.ariaHidden && projectUtility.hint.pointerEvents === 'none' &&
        projectUtility.hint.role === null && projectUtility.hint.immediatelyBeforeScrollArea &&
        Boolean(projectUtility.hint.text) &&
        (hintShouldBeVisible ? projectUtility.hint.visible : !projectUtility.hint.visible) &&
        hintSingleRowPass && hintBeforeProjectPass && rightControlSafePass
      ) : !projectUtility.hint.visible
    );
    const expected = ${JSON.stringify(expected)};
    const identityPass = !expected || (
      result.themeId === expected.themeId &&
      result.themeVersion === expected.themeVersion &&
      result.themeSchemaVersion === expected.themeSchemaVersion &&
      result.desiredGeneration === expected.desiredGeneration
    );
    result.sidebarVisibilityPass = ${OPTIONAL_SIDEBAR_VISIBILITY_EXPRESSION}(
      Boolean(sidebarNode),
      result.sidebar?.visible,
    );
    const basePass = result.installed && result.version === ${JSON.stringify(SKIN_VERSION)} && identityPass &&
      result.stylePresent && result.chromePresent && result.chromePointerEvents === 'none' &&
      Boolean(result.composer?.visible) && result.sidebarVisibilityPass &&
      result.signature.pass && result.composerDecorations.pass &&
      result.composerSurface.pass &&
      result.shellMainCoverage.pass &&
      result.chatPaneCoverage.pass && result.taskSurfaceCoverage.pass &&
      result.toolPaneCoverage.pass &&
      result.readability.pass &&
      result.visualBaseline.pass && !result.documentOverflow.x;
    const modernHomeLayoutPass = !result.modernHome || Boolean(
      result.homeBox?.visible && result.hero?.visible && result.composer?.visible &&
      result.hero.y >= result.homeBox.y - 2 &&
      result.hero.y + result.hero.height <= result.homeBox.y + result.homeBox.height + 2 &&
      result.composer.y >= result.homeBox.y - 2 &&
      result.composer.y + result.composer.height <= result.homeBox.y + result.homeBox.height + 2 &&
      result.homeGeometry?.pass
    );
    const homePass = !result.homeRoute || (
      result.homePresent && result.hero?.visible && result.hero.width >= 280 && result.hero.height >= 120 &&
      result.visibleCardCount <= 6 && modernHomeLayoutPass && result.projectUtility.pass
    );
    result.pass = Boolean(basePass && homePass);
    result.softNotes = {
      suggestionCardsOptional: result.visibleCardCount === 0,
    };
    return result;
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs, expected = null) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await verifySession(session, expected);
    if (lastResult.pass) return lastResult;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lastResult;
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const viewport = await session.evaluate("({ width: innerWidth, height: innerHeight })");
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(viewport.width * 0.64),
    y: Math.round(viewport.height * 0.62),
    button: "none",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function runOneShot(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs);
  const loaded = options.mode === "remove" ? null : await loadPayload(options.themeDir, options.desiredGeneration);
  const payload = loaded?.payload ?? null;
  const expected = loaded ? {
    themeId: loaded.theme.id,
    themeVersion: loaded.theme.version,
    themeSchemaVersion: loaded.theme.schemaVersion,
    desiredGeneration: options.desiredGeneration,
  } : null;
  const results = [];
  let screenshotCaptured = false;

  for (const { target, session, probe } of connected) {
    try {
      if (options.mode === "remove") await removeFromSession(session);
      else if (options.mode === "once") await applyToSession(session, payload);

      if (options.reload) {
        await session.send("Page.reload", { ignoreCache: true });
        await new Promise((resolve) => setTimeout(resolve, 1600));
        if (options.mode !== "remove") await applyToSession(session, payload);
      }

      const result = options.mode === "remove"
        ? await verifyRemovedSession(session)
        : await waitForVerifiedSession(session, options.timeoutMs, expected);
      results.push({ targetId: target.id, title: target.title, url: target.url, probe, result });

      if (options.screenshot && !screenshotCaptured) {
        await capture(session, options.screenshot);
        screenshotCaptured = true;
      }
    } finally {
      session.close();
    }
  }

  console.log(JSON.stringify({ mode: options.mode, version: SKIN_VERSION, port: options.port, targets: results }, null, 2));
  const failed = results.length === 0 || results.some((item) => options.mode === "remove" ? item.result !== true : !item.result?.pass);
  if (failed) process.exitCode = 2;
}

async function runWatch(options) {
  const { payload } = await loadPayload(options.themeDir, options.desiredGeneration);
  const sessions = new Map();
  const rejected = new Set();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    let targets = [];
    try {
      targets = await listAppTargets(options.port);
    } catch (error) {
      console.error(`[ai-themestore] ${new Date().toISOString()} ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const activeIds = new Set(targets.map((target) => target.id));
    for (const [id, session] of sessions) {
      if (!activeIds.has(id) || session.closed) {
        session.close();
        sessions.delete(id);
      }
    }

    for (const target of targets) {
      if (sessions.has(target.id)) continue;
      let session;
      try {
        session = await connectTarget(target, options.port);
        const probe = await probeSession(session);
        if (!probe?.codex) {
          session.close();
          if (!rejected.has(target.id)) {
            console.error(`[ai-themestore] rejected non-Codex app target ${target.id}`);
            rejected.add(target.id);
          }
          continue;
        }
        rejected.delete(target.id);
        session.on("Page.loadEventFired", () => {
          setTimeout(() => applyToSession(session, payload).catch((error) => {
            console.error(`[ai-themestore] reinject failed: ${error.message}`);
          }), 250);
        });
        await applyToSession(session, payload);
        sessions.set(target.id, session);
        console.log(`[ai-themestore] injected verified Codex target ${target.id} (${target.title || target.url})`);
      } catch (error) {
        session?.close();
        console.error(`[ai-themestore] inject failed for ${target.id}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  for (const session of sessions.values()) session.close();
}

let commandWatchdog;
let forceExitAfterRun = false;
try {
  const options = parseArgs(process.argv.slice(2));
  forceExitAfterRun = options.mode !== "check";
  if (options.mode !== "watch" && options.mode !== "check") {
    const hardTimeoutMs = Math.max(3000, options.timeoutMs + 5000);
    commandWatchdog = setTimeout(() => {
      console.error(`[ai-themestore] ${options.mode} exceeded the hard ${hardTimeoutMs}ms deadline`);
      process.exit(124);
    }, hardTimeoutMs);
  }
  if (options.mode === "check") {
    const loaded = await loadPayload(options.themeDir, options.desiredGeneration);
    console.log(JSON.stringify({
      pass: true,
      version: SKIN_VERSION,
      themeId: loaded.theme.id,
      themeName: loaded.theme.name,
      themeSchemaVersion: loaded.theme.schemaVersion,
      themeVersion: loaded.theme.version,
      themeAuthor: loaded.theme.author,
      heroImage: loaded.theme.assets.hero,
      taskBackground: loaded.theme.assets.taskBackground,
      backgroundMode: loaded.theme.layout.backgroundMode,
      backgroundType: loaded.theme.background.type,
      motionAsset: loaded.theme.background.type === "video" ? loaded.theme.background.source : null,
      sidebarOpacity: loaded.theme.effects.sidebarOpacity,
      sidebarBlur: loaded.theme.effects.sidebarBlur,
      composerMark: loaded.theme.decorations.composerMark,
      composerIcon: loaded.theme.decorations.composerIcon,
      composerMarkStyle: loaded.theme.decorations.composerMarkStyle,
      imageBytes: loaded.imageBytes,
      motionBytes: loaded.motionBytes,
      payloadBytes: Buffer.byteLength(loaded.payload),
    }, null, 2));
  } else if (options.mode === "watch") await runWatch(options);
  else await runOneShot(options);
} catch (error) {
  console.error(`[ai-themestore] ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  if (commandWatchdog) clearTimeout(commandWatchdog);
}
if (forceExitAfterRun) process.exit(process.exitCode ?? 0);
