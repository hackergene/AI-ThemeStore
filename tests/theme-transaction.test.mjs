import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { abortThemeTransaction, commitThemeTransaction, prepareThemeTransaction } from "../engine/scripts/theme-transaction.mjs";
import { readStrictJson } from "../engine/scripts/state-store.mjs";

const productRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ai-themestore-transaction-"));
const stateRoot = path.join(temporary, "state");
const active = path.join(stateRoot, "theme");
const sourceA = path.join(productRoot, "themes", "minimal-glass");
const sourceB = path.join(productRoot, "themes", "cyber-neon");

try {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.cp(sourceA, active, { recursive: true });
  await fs.writeFile(path.join(stateRoot, "state.json"), "{}\n");
  const { migrateLegacyState } = await import("../engine/scripts/state-store.mjs");
  await migrateLegacyState(stateRoot);

  const prepared = await prepareThemeTransaction(stateRoot, sourceB);
  assert.equal((await readStrictJson(path.join(active, "theme.json"))).id, "minimal-glass");
  assert.equal((await readStrictJson(path.join(prepared.stagedPath, "theme.json"))).id, "cyber-neon");
  const committed = await commitThemeTransaction(stateRoot, prepared.id);
  assert.equal(committed.status, "committed");
  assert.equal((await readStrictJson(path.join(active, "theme.json"))).id, "cyber-neon");
  assert.equal((await readStrictJson(path.join(stateRoot, "rollback", "theme.json"))).id, "minimal-glass");
  const desired = await readStrictJson(path.join(stateRoot, "desired-state.json"));
  assert.equal(desired.desiredTheme.id, "cyber-neon");
  assert.equal(desired.lastKnownGoodTheme.id, "minimal-glass");

  const rejected = path.join(temporary, "rejected");
  await fs.cp(sourceA, rejected, { recursive: true });
  await fs.rm(path.join(rejected, "hero.png"));
  await fs.symlink(path.join(sourceA, "hero.png"), path.join(rejected, "hero.png"));
  await assert.rejects(prepareThemeTransaction(stateRoot, rejected), /symlink rejected/);
  assert.equal((await readStrictJson(path.join(active, "theme.json"))).id, "cyber-neon");
  assert.deepEqual(await fs.readdir(path.join(stateRoot, "staging")), []);

  const avifSource = path.join(temporary, "downloaded-avif");
  await fs.mkdir(avifSource);
  const avifTheme = await readStrictJson(path.join(sourceA, "theme.json"));
  avifTheme.assets = { hero: "hero.avif", taskBackground: "hero.avif" };
  await fs.writeFile(path.join(avifSource, "theme.json"), `${JSON.stringify(avifTheme, null, 2)}\n`, { mode: 0o600 });
  await fs.copyFile(path.join(sourceA, "hero.w1200.avif"), path.join(avifSource, "hero.avif"));
  const downloaded = await prepareThemeTransaction(stateRoot, avifSource);
  assert.equal(downloaded.theme.id, "minimal-glass");
  assert.equal((await readStrictJson(path.join(downloaded.stagedPath, "theme.json"))).assets.hero, "hero.avif");
  await abortThemeTransaction(stateRoot, downloaded.id);

  const aborted = await prepareThemeTransaction(stateRoot, sourceA);
  await abortThemeTransaction(stateRoot, aborted.id);
  assert.equal((await readStrictJson(path.join(active, "theme.json"))).id, "cyber-neon");

  for (const phase of ["active", "rollback", "desired"]) {
    const interrupted = await prepareThemeTransaction(stateRoot, sourceA);
    await assert.rejects(commitThemeTransaction(stateRoot, interrupted.id, { failAfter: phase }), /injected commit failure/);
    assert.equal((await readStrictJson(path.join(active, "theme.json"))).id, "cyber-neon");
    assert.equal((await readStrictJson(path.join(stateRoot, "rollback", "theme.json"))).id, "minimal-glass");
    assert.equal((await readStrictJson(path.join(stateRoot, "desired-state.json"))).desiredTheme.id, "cyber-neon");
  }

  const safe = await prepareThemeTransaction(stateRoot, sourceA);
  const safeResult = await abortThemeTransaction(stateRoot, safe.id, { rollbackSucceeded: false });
  assert.equal(safeResult.status, "safe_mode");
  assert.equal((await readStrictJson(path.join(stateRoot, "desired-state.json"))).safeMode, true);

  console.log("PASS: theme staging, atomic promotion, rollback preservation, and native safe mode.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
