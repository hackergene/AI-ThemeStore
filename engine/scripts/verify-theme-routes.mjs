import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_VERIFICATION_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 24 * 1024 * 1024;
const BASELINE_VIEWPORT = Object.freeze({ width: 1920, height: 1050 });

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
  }
  for (const field of [
    "theme-id",
    "theme-version",
    "home-verification",
    "home-screenshot",
    "task-verification",
    "task-screenshot",
  ]) {
    if (!options[field]) throw new Error(`--${field} is required`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options["theme-id"])) {
    throw new Error("--theme-id is invalid");
  }
  if (options["theme-version"].length > 32) throw new Error("--theme-version is invalid");
  return options;
}

async function regularFile(filename, maximum, label) {
  const resolved = path.resolve(filename);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximum) {
    throw new Error(`${label} must be a safe regular file within the size budget`);
  }
  return { resolved, stat };
}

async function readVerification(filename, label) {
  const { resolved } = await regularFile(filename, MAX_VERIFICATION_BYTES, label);
  let document;
  try {
    document = JSON.parse(await fs.readFile(resolved, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`);
  }
  if (!Array.isArray(document.targets) || document.targets.length === 0) {
    throw new Error(`${label} has no verified renderer targets`);
  }
  return { resolved, document };
}

async function readScreenshot(filename, label) {
  const { resolved, stat } = await regularFile(filename, MAX_SCREENSHOT_BYTES, label);
  const header = Buffer.alloc(24);
  const handle = await fs.open(resolved, "r");
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length ||
        !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        header.subarray(12, 16).toString("ascii") !== "IHDR") {
      throw new Error(`${label} must be a PNG screenshot`);
    }
  } finally {
    await handle.close();
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width < BASELINE_VIEWPORT.width || height < BASELINE_VIEWPORT.height) {
    throw new Error(`${label} must cover at least the 1920x1050 baseline`);
  }
  return { path: resolved, bytes: stat.size, width, height };
}

function visibleBox(value) {
  return Boolean(value?.visible && value.width > 0 && value.height > 0);
}

function validateResult(result, route, identity) {
  if (!result?.pass) throw new Error(`${route} renderer verification did not pass`);
  if (result.homeRoute !== (route === "home")) {
    throw new Error(`${route} verification captured the wrong route`);
  }
  if (result.themeId !== identity.themeId || result.themeVersion !== identity.themeVersion ||
      result.themeSchemaVersion !== 2) {
    throw new Error(`${route} verification theme identity does not match the release`);
  }
  if (!Number.isSafeInteger(result.desiredGeneration) || result.desiredGeneration < 1) {
    throw new Error(`${route} verification has no desired generation`);
  }
  if (result.viewport?.width !== BASELINE_VIEWPORT.width ||
      result.viewport?.height !== BASELINE_VIEWPORT.height) {
    throw new Error(`${route} verification must use the 1920x1050 viewport`);
  }
  if (!result.visualBaseline?.pass || !result.readability?.pass ||
      !result.signature?.pass || !result.composerDecorations?.pass) {
    throw new Error(`${route} verification failed a visual/readability/signature gate`);
  }
  if (!visibleBox(result.sidebar) || !visibleBox(result.composer)) {
    throw new Error(`${route} verification is missing the native sidebar or composer`);
  }
  if (result.documentOverflow?.x) throw new Error(`${route} verification has horizontal overflow`);
  if (route === "home" &&
      (!result.homePresent || !visibleBox(result.hero) || !result.homeGeometry?.pass ||
       !result.projectUtility?.pass ||
       result.visibleCardCount < 1 || result.visibleCardCount > 6)) {
    throw new Error("home verification failed the New chat layout gate");
  }
  return {
    route,
    viewport: result.viewport,
    composer: result.composer,
    sidebar: result.sidebar,
    desiredGeneration: result.desiredGeneration,
  };
}

export async function verifyThemeRoutes(options) {
  const identity = { themeId: options["theme-id"], themeVersion: options["theme-version"] };
  const home = await readVerification(options["home-verification"], "home verification");
  const task = await readVerification(options["task-verification"], "task verification");
  const homeResults = home.document.targets.map((target) => validateResult(target?.result, "home", identity));
  const taskResults = task.document.targets.map((target) => validateResult(target?.result, "task", identity));
  const generations = new Set([...homeResults, ...taskResults].map((result) => result.desiredGeneration));
  if (generations.size !== 1) throw new Error("home and task evidence must use the same desired generation");

  const homeComposer = homeResults[0].composer;
  const taskComposer = taskResults[0].composer;
  const tolerance = 4;
  if (Math.abs(homeComposer.x - taskComposer.x) > tolerance ||
      Math.abs(homeComposer.width - taskComposer.width) > tolerance) {
    throw new Error("home and task composers do not share the same horizontal geometry");
  }

  const screenshots = {
    home: await readScreenshot(options["home-screenshot"], "home screenshot"),
    task: await readScreenshot(options["task-screenshot"], "task screenshot"),
  };
  return Object.freeze({
    schemaVersion: 1,
    pass: true,
    ...identity,
    desiredGeneration: [...generations][0],
    baselineViewport: BASELINE_VIEWPORT,
    routes: Object.freeze(["home", "task"]),
    screenshots: Object.freeze(screenshots),
  });
}

async function main() {
  const result = await verifyThemeRoutes(parse(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
