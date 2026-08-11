import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { REASON, STATUS } from "../engine/scripts/state-contract.mjs";
import {
  conflictingInjectorPids,
  inspectRuntimeHealth,
  rendererVerificationMatches,
} from "../engine/scripts/runtime-health.mjs";
import { atomicWriteJson, migrateLegacyState, readStrictJson, statePaths } from "../engine/scripts/state-store.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ai-themestore-health-"));
const stateRoot = path.join(temporary, "state");

try {
  await fs.mkdir(path.join(stateRoot, "theme"), { recursive: true });
  await fs.cp(path.join(root, "themes", "minimal-glass", "theme.json"), path.join(stateRoot, "theme", "theme.json"));
  await fs.cp(path.join(root, "themes", "minimal-glass", "hero.png"), path.join(stateRoot, "theme", "hero.png"));
  await fs.writeFile(path.join(stateRoot, "state.json"), "{}\n");
  await migrateLegacyState(stateRoot);
  const paths = statePaths(stateRoot);
  const desired = await readStrictJson(paths.desired);
  const now = new Date().toISOString();
  await atomicWriteJson(paths.runtime, {
    schemaVersion: 2,
    app: "codex",
    profileId: "default",
    adapterId: "codex-restricted-v1",
    desiredGeneration: desired.generation,
    hostVersion: "999.0",
    codexBundle: "/Applications/不存在.app",
    codexExe: `/bin/false; touch ${path.join(temporary, "must-not-run")}`,
    codexTeamId: "TEAM",
    codexPid: 999999,
    codexStartedAt: "Sat Jan  1 00:00:00 2000",
    port: 9341,
    injectorPid: 999998,
    injectorStartedAt: "Sat Jan  1 00:00:00 2000",
    injectorPath: "/tmp/injector.mjs",
    themeDir: path.join(stateRoot, "theme"),
    verifiedThemeId: desired.desiredTheme.id,
    verifiedThemeVersion: desired.desiredTheme.version,
    verifiedRoutes: ["home", "task"],
    status: "healthy",
    runtimeVerified: true,
    action: "applied",
    reasonCode: "runtime_verified",
    evidenceAt: now,
    updatedAt: now,
  });
  const result = await inspectRuntimeHealth(stateRoot);
  assert.equal(result.status, STATUS.PENDING);
  assert.equal(result.runtimeVerified, false);
  assert.equal(result.reasonCode, REASON.CODEX_PROCESS_MISSING);
  await assert.rejects(fs.access(path.join(temporary, "must-not-run")));

  const runtimeIdentity = {
    injectorPid: 410,
    injectorPath: "/Applications/AI ThemeStore.app/Contents/Resources/engine/scripts/injector.mjs",
    port: 9341,
    desiredGeneration: 116,
    verifiedThemeId: "azure-lotus-dharma",
    verifiedThemeVersion: "1.1.1",
  };
  const processes = [
    `410 /node ${runtimeIdentity.injectorPath} --watch --port 9341 --theme-dir /state/current`,
    `411 /node ${runtimeIdentity.injectorPath} --watch --port 9341 --theme-dir /state/obsolete`,
    "412 /node /tmp/unrelated-injector.mjs --watch --port 9444 --theme-dir /state/other",
  ].join("\n");
  assert.deepEqual(conflictingInjectorPids(processes, runtimeIdentity), [411]);

  const verification = (themeId, generation = 116) => JSON.stringify({
    targets: [{
      targetId: "codex",
      result: {
        installed: true,
        stylePresent: true,
        chromePresent: true,
        themeId,
        themeVersion: themeId === "azure-lotus-dharma" ? "1.1.1" : "1.0.2",
        desiredGeneration: generation,
      },
    }],
  });
  assert.equal(rendererVerificationMatches(
    verification("azure-lotus-dharma"),
    runtimeIdentity,
  ), true);
  assert.equal(rendererVerificationMatches(
    verification("afterglow-hoops", 115),
    runtimeIdentity,
  ), false);
  console.log("PASS: partial live evidence still requires process identity; stale and malicious state cannot report verified or execute.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
