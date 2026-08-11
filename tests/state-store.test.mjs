import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { REASON, STATUS } from "../engine/scripts/state-contract.mjs";
import {
  enableSafeMode,
  migrateLegacyState,
  prepareManualRecovery,
  readStrictJson,
  setNative,
  setPaused,
  statePaths,
  structuredStatus,
  themeMetadata,
} from "../engine/scripts/state-store.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ai-themestore-state-"));

async function fixture(name) {
  const stateRoot = path.join(temporary, name);
  const active = path.join(stateRoot, "theme");
  await fs.mkdir(active, { recursive: true });
  const theme = {
    schemaVersion: 2,
    id: "arcane-observatory",
    name: "秘法观星台 / 夜空 ✨",
    version: "1.0.0",
    assets: { hero: "hero.png", taskBackground: "hero.png" },
  };
  await fs.writeFile(path.join(active, "theme.json"), `${JSON.stringify(theme, null, 2)}\n`, { mode: 0o600 });
  await fs.copyFile(path.join(root, "themes", "minimal-glass", "hero.png"), path.join(active, "hero.png"));
  const marker = path.join(temporary, `${name}-must-not-run`);
  const legacy = {
    schemaVersion: 4,
    codexVersion: "26.7 中文 β",
    codexPid: 999999,
    injectorPid: 888888,
    injectorStartedAt: `$(touch ${marker})`,
    port: 9341,
    unrelated: { keep: "原样保留 / special ' \" $()" },
  };
  const legacyBytes = Buffer.from(`${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(stateRoot, "state.json"), legacyBytes, { mode: 0o600 });
  return { stateRoot, legacyBytes, marker, theme };
}

try {
  const first = await fixture("success");
  const result = await migrateLegacyState(first.stateRoot);
  assert.equal(result.migrated, true);
  assert.equal(result.desired.desiredTheme.id, "arcane-observatory");
  assert.equal(result.desired.lastKnownGoodTheme, null);
  assert.equal(result.runtime.status, STATUS.PENDING);
  assert.equal(result.runtime.runtimeVerified, false);
  assert.equal(result.runtime.reasonCode, REASON.LEGACY_RUNTIME_UNVERIFIED);
  assert.equal(await fs.readFile(path.join(result.backup, "state.json")).then((value) => value.equals(first.legacyBytes)), true);
  assert.deepEqual(await readStrictJson(path.join(result.backup, "theme", "theme.json")), first.theme);
  await assert.rejects(fs.access(first.marker));

  const paths = statePaths(first.stateRoot);
  const desiredBytes = await fs.readFile(paths.desired);
  await fs.rm(paths.runtime);
  const missingRuntime = await structuredStatus(first.stateRoot);
  assert.equal(missingRuntime.status, STATUS.PENDING);
  assert.equal(missingRuntime.reasonCode, REASON.RUNTIME_EVIDENCE_MISSING);
  assert.equal(missingRuntime.lastThemeId, null);
  assert.equal((await fs.readFile(paths.desired)).equals(desiredBytes), true);

  const secondRun = await migrateLegacyState(first.stateRoot);
  assert.equal(secondRun.migrated, false);

  await setPaused(first.stateRoot, true);
  await enableSafeMode(first.stateRoot);
  const beforeRecovery = await readStrictJson(paths.desired);
  const recovered = await prepareManualRecovery(first.stateRoot);
  assert.equal(recovered.paused, false);
  assert.equal(recovered.safeMode, false);
  assert.deepEqual(recovered.desiredTheme, beforeRecovery.desiredTheme);
  assert.equal(recovered.generation, beforeRecovery.generation + 1);

  const native = await setNative(first.stateRoot);
  assert.equal(native.desiredTheme.id, "native");
  assert.equal(native.lastKnownGoodTheme.id, "arcane-observatory");
  const nativeStatus = await structuredStatus(first.stateRoot);
  assert.equal(nativeStatus.status, STATUS.HEALTHY);
  assert.equal(nativeStatus.desiredThemeId, "native");
  assert.equal(nativeStatus.lastThemeId, "arcane-observatory");

  const identityRoot = path.join(temporary, "desktop-identity");
  await fs.mkdir(identityRoot, { recursive: true });
  const legacyDesired = { ...result.desired, schemaVersion: 1, platformId: "codex-desktop" };
  delete legacyDesired.app;
  const legacyRuntime = { ...result.runtime, schemaVersion: 1, platformId: "codex-desktop" };
  delete legacyRuntime.app;
  await fs.writeFile(path.join(identityRoot, "desired-state.json"), `${JSON.stringify(legacyDesired)}\n`);
  await fs.writeFile(path.join(identityRoot, "runtime-state.json"), `${JSON.stringify(legacyRuntime)}\n`);
  const identityMigration = await migrateLegacyState(identityRoot);
  assert.equal(identityMigration.migrated, true);
  assert.equal(identityMigration.reasonCode, "app_identity_migrated");
  assert.equal((await readStrictJson(path.join(identityRoot, "desired-state.json"))).app, "codex");
  assert.equal((await readStrictJson(path.join(identityRoot, "runtime-state.json"))).app, "codex");

  for (const phase of ["backup", "desired", "runtime"]) {
    const item = await fixture(`failure-${phase}`);
    const activeBefore = await fs.readFile(path.join(item.stateRoot, "theme", "theme.json"));
    await assert.rejects(migrateLegacyState(item.stateRoot, { failAfter: phase }), /injected migration failure/);
    await assert.rejects(fs.access(path.join(item.stateRoot, "desired-state.json")));
    await assert.rejects(fs.access(path.join(item.stateRoot, "runtime-state.json")));
    assert.equal((await fs.readFile(path.join(item.stateRoot, "state.json"))).equals(item.legacyBytes), true);
    assert.equal((await fs.readFile(path.join(item.stateRoot, "theme", "theme.json"))).equals(activeBefore), true);
  }

  const invalidRoot = path.join(temporary, "invalid-utf8");
  await fs.mkdir(invalidRoot, { recursive: true });
  await fs.writeFile(path.join(invalidRoot, "state.json"), Buffer.from([0xc3, 0x28]));
  await assert.rejects(migrateLegacyState(invalidRoot), /strict UTF-8/);

  const motionRoot = path.join(temporary, "motion-theme");
  await fs.mkdir(motionRoot);
  const motionTheme = {
    schemaVersion: 2,
    id: "motion-test",
    name: "Motion test",
    version: "1.0.0",
    assets: { hero: "hero.png", taskBackground: "hero.png" },
    layout: { backgroundMode: "full" },
    effects: { motion: "full" },
    background: { type: "video", poster: "hero.png", source: "background.mp4", playback: "loop-muted" },
  };
  await fs.writeFile(path.join(motionRoot, "theme.json"), `${JSON.stringify(motionTheme)}\n`, { mode: 0o600 });
  await fs.copyFile(path.join(root, "themes", "minimal-glass", "hero.png"), path.join(motionRoot, "hero.png"));
  await fs.writeFile(path.join(motionRoot, "background.mp4"), Buffer.concat([
    Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(12),
  ]), { mode: 0o600 });
  assert.deepEqual(await themeMetadata(motionRoot), { id: "motion-test", version: "1.0.0" });
  await fs.writeFile(path.join(motionRoot, "background.mp4"), Buffer.alloc(24));
  await assert.rejects(themeMetadata(motionRoot), /not an MP4/);

  console.log("PASS: desired/runtime migration, strict UTF-8, dynamic themes, rollback, and stale evidence contract.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
