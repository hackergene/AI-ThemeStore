import fs from "node:fs/promises";
import path from "node:path";

const MAX_EVIDENCE_BYTES = 1024 * 1024;
const GEOMETRY_TOLERANCE = 4;
const GAP_TOLERANCE = 6;
const REQUIRED_VIEWPORTS = Object.freeze([
  [1920, 1050],
  [1472, 949],
  [1120, 900],
  [900, 700],
  [900, 1050],
]);

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--native", "--theme"].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
  }
  if (!options.native || !options.theme) throw new Error("--native and --theme are required");
  return options;
}

async function readEvidence(filename, label) {
  const resolved = path.resolve(filename);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_EVIDENCE_BYTES) {
    throw new Error(`${label} must be a safe regular JSON file within the size budget`);
  }
  const value = JSON.parse(await fs.readFile(resolved, "utf8"));
  if (!Array.isArray(value)) throw new Error(`${label} must contain an array`);
  return { resolved, value };
}

function viewportKey(item) {
  const width = item?.viewport?.width;
  const height = item?.viewport?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error("Evidence has an invalid viewport");
  return `${width}x${height}`;
}

function indexEvidence(items, label) {
  const indexed = new Map();
  for (const item of items) {
    const key = viewportKey(item);
    if (indexed.has(key)) throw new Error(`${label} contains duplicate viewport ${key}`);
    indexed.set(key, item);
  }
  return indexed;
}

function finiteRect(rect, label) {
  for (const field of ["x", "y", "width", "height", "bottom", "right"]) {
    if (!Number.isFinite(rect?.[field])) throw new Error(`${label}.${field} must be finite`);
  }
  return rect;
}

function compareNumber(actual, expected, tolerance, label) {
  const difference = Math.abs(actual - expected);
  if (difference > tolerance) {
    throw new Error(`${label} differs by ${difference.toFixed(2)}px (allowed ${tolerance}px)`);
  }
}

function compareRect(actualValue, expectedValue, label) {
  const actual = finiteRect(actualValue, `${label}.theme`);
  const expected = finiteRect(expectedValue, `${label}.native`);
  for (const field of ["x", "y", "width", "height", "bottom", "right"]) {
    compareNumber(actual[field], expected[field], GEOMETRY_TOLERANCE, `${label}.${field}`);
  }
}

function compareViewport(theme, native, key) {
  if (theme.sidebarOpen !== true || native.sidebarOpen !== true) {
    throw new Error(`${key} must be captured with the sidebar open`);
  }
  if (theme.overflow?.x || theme.overflow?.y) throw new Error(`${key} theme evidence has document overflow`);
  if (!Array.isArray(theme.cards) || !Array.isArray(native.cards) || theme.cards.length !== native.cards.length) {
    throw new Error(`${key} card count must match native (${native.cards?.length ?? 0})`);
  }
  if (theme.cards.length < 1 || theme.cards.length > 4) throw new Error(`${key} card count is outside 1..4`);
  theme.cards.forEach((card, index) => compareRect(card, native.cards[index], `${key}.cards[${index}]`));
  compareRect(theme.controlsOuter, native.controlsOuter, `${key}.controlsOuter`);
  compareRect(theme.composer, native.composer, `${key}.composer`);
  compareNumber(theme.gap, native.gap, GAP_TOLERANCE, `${key}.gap`);
}

const options = parse(process.argv.slice(2));
const [nativeEvidence, themeEvidence] = await Promise.all([
  readEvidence(options.native, "native evidence"),
  readEvidence(options.theme, "theme evidence"),
]);
const nativeByViewport = indexEvidence(nativeEvidence.value, "native evidence");
const themeByViewport = indexEvidence(themeEvidence.value, "theme evidence");
const viewports = [];

for (const [width, height] of REQUIRED_VIEWPORTS) {
  const key = `${width}x${height}`;
  const native = nativeByViewport.get(key);
  const theme = themeByViewport.get(key);
  if (!native || !theme) throw new Error(`Missing required viewport ${key}`);
  compareViewport(theme, native, key);
  viewports.push({
    width,
    height,
    cardCount: theme.cards.length,
    gapDifference: Number((theme.gap - native.gap).toFixed(2)),
  });
}

console.log(JSON.stringify({
  schemaVersion: 1,
  pass: true,
  nativeEvidence: nativeEvidence.resolved,
  themeEvidence: themeEvidence.resolved,
  geometryTolerance: GEOMETRY_TOLERANCE,
  gapTolerance: GAP_TOLERANCE,
  viewports,
}, null, 2));
