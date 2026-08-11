import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { migrateLegacyState, readStrictJson } from "../engine/scripts/state-store.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ai-themestore-attempts-"));
const stateRoot = path.join(temporary, "state");
const script = path.join(root, "engine", "scripts", "recovery-attempts.mjs");

function call(...args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  await fs.mkdir(path.join(stateRoot, "theme"), { recursive: true });
  await fs.cp(path.join(root, "themes", "minimal-glass", "theme.json"), path.join(stateRoot, "theme", "theme.json"));
  await fs.cp(path.join(root, "themes", "minimal-glass", "hero.png"), path.join(stateRoot, "theme", "hero.png"));
  await fs.writeFile(path.join(stateRoot, "state.json"), "{}\n");
  await migrateLegacyState(stateRoot);

  assert.equal(call("claim", "--state-root", stateRoot, "--key", "v1|pid1|start1|gen1").claimed, true);
  assert.equal(call("claim", "--state-root", stateRoot, "--key", "v1|pid1|start1|gen1").claimed, false);
  assert.equal(call("finish", "--state-root", stateRoot, "--key", "v1|pid1|start1|gen1", "--outcome", "failure").safeMode, false);
  assert.equal(call("claim", "--state-root", stateRoot, "--key", "v1|pid2|start2|gen1").claimed, true);
  assert.equal(call("finish", "--state-root", stateRoot, "--key", "v1|pid2|start2|gen1", "--outcome", "failure").safeMode, true);
  assert.equal((await readStrictJson(path.join(stateRoot, "desired-state.json"))).safeMode, true);
  console.log("PASS: recovery attempts are idempotent and two failures enable safe mode.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
