import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyThemeRoutes } from "../engine/scripts/verify-theme-routes.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ai-themestore-route-gate-"));

function result(homeRoute) {
  return {
    pass: true,
    homeRoute,
    homePresent: homeRoute,
    themeId: "route-test",
    themeVersion: "1.2.3",
    themeSchemaVersion: 2,
    desiredGeneration: 7,
    viewport: { width: 1920, height: 1050 },
    visualBaseline: { pass: true },
    readability: { pass: true },
    signature: { pass: true },
    composerDecorations: { pass: true },
    projectUtility: { pass: true },
    documentOverflow: { x: false, y: false },
    sidebar: { x: 0, y: 0, width: 360, height: 1050, visible: true },
    composer: { x: 590, y: homeRoute ? 879 : 897, width: 1104, height: 147, visible: true },
    hero: homeRoute ? { x: 590, y: 95, width: 1101, height: 300, visible: true } : null,
    homeGeometry: homeRoute ? { pass: true } : null,
    visibleCardCount: homeRoute ? 4 : 0,
  };
}

async function png(filename, width = 1920, height = 1050) {
  const header = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  await fs.writeFile(filename, header);
}

async function verification(filename, homeRoute) {
  await fs.writeFile(filename, `${JSON.stringify({
    targets: [{ targetId: homeRoute ? "home" : "task", result: result(homeRoute) }],
  })}\n`);
}

try {
  const files = {
    "theme-id": "route-test",
    "theme-version": "1.2.3",
    "home-verification": path.join(temporary, "home.json"),
    "home-screenshot": path.join(temporary, "home.png"),
    "task-verification": path.join(temporary, "task.json"),
    "task-screenshot": path.join(temporary, "task.png"),
  };
  await verification(files["home-verification"], true);
  await verification(files["task-verification"], false);
  await png(files["home-screenshot"]);
  await png(files["task-screenshot"]);

  const passed = await verifyThemeRoutes(files);
  assert.equal(passed.pass, true);
  assert.deepEqual(passed.routes, ["home", "task"]);
  assert.equal(passed.desiredGeneration, 7);

  await verification(files["task-verification"], true);
  await assert.rejects(verifyThemeRoutes(files), /task verification captured the wrong route/);

  await verification(files["task-verification"], false);
  await png(files["home-screenshot"], 1120, 900);
  await assert.rejects(verifyThemeRoutes(files), /1920x1050 baseline/);

  console.log("PASS: every theme release requires matching New chat and running-task verification plus screenshots.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
