import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const verifier = path.resolve(here, "../engine/scripts/verify-home-layout-matrix.mjs");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-themestore-layout-matrix."));
const viewports = [[1920, 1050], [1472, 949], [1120, 900], [900, 700], [900, 1050]];

function evidence() {
  return viewports.map(([width, height], index) => {
    const cardCount = index < 2 ? 4 : index === 2 ? 2 : 1;
    const cards = Array.from({ length: cardCount }, (_, cardIndex) => ({
      x: 400 + cardIndex * 260,
      y: height / 2 + 34,
      width: 240,
      height: 160,
      bottom: height / 2 + 194,
      right: 640 + cardIndex * 260,
    }));
    return {
      viewport: { width, height },
      sidebarOpen: true,
      cards,
      controlsOuter: { x: 360, y: height - 257, width: width - 360, height: 257, bottom: height, right: width },
      composer: { x: 384, y: height - 171, width: width - 408, height: 147, bottom: height - 24, right: width - 24 },
      gap: height - 257 - cards[0].bottom,
      overflow: { x: false, y: false },
    };
  });
}

async function run(native, theme) {
  const nativeFile = path.join(directory, "native.json");
  const themeFile = path.join(directory, "theme.json");
  await fs.writeFile(nativeFile, `${JSON.stringify(native)}\n`);
  await fs.writeFile(themeFile, `${JSON.stringify(theme)}\n`);
  return spawnSync(process.execPath, [verifier, "--native", nativeFile, "--theme", themeFile], {
    encoding: "utf8",
  });
}

try {
  const baseline = evidence();
  const success = await run(baseline, structuredClone(baseline));
  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(success.stdout).pass, true);

  const wrongCount = structuredClone(baseline);
  wrongCount[1].cards.pop();
  assert.notEqual((await run(baseline, wrongCount)).status, 0);

  const shifted = structuredClone(baseline);
  shifted[2].composer.x += 8;
  assert.notEqual((await run(baseline, shifted)).status, 0);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
