((cssText, artDataUrl, taskArtDataUrl, motionDataUrl, themeConfig) => {
  const STATE_KEY = "__AI_THEMESTORE_STATE__";
  const DISABLED_KEY = "__AI_THEMESTORE_DISABLED__";
  const STYLE_ID = "ai-themestore-style";
  const CHROME_ID = "ai-themestore-chrome";
  const VIDEO_ID = "ai-themestore-motion";
  const SHELL_ATTR = "data-themestore-shell";
  const COMPOSER_SURFACE_CLASS = "ai-themestore-composer-surface";
  const VERSION = __AI_THEMESTORE_VERSION_JSON__;
  const THEME = themeConfig && typeof themeConfig === "object" ? themeConfig : {};
  const THEME_ICONS = __AI_THEMESTORE_ICONS_JSON__;
  const MARK_GLYPHS = {
    portal: "◉",
    wave: "≋",
    sun: "☼",
    spark: "✦",
    moon: "☾",
    leaf: "◆",
    compass: "✥",
    snow: "❉",
    star: "☆",
    flame: "▲",
    diamond: "◇",
    none: "",
  };
  const composerMark = THEME.decorations?.composerMark || "portal";
  const composerMarkGlyph = MARK_GLYPHS[composerMark] || MARK_GLYPHS.portal;
  const composerIcon = Object.hasOwn(THEME_ICONS, THEME.decorations?.composerIcon)
    ? THEME.decorations.composerIcon
    : "";
  const composerMarkStyle = ["anchor", "notch", "dot", "none"].includes(THEME.decorations?.composerMarkStyle)
    ? THEME.decorations.composerMarkStyle
    : "anchor";
  const THEME_VARIABLES = [
    "--ds-bg", "--ds-panel", "--ds-panel-2", "--ds-green", "--ds-lime",
    "--ds-cyan", "--ds-purple", "--ds-text", "--ds-muted", "--ds-line",
    "--ai-themestore-name", "--ai-themestore-tagline", "--ai-themestore-project-prefix",
    "--ai-themestore-project-label", "--ai-themestore-task-art", "--ds-hero-height",
    "--ds-hero-position", "--ds-task-position", "--ds-content-max-width",
    "--ds-blur", "--ds-panel-opacity", "--ds-panel-mix", "--ds-card-surface-mix",
    "--ds-workspace-surface-mix", "--ds-composer-surface-mix", "--ds-control-surface-blur", "--ds-sidebar-surface-mix", "--ds-shell-radius", "--ds-hero-radius",
    "--ds-card-radius", "--ds-composer-radius", "--ds-composer-mark",
  ];
  window[DISABLED_KEY] = false;

  const renderThemeIcon = (node) => {
    if (!node) return;
    node.replaceChildren();
    const definition = THEME_ICONS[composerIcon];
    if (!definition || !Array.isArray(definition.paths)) {
      node.textContent = composerMarkGlyph;
      return;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.dataset.themeIcon = composerIcon;
    for (const value of definition.paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", value);
      svg.appendChild(path);
    }
    node.appendChild(svg);
  };

  const previous = window[STATE_KEY];
  if (previous?.observer) previous.observer.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.resizeHandler) window.removeEventListener("resize", previous.resizeHandler);
  if (previous?.mediaHandler && previous?.mediaQuery) {
    try { previous.mediaQuery.removeEventListener("change", previous.mediaHandler); } catch {}
  }
  if (previous?.reducedMotionHandler && previous?.reducedMotionQuery) {
    try { previous.reducedMotionQuery.removeEventListener("change", previous.reducedMotionHandler); } catch {}
  }
  if (previous?.visibilityHandler) document.removeEventListener("visibilitychange", previous.visibilityHandler);
  if (previous?.windowActivityHandler) {
    window.removeEventListener("focus", previous.windowActivityHandler);
    window.removeEventListener("blur", previous.windowActivityHandler);
  }
  document.getElementById(VIDEO_ID)?.remove();
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
  if (previous?.taskArtUrl && previous.taskArtUrl !== previous.artUrl) URL.revokeObjectURL(previous.taskArtUrl);
  if (previous?.motionUrl) URL.revokeObjectURL(previous.motionUrl);

  const objectUrl = (dataUrl) => {
    const comma = dataUrl.indexOf(",");
    const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || "image/png";
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };
  const artUrl = objectUrl(artDataUrl);
  const taskArtUrl = taskArtDataUrl === artDataUrl ? artUrl : objectUrl(taskArtDataUrl);
  const motionUrl = motionDataUrl ? objectUrl(motionDataUrl) : null;
  let motionFailed = false;
  let windowActive = document.hasFocus();
  let reducedMotionQuery = null;
  try { reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch {}

  const videoSurfaceAllowed = () => Boolean(
    motionUrl && !motionFailed && THEME.background?.type === "video" &&
    THEME.layout?.backgroundMode === "full" && THEME.effects?.motion === "full" &&
    !reducedMotionQuery?.matches
  );

  const motionAllowed = () => Boolean(
    videoSurfaceAllowed() && !document.hidden && windowActive
  );

  const motionErrorHandler = () => {
    motionFailed = true;
    const video = document.getElementById(VIDEO_ID);
    video?.pause();
    if (document.documentElement) document.documentElement.dataset.themestoreMedia = "poster";
  };

  const syncMotion = (home) => {
    const root = document.documentElement;
    if (!root || !document.body) return;
    const surfaceAllowed = videoSurfaceAllowed();
    const allowed = motionAllowed();
    root.dataset.themestoreMedia = surfaceAllowed ? "video" : "poster";
    let video = document.getElementById(VIDEO_ID);
    if (!motionUrl) {
      video?.remove();
      return;
    }
    if (!video) {
      video = document.createElement("video");
      video.id = VIDEO_ID;
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.poster = artUrl;
      video.src = motionUrl;
      video.setAttribute("aria-hidden", "true");
      video.setAttribute("tabindex", "-1");
      video.addEventListener("error", motionErrorHandler);
      document.body.prepend(video);
    }
    video.style.objectPosition = home
      ? (THEME.layout?.heroPosition || "center center")
      : (THEME.layout?.taskPosition || "center center");
    if (!surfaceAllowed || !allowed) {
      video.pause();
      return;
    }
    const playback = video.play();
    if (playback && typeof playback.catch === "function") playback.catch(motionErrorHandler);
  };

  const cssString = (value) => JSON.stringify(String(value ?? ""));

  const resolveComposerSurface = (scope = document) => {
    const legacy = scope.querySelector(".composer-surface-chrome");
    if (legacy) return legacy;
    const editor = scope.querySelector('[data-codex-composer="true"]');
    const root = editor?.closest?.("[data-codex-composer-root]") ?? null;
    if (!root || !scope.contains(root)) return null;
    const surface = editor.closest?.(
      '[data-composer-surface-variant][data-composer-radius-variant]',
    ) ?? null;
    return surface && root.contains(surface) ? surface : null;
  };

  const parseRgb = (value) => {
    if (!value || value === "transparent") return null;
    const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const number = Number.parseInt(hex[1], 16);
      return { r: number >> 16, g: (number >> 8) & 255, b: number & 255 };
    }
    const m = String(value).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  };

  const luminance = ({ r, g, b }) => {
    const lin = [r, g, b].map((c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };

  /** Detect Codex app light/dark shell for CSS branching. */
  const detectShellMode = () => {
    const root = document.documentElement;
    const body = document.body;
    const cls = `${root.className || ""} ${body?.className || ""}`.toLowerCase();

    if (/\b(dark|theme-dark|appearance-dark)\b/.test(cls)) return "dark";
    if (/\b(light|theme-light|appearance-light)\b/.test(cls)) return "light";

    const dataTheme = (
      root.getAttribute("data-theme") ||
      root.getAttribute("data-appearance") ||
      root.getAttribute("data-color-mode") ||
      body?.getAttribute("data-theme") ||
      body?.getAttribute("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    // Radios in profile menu (if present in DOM)
    const checked = document.querySelector('input[name="appearance-theme"]:checked');
    if (checked) {
      const label = (checked.getAttribute("aria-label") || checked.value || "").toLowerCase();
      if (label.includes("暗") || label.includes("dark")) return "dark";
      if (label.includes("浅") || label.includes("light")) return "light";
      if (label.includes("系统") || label.includes("system")) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
    }

    // Native Codex tokens stay stable after the skin changes backgrounds.
    // A light foreground token means the official shell is dark, and vice versa.
    try {
      const tokenForeground = parseRgb(getComputedStyle(root).getPropertyValue("--color-token-foreground"));
      if (tokenForeground) return luminance(tokenForeground) >= 0.55 ? "dark" : "light";
    } catch {}

    try {
      const cs = getComputedStyle(root).colorScheme || "";
      if (cs.includes("dark") && !cs.includes("light")) return "dark";
      if (cs.includes("light") && !cs.includes("dark")) return "light";
    } catch {}

    // Background luminance of main surfaces
    const samples = [
      body,
      document.querySelector("main.main-surface"),
      document.querySelector("aside.app-shell-left-panel"),
    ].filter(Boolean);
    let votesLight = 0;
    let votesDark = 0;
    for (const el of samples) {
      try {
        const rgb = parseRgb(getComputedStyle(el).backgroundColor);
        if (!rgb) continue;
        const L = luminance(rgb);
        if (L >= 0.55) votesLight += 1;
        else if (L <= 0.25) votesDark += 1;
      } catch {}
    }
    if (votesLight > votesDark) return "light";
    if (votesDark > votesLight) return "dark";

    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    } catch {}
    return "light";
  };

  const applyTheme = (root, shell) => {
    const colors = THEME.colors || {};
    const accent = colors.accent || (shell === "light" ? "#e25563" : "#7cff46");
    const accentAlt = colors.accentAlt || accent;
    const secondary = colors.secondary || (shell === "light" ? "#f3a8af" : "#36d7e8");
    const highlight = colors.highlight || (shell === "light" ? "#c93d4c" : "#642a8c");

    let variables;
    if (shell === "light") {
      // Structural tokens stay light so banners stay readable; accents follow theme.
      variables = {
        "--ds-bg": "#f6f2f3",
        "--ds-panel": "#ffffff",
        "--ds-panel-2": "#fff7f8",
        "--ds-green": accent,
        "--ds-lime": accentAlt,
        "--ds-cyan": secondary,
        "--ds-purple": highlight,
        "--ds-text": "#1f1a1b",
        "--ds-muted": "#6b5f62",
        "--ds-line": colors.line || "rgba(196, 120, 128, .22)",
      };
    } else {
      const darkSurface = (value, fallback, maximum = 0.28) => {
        const rgb = parseRgb(value);
        return rgb && luminance(rgb) <= maximum ? value : fallback;
      };
      const lightText = (value, fallback, minimum = 0.42) => {
        const rgb = parseRgb(value);
        return rgb && luminance(rgb) >= minimum ? value : fallback;
      };
      variables = {
        "--ds-bg": darkSurface(colors.background, "#071116", 0.18),
        "--ds-panel": darkSurface(colors.panel, "#0b1a20", 0.22),
        "--ds-panel-2": darkSurface(colors.panelAlt, "#10272c", 0.28),
        "--ds-green": accent,
        "--ds-lime": accentAlt,
        "--ds-cyan": secondary,
        "--ds-purple": highlight,
        "--ds-text": lightText(colors.text, "#e9fff1", 0.52),
        "--ds-muted": lightText(colors.muted, "#9ebdb3", 0.30),
        "--ds-line": colors.line || "rgba(124, 255, 70, .28)",
      };
    }

    for (const [name, value] of Object.entries(variables)) {
      if (typeof value === "string" && value) root.style.setProperty(name, value);
    }
    root.style.setProperty("--ai-themestore-name", cssString(THEME.name || "AI ThemeStore"));
    root.style.setProperty("--ai-themestore-tagline", cssString(THEME.tagline || "Make something wonderful."));
    root.style.setProperty("--ai-themestore-project-prefix", cssString(THEME.projectPrefix || "选择项目 · "));
    root.style.setProperty("--ai-themestore-project-label", cssString(THEME.projectLabel || "◉  选择项目"));
    root.style.setProperty("--ds-hero-height", `${THEME.layout?.heroHeight || 272}px`);
    root.style.setProperty("--ds-hero-position", THEME.layout?.heroPosition || "right center");
    root.style.setProperty("--ds-task-position", THEME.layout?.taskPosition || "76% center");
    root.style.setProperty("--ds-content-max-width", `${THEME.layout?.contentMaxWidth || 980}px`);
    root.style.setProperty("--ds-blur", `${THEME.effects?.blur ?? 14}px`);
    const panelOpacity = THEME.effects?.panelOpacity ?? 0.72;
    const homeSurfaceOpacity = THEME.effects?.homeSurfaceOpacity ?? 0.5;
    const controlSurfaceOpacity = THEME.effects?.controlSurfaceOpacity ?? 0.54;
    const controlSurfaceBlur = THEME.effects?.controlSurfaceBlur ?? 18;
    const sidebarOpacity = THEME.effects?.sidebarOpacity ?? 0.5;
    const sidebarBlur = THEME.effects?.sidebarBlur ?? 0;
    root.style.setProperty("--ds-panel-opacity", String(panelOpacity));
    root.style.setProperty("--ds-panel-mix", `${Math.round(panelOpacity * 100)}%`);
    root.style.setProperty("--ds-card-surface-mix", `${Math.round(homeSurfaceOpacity * 100)}%`);
    root.style.setProperty("--ds-workspace-surface-mix", `${Math.round(controlSurfaceOpacity * 100)}%`);
    root.style.setProperty("--ds-composer-surface-mix", `${Math.round(controlSurfaceOpacity * 100)}%`);
    root.style.setProperty("--ds-control-surface-blur", `${controlSurfaceBlur}px`);
    root.style.setProperty("--ds-sidebar-surface-mix", `${Math.round(sidebarOpacity * 100)}%`);
    root.style.setProperty("--ds-sidebar-surface-blur", `${sidebarBlur}px`);
    root.style.setProperty("--ds-background-dim", String(THEME.effects?.backgroundDim ?? 0));
    root.style.setProperty("--ds-shell-radius", `${THEME.effects?.shellRadius ?? 17}px`);
    root.style.setProperty("--ds-hero-radius", `${THEME.effects?.heroRadius ?? 22}px`);
    root.style.setProperty("--ds-card-radius", `${THEME.effects?.cardRadius ?? 18}px`);
    root.style.setProperty("--ds-composer-radius", `${THEME.effects?.composerRadius ?? 21}px`);
    root.style.setProperty("--ds-composer-mark", cssString(composerMarkGlyph));
    root.dataset.themestoreBackground = THEME.layout?.backgroundMode || "full";
    root.dataset.themestoreSidebarFrost = sidebarBlur > 0 ? "frosted" : "clear";
    root.dataset.themestoreParticles = THEME.decorations?.particles || "soft";
    root.dataset.themestoreMotion = THEME.effects?.motion || "full";
    root.dataset.themestoreMark = composerMark;
    root.dataset.themestoreIcon = composerIcon || composerMark;
    root.dataset.themestoreMarkStyle = composerMark === "none" ? "none" : composerMarkStyle;
  };

  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.aiThemeStoreVersion = VERSION;
  }

  const ensure = () => {
    if (window[DISABLED_KEY]) return;
    const root = document.documentElement;
    if (!root) return;
    const shell = detectShellMode();
    root.classList.add("ai-themestore");
    root.setAttribute(SHELL_ATTR, shell);
    root.style.setProperty("--ai-themestore-art", `url("${artUrl}")`);
    root.style.setProperty("--ai-themestore-task-art", `url("${taskArtUrl}")`);
    applyTheme(root, shell);

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.aiThemeStoreVersion !== VERSION) {
      style.textContent = cssText;
      style.dataset.aiThemeStoreVersion = VERSION;
    }

    const composerSurfaces = new Set(document.querySelectorAll(".composer-surface-chrome"));
    for (const root of document.querySelectorAll("[data-codex-composer-root]")) {
      const surface = resolveComposerSurface(root);
      if (surface) composerSurfaces.add(surface);
    }
    for (const candidate of document.querySelectorAll(`.${COMPOSER_SURFACE_CLASS}`)) {
      if (!composerSurfaces.has(candidate)) candidate.classList.remove(COMPOSER_SURFACE_CLASS);
    }
    for (const composer of composerSurfaces) composer.classList.add(COMPOSER_SURFACE_CLASS);

    const nativeShellMain = document.querySelector("main.main-surface:not(.ai-themestore-main-compat)");
    const shellMain = document.querySelector('main[data-app-shell-main-surface]') ||
      nativeShellMain ||
      [...document.querySelectorAll("main")].find((candidate) =>
        !candidate.closest('[aria-hidden="true"], [inert], .invisible')) || null;
    for (const candidate of document.querySelectorAll("main.ai-themestore-main-compat")) {
      if (candidate === shellMain) continue;
      candidate.classList.remove("ai-themestore-main-compat", "main-surface");
    }
    if (shellMain && !nativeShellMain) {
      // New Codex shells expose a semantic main-surface attribute but no longer
      // retain the legacy class. Keep the locked theme CSS scoped to that shell.
      shellMain.classList.add("ai-themestore-main-compat", "main-surface");
    }
    const toolPaneClass = "ai-themestore-tool-pane";
    const toolPane = document.querySelector('aside[data-app-shell-focus-area="right-panel"]');
    for (const candidate of document.querySelectorAll(`.${toolPaneClass}`)) {
      if (candidate !== toolPane) candidate.classList.remove(toolPaneClass);
    }
    toolPane?.classList.add(toolPaneClass);
    const chatPaneClass = "ai-themestore-chat-pane";
    const chatPanes = new Set();
    if (shellMain) {
      for (const candidate of shellMain.querySelectorAll("aside")) {
        if (candidate.matches("aside.app-shell-left-panel")) continue;
        if (!candidate.querySelector(".thread-scroll-container")) continue;
        if (!resolveComposerSurface(candidate)) continue;
        chatPanes.add(candidate);
        candidate.classList.add(chatPaneClass);
      }
    }
    for (const candidate of document.querySelectorAll(`.${chatPaneClass}`)) {
      if (!chatPanes.has(candidate)) candidate.classList.remove(chatPaneClass);
    }
    const roleMains = [...document.querySelectorAll('[role="main"]')];
    const homeIndicator = document.querySelector('[data-testid="home-icon"]');
    const modernHome = roleMains.find((candidate) =>
      candidate.querySelector('[data-home-ambient-suggestions]') &&
      candidate.querySelector('[data-codex-composer="true"]')) || null;
    const home = homeIndicator?.closest('[role="main"]') || modernHome ||
      roleMains.find((candidate) =>
        candidate.querySelector('[data-feature="game-source"]') &&
        candidate.querySelector('.group\\\\/home-suggestions')) || null;
    const modernClasses = [
      "ai-themestore-home-v2",
      "ai-themestore-home-banner-slot",
      "ai-themestore-home-layout",
      "ai-themestore-home-intro",
      "ai-themestore-home-panel",
      "ai-themestore-home-hero",
      "ai-themestore-home-suggestions",
      "ai-themestore-home-controls",
    ];
    for (const className of modernClasses) {
      for (const candidate of document.querySelectorAll(`.${className}`)) {
        candidate.classList.remove(className);
      }
    }
    for (const candidate of document.querySelectorAll('[role="main"].ai-themestore-home')) {
      if (candidate !== home) candidate.classList.remove("ai-themestore-home");
    }
    if (home) {
      home.classList.add("ai-themestore-home");
      if (home === modernHome) {
        const composer = resolveComposerSurface(home);
        const heading = home.querySelector(".heading-xl");
        const directChildContaining = (parent, descendant) => {
          let node = descendant;
          while (node && node.parentElement !== parent) node = node.parentElement;
          return node?.parentElement === parent ? node : null;
        };
        const layout = directChildContaining(home, composer);
        const intro = layout ? directChildContaining(layout, heading) : null;
        const controls = layout ? directChildContaining(layout, composer) : null;
        const hero = heading?.closest(".flex.min-h-28") || null;
        const panel = hero?.parentElement || null;
        const suggestions = panel
          ? [...panel.children].find((candidate) => candidate !== hero) || null
          : null;

        home.classList.add("ai-themestore-home-v2");
        if (home.firstElementChild && home.firstElementChild !== layout) {
          home.firstElementChild.classList.add("ai-themestore-home-banner-slot");
        }
        layout?.classList.add("ai-themestore-home-layout");
        intro?.classList.add("ai-themestore-home-intro");
        panel?.classList.add("ai-themestore-home-panel");
        hero?.classList.add("ai-themestore-home-hero");
        suggestions?.classList.add("ai-themestore-home-suggestions");
        controls?.classList.add("ai-themestore-home-controls");
      }
    }
    const homeTopFadeClass = "ai-themestore-home-top-fade";
    for (const candidate of document.querySelectorAll(`.${homeTopFadeClass}`)) {
      candidate.classList.remove(homeTopFadeClass);
    }
    if (home && shellMain) {
      shellMain.querySelector('[class*="_MainContentTopFade_"]')?.classList.add(homeTopFadeClass);
    }
    for (const hint of document.querySelectorAll(".ai-themestore-project-hint")) {
      if (!home?.contains(hint)) hint.remove();
    }
    const projectUtilityClass = "ai-themestore-project-utility";
    for (const candidate of document.querySelectorAll(`.${projectUtilityClass}`)) {
      candidate.classList.remove(projectUtilityClass);
    }
    if (home) {
      for (const scrollArea of home.querySelectorAll("[data-composer-utility-bar-scroll-area]")) {
        const projectSelector = scrollArea.querySelector(".group\\/project-selector") ??
          scrollArea.querySelector('[data-composer-navigation-target="workspace-project"]');
        if (!projectSelector) continue;
        const utilityBar = scrollArea.parentElement;
        if (!utilityBar) continue;
        utilityBar.classList.add(projectUtilityClass);
        let hint = utilityBar.querySelector(":scope > .ai-themestore-project-hint");
        if (!hint) {
          hint = document.createElement("span");
          hint.className = "ai-themestore-project-hint";
          hint.setAttribute("aria-hidden", "true");
          utilityBar.insertBefore(hint, scrollArea);
        }
        hint.textContent = THEME.projectLabel || "◉  选择项目";
      }
    }
    syncMotion(Boolean(home));

    if (!shellMain || !document.body) return;
    for (const composer of document.querySelectorAll(`.${COMPOSER_SURFACE_CLASS}`)) {
      let signature = composer.querySelector(":scope > .ai-themestore-composer-signature");
      if (!signature) {
        signature = document.createElement("span");
        signature.className = "ai-themestore-composer-signature";
        signature.setAttribute("aria-hidden", "true");
        composer.appendChild(signature);
      }
      renderThemeIcon(signature);

      let quote = composer.querySelector(":scope > .ai-themestore-composer-quote");
      if (!quote) {
        quote = document.createElement("span");
        quote.className = "ai-themestore-composer-quote";
        quote.setAttribute("aria-hidden", "true");
        composer.appendChild(quote);
      }
      quote.textContent = THEME.quote || "MAKE SOMETHING WONDERFUL";
      const editorHasText = Boolean(composer.querySelector(".ProseMirror")?.textContent?.trim());
      quote.hidden = !home || THEME.decorations?.quote === false || editorHasText;

      let orbit = composer.querySelector(":scope > .ai-themestore-composer-orbit");
      if (!orbit) {
        orbit = document.createElement("span");
        orbit.className = "ai-themestore-composer-orbit";
        orbit.setAttribute("aria-hidden", "true");
        composer.appendChild(orbit);
      }
      orbit.hidden = !home || THEME.decorations?.orbit === false;
    }
    shellMain.classList.toggle("ai-themestore-home-shell", Boolean(home));
    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      chrome.innerHTML = `
        <div class="ai-themestore-brand">
          <span class="ai-themestore-portal-mark">◉</span>
          <span><b></b><small></small></span>
        </div>
        <div class="ai-themestore-status"><i></i><span></span></div>
        <div class="ai-themestore-particles"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
      document.body.appendChild(chrome);
    }
    chrome.querySelector(".ai-themestore-quote")?.remove();
    chrome.querySelector(".ai-themestore-orbit")?.remove();
    chrome.querySelector(".ai-themestore-brand b").textContent = THEME.name || "AI ThemeStore";
    chrome.querySelector(".ai-themestore-brand small").textContent = THEME.brandSubtitle || "AI THEMESTORE";
    renderThemeIcon(chrome.querySelector(".ai-themestore-portal-mark"));
    chrome.querySelector(".ai-themestore-status span").textContent = THEME.statusText || "AI THEMESTORE ONLINE";
    chrome.querySelector(".ai-themestore-brand").hidden = THEME.decorations?.brand === false;
    chrome.querySelector(".ai-themestore-status").hidden = THEME.decorations?.status === false;
    const shellBox = shellMain.getBoundingClientRect();
    chrome.style.left = `${Math.round(shellBox.left)}px`;
    chrome.style.top = `${Math.round(shellBox.top)}px`;
    chrome.style.width = `${Math.round(shellBox.width)}px`;
    chrome.style.height = `${Math.round(shellBox.height)}px`;
    chrome.classList.toggle("ai-themestore-home-shell", Boolean(home));
    chrome.dataset.themestoreShell = shell;
  };

  const cleanup = () => {
    window[DISABLED_KEY] = true;
    document.documentElement?.classList.remove("ai-themestore");
    document.documentElement?.removeAttribute(SHELL_ATTR);
    delete document.documentElement?.dataset.themestoreParticles;
    delete document.documentElement?.dataset.themestoreBackground;
    delete document.documentElement?.dataset.themestoreMotion;
    delete document.documentElement?.dataset.themestoreMedia;
    delete document.documentElement?.dataset.themestoreMark;
    delete document.documentElement?.dataset.themestoreMarkStyle;
    document.documentElement?.style.removeProperty("--ai-themestore-art");
    for (const name of THEME_VARIABLES) document.documentElement?.style.removeProperty(name);
    document.querySelectorAll(".ai-themestore-home").forEach((node) => node.classList.remove("ai-themestore-home"));
    document.querySelectorAll(".ai-themestore-home-shell").forEach((node) => node.classList.remove("ai-themestore-home-shell"));
    document.querySelectorAll(".ai-themestore-home-top-fade").forEach((node) => node.classList.remove("ai-themestore-home-top-fade"));
    document.querySelectorAll(".ai-themestore-chat-pane").forEach((node) => node.classList.remove("ai-themestore-chat-pane"));
    document.querySelectorAll(".ai-themestore-tool-pane").forEach((node) => node.classList.remove("ai-themestore-tool-pane"));
    document.querySelectorAll(`.${COMPOSER_SURFACE_CLASS}`).forEach((node) => {
      node.classList.remove(COMPOSER_SURFACE_CLASS);
    });
    document.querySelectorAll("main.ai-themestore-main-compat").forEach((node) => {
      node.classList.remove("ai-themestore-main-compat", "main-surface");
    });
    document.querySelectorAll(
      ".ai-themestore-home-v2, .ai-themestore-home-banner-slot, .ai-themestore-home-layout, " +
      ".ai-themestore-home-intro, .ai-themestore-home-panel, .ai-themestore-home-hero, " +
      ".ai-themestore-home-suggestions, .ai-themestore-home-controls",
    ).forEach((node) => {
      node.classList.remove(
        "ai-themestore-home-v2",
        "ai-themestore-home-banner-slot",
        "ai-themestore-home-layout",
        "ai-themestore-home-intro",
        "ai-themestore-home-panel",
        "ai-themestore-home-hero",
        "ai-themestore-home-suggestions",
        "ai-themestore-home-controls",
      );
    });
    document.querySelectorAll(
      ".ai-themestore-composer-signature, .ai-themestore-composer-quote, " +
      ".ai-themestore-composer-orbit, .ai-themestore-project-hint",
    ).forEach((node) => node.remove());
    document.querySelectorAll(".ai-themestore-project-utility").forEach((node) => {
      node.classList.remove("ai-themestore-project-utility");
    });
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
    const motionVideo = document.getElementById(VIDEO_ID);
    motionVideo?.pause();
    motionVideo?.removeEventListener("error", motionErrorHandler);
    motionVideo?.remove();
    const state = window[STATE_KEY];
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
    if (state?.mediaHandler && state?.mediaQuery) {
      try { state.mediaQuery.removeEventListener("change", state.mediaHandler); } catch {}
    }
    if (state?.reducedMotionHandler && state?.reducedMotionQuery) {
      try { state.reducedMotionQuery.removeEventListener("change", state.reducedMotionHandler); } catch {}
    }
    if (state?.visibilityHandler) document.removeEventListener("visibilitychange", state.visibilityHandler);
    if (state?.windowActivityHandler) {
      window.removeEventListener("focus", state.windowActivityHandler);
      window.removeEventListener("blur", state.windowActivityHandler);
    }
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    if (state?.taskArtUrl && state.taskArtUrl !== state.artUrl) URL.revokeObjectURL(state.taskArtUrl);
    if (state?.motionUrl) URL.revokeObjectURL(state.motionUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 180);
  };
  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-appearance", "data-color-mode", "style"],
  });
  const timer = setInterval(ensure, 4000);
  const resizeHandler = scheduleEnsure;
  window.addEventListener("resize", resizeHandler, { passive: true });

  let mediaQuery = null;
  let mediaHandler = null;
  try {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaHandler = () => scheduleEnsure();
    mediaQuery.addEventListener("change", mediaHandler);
  } catch {}
  const reducedMotionHandler = () => scheduleEnsure();
  try { reducedMotionQuery?.addEventListener("change", reducedMotionHandler); } catch {}
  const visibilityHandler = () => scheduleEnsure();
  document.addEventListener("visibilitychange", visibilityHandler);
  const windowActivityHandler = (event) => {
    windowActive = event.type === "focus";
    scheduleEnsure();
  };
  window.addEventListener("focus", windowActivityHandler);
  window.addEventListener("blur", windowActivityHandler);

  window[STATE_KEY] = {
    ensure,
    cleanup,
    observer,
    timer,
    scheduler,
    resizeHandler,
    mediaQuery,
    mediaHandler,
    reducedMotionQuery,
    reducedMotionHandler,
    visibilityHandler,
    windowActivityHandler,
    artUrl,
    taskArtUrl,
    motionUrl,
    version: VERSION,
    themeId: THEME.id || "custom",
    themeVersion: THEME.version || "1.0.0",
    themeSchemaVersion: THEME.schemaVersion || 1,
    desiredGeneration: Number.isSafeInteger(THEME.desiredGeneration) ? THEME.desiredGeneration : 0,
    detectShellMode,
  };
  ensure();
  return {
    installed: true,
    version: VERSION,
    themeId: THEME.id || "custom",
    themeVersion: THEME.version || "1.0.0",
    themeSchemaVersion: THEME.schemaVersion || 1,
    desiredGeneration: Number.isSafeInteger(THEME.desiredGeneration) ? THEME.desiredGeneration : 0,
    shell: detectShellMode(),
  };
})(__AI_THEMESTORE_CSS_JSON__, __AI_THEMESTORE_ART_JSON__, __AI_THEMESTORE_TASK_ART_JSON__, __AI_THEMESTORE_MOTION_JSON__, __AI_THEMESTORE_THEME_JSON__)
