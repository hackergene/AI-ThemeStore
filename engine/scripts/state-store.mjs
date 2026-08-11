import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION,
  ADAPTER_ID,
  APP_ID,
  CONTRACT_ACTIONS,
  CONTRACT_REASONS,
  CONTRACT_STATUSES,
  PROFILE_ID,
  REASON,
  STATE_SCHEMA_VERSION,
  STATUS,
} from "./state-contract.mjs";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_THEME_FILE_BYTES = 16 * 1024 * 1024;
const MAX_THEME_MOTION_BYTES = 8 * 1024 * 1024;
const THEME_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

export class StateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StateError";
    this.code = code;
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `${label} must be a JSON object`);
  }
  return value;
}

function iso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function themeReference(value, label, { native = false, nullable = false } = {}) {
  if (nullable && value === null) return null;
  const entry = object(value, label);
  if (native && entry.id === "native") return { id: "native", version: "system" };
  if (!THEME_ID.test(entry.id || "")) throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `${label}.id is invalid`);
  if (typeof entry.version !== "string" || !entry.version.trim() || entry.version.length > 64) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `${label}.version is invalid`);
  }
  return { id: entry.id, version: entry.version };
}

export function statePaths(stateRoot) {
  const root = path.resolve(stateRoot);
  return {
    root,
    legacy: path.join(root, "state.json"),
    desired: path.join(root, "desired-state.json"),
    runtime: path.join(root, "runtime-state.json"),
    active: path.join(root, "theme"),
    rollback: path.join(root, "rollback"),
    staging: path.join(root, "staging"),
    history: path.join(root, "recovery-history.ndjson"),
    migrationBackups: path.join(root, "migration-backups"),
    migrationLock: path.join(root, ".state-migration.lock"),
  };
}

export async function readStrictJson(filename, { missing = null, maxBytes = MAX_JSON_BYTES } = {}) {
  let bytes;
  try {
    bytes = await fs.readFile(filename);
  } catch (error) {
    if (error.code === "ENOENT") return missing;
    throw error;
  }
  if (bytes.length > maxBytes) throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `${filename} is too large`);
  let text;
  try {
    text = strictDecoder.decode(bytes);
  } catch {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `${filename} is not strict UTF-8`);
  }
  try {
    return object(JSON.parse(text), filename);
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `${filename} is not valid JSON`);
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function atomicCopy(source, destination) {
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let input;
  let output;
  try {
    input = await fs.open(source, "r");
    const stat = await input.stat();
    if (!stat.isFile()) throw new StateError(REASON.MIGRATION_FAILED, `${source} must be a regular file`);
    output = await fs.open(temporary, "wx", 0o600);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < stat.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, position + written);
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    if (position !== stat.size) throw new StateError(REASON.MIGRATION_FAILED, `${source} changed while it was copied`);
    await output.sync();
    await output.close();
    output = null;
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
    await syncDirectory(path.dirname(destination));
  } finally {
    await input?.close().catch(() => {});
    await output?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function atomicWriteJson(filename, value, { backup = true } = {}) {
  object(value, "state");
  const directory = path.dirname(filename);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (backup) {
      try {
        await atomicCopy(filename, `${filename}.backup`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await fs.rename(temporary, filename);
    await fs.chmod(filename, 0o600);
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export function validateDesiredState(value) {
  const state = object(value, "desired-state");
  if (state.schemaVersion !== STATE_SCHEMA_VERSION || state.app !== APP_ID || state.profileId !== PROFILE_ID) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "desired-state identity is invalid");
  }
  const desiredTheme = themeReference(state.desiredTheme, "desiredTheme", { native: true });
  const lastKnownGoodTheme = themeReference(state.lastKnownGoodTheme, "lastKnownGoodTheme", { nullable: true });
  if (!new Set(["always", "manual"]).has(state.restorePolicy)) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "restorePolicy is invalid");
  }
  if (typeof state.paused !== "boolean" || typeof state.safeMode !== "boolean" || !positiveInteger(state.generation) || !iso(state.updatedAt)) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "desired-state fields are invalid");
  }
  return { ...state, desiredTheme, lastKnownGoodTheme };
}

export function validateRuntimeState(value) {
  const state = object(value, "runtime-state");
  if (state.schemaVersion !== STATE_SCHEMA_VERSION || state.app !== APP_ID || state.profileId !== PROFILE_ID || state.adapterId !== ADAPTER_ID) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "runtime-state identity is invalid");
  }
  if (!CONTRACT_STATUSES.has(state.status) || !CONTRACT_ACTIONS.has(state.action) || !CONTRACT_REASONS.has(state.reasonCode)) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "runtime-state contract value is invalid");
  }
  if (!positiveInteger(state.desiredGeneration) || typeof state.runtimeVerified !== "boolean" || !Array.isArray(state.verifiedRoutes)) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "runtime-state evidence fields are invalid");
  }
  if (!Number.isSafeInteger(state.port) || state.port < 1024 || state.port > 65535 ||
      !Number.isSafeInteger(state.codexPid) || state.codexPid < 0 ||
      !Number.isSafeInteger(state.injectorPid) || state.injectorPid < 0) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "runtime-state process evidence is invalid");
  }
  if (!state.verifiedRoutes.every((route) => route === "home" || route === "task")) {
    throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "runtime-state route evidence is invalid");
  }
  if (state.evidenceAt !== null && !iso(state.evidenceAt)) throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "evidenceAt is invalid");
  return state;
}

function upgradeAppIdentity(value) {
  const state = object(value, "state");
  if (state.schemaVersion === 1 && state.platformId === "codex-desktop") {
    const { platformId: _legacyPlatformId, ...rest } = state;
    return { ...rest, schemaVersion: STATE_SCHEMA_VERSION, app: APP_ID };
  }
  return state;
}

export async function themeMetadata(themeDirectory) {
  const configPath = path.join(themeDirectory, "theme.json");
  const configStat = await fs.lstat(configPath);
  if (!configStat.isFile() || configStat.nlink !== 1) throw new StateError(REASON.MIGRATION_THEME_UNRECOGNIZED, "active theme config is not a private regular file");
  const raw = await readStrictJson(configPath);
  if (![1, 2].includes(raw.schemaVersion) || !THEME_ID.test(raw.id || "")) {
    throw new StateError(REASON.MIGRATION_THEME_UNRECOGNIZED, "active theme identity is invalid");
  }
  const version = typeof raw.version === "string" && raw.version.trim() && raw.version.length <= 64 ? raw.version : "1.0.0";
  const legacy = typeof raw.image === "string" ? raw.image : "";
  const assets = [raw.assets?.hero || legacy, raw.assets?.taskBackground || raw.assets?.hero || legacy];
  for (const name of new Set(assets)) {
    if (!name || path.basename(name) !== name || !/\.(?:avif|png|jpe?g|webp)$/i.test(name)) {
      throw new StateError(REASON.MIGRATION_THEME_UNRECOGNIZED, "active theme asset path is invalid");
    }
    const stat = await fs.lstat(path.join(themeDirectory, name));
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > MAX_THEME_FILE_BYTES) {
      throw new StateError(REASON.MIGRATION_THEME_UNRECOGNIZED, "active theme asset is invalid");
    }
  }
  if (raw.background !== undefined) {
    const background = object(raw.background, "active theme background");
    const source = background.source;
    const poster = background.poster || assets[0];
    if (background.type !== "video" || raw.layout?.backgroundMode !== "full" || raw.effects?.motion !== "full" ||
        background.playback !== "loop-muted" || poster !== assets[0] ||
        typeof source !== "string" || path.basename(source) !== source || !/\.mp4$/i.test(source)) {
      throw new StateError(REASON.MIGRATION_THEME_UNRECOGNIZED, "active theme motion metadata is invalid");
    }
    const motionPath = path.join(themeDirectory, source);
    const stat = await fs.lstat(motionPath);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 12 || stat.size > MAX_THEME_MOTION_BYTES) {
      throw new StateError(REASON.MIGRATION_THEME_UNRECOGNIZED, "active theme motion asset is invalid");
    }
    const handle = await fs.open(motionPath, "r");
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== header.length || header.subarray(4, 8).toString("ascii") !== "ftyp") {
        throw new StateError(REASON.MIGRATION_THEME_UNRECOGNIZED, "active theme motion is not an MP4 file");
      }
    } finally {
      await handle.close();
    }
  }
  return { id: raw.id, version };
}

export async function copyTreeStrict(source, destination) {
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new StateError(REASON.MIGRATION_FAILED, `${source} must be a directory`);
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new StateError(REASON.MIGRATION_FAILED, `symlink rejected during migration: ${entry.name}`);
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTreeStrict(from, to);
    else if (entry.isFile()) await atomicCopy(from, to);
    else throw new StateError(REASON.MIGRATION_FAILED, `unsupported file rejected during migration: ${entry.name}`);
  }
}

function legacyRuntime(legacy, desiredGeneration, desiredTheme, now) {
  const number = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const text = (value, limit = 512) => typeof value === "string" ? value.slice(0, limit) : "";
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    app: APP_ID,
    profileId: PROFILE_ID,
    adapterId: ADAPTER_ID,
    desiredGeneration,
    hostVersion: text(legacy?.codexVersion, 128),
    codexPid: number(legacy?.codexPid),
    codexStartedAt: "",
    port: number(legacy?.port) || 9341,
    injectorPid: number(legacy?.injectorPid),
    injectorStartedAt: text(legacy?.injectorStartedAt, 128),
    verifiedThemeId: null,
    verifiedThemeVersion: null,
    verifiedRoutes: [],
    status: STATUS.PENDING,
    runtimeVerified: false,
    action: ACTION.NONE,
    reasonCode: desiredTheme.id === "native" ? REASON.NATIVE_SELECTED : REASON.LEGACY_RUNTIME_UNVERIFIED,
    evidenceAt: null,
    updatedAt: now,
  };
}

async function acquireLock(filename) {
  try {
    return await fs.open(filename, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new StateError(REASON.MIGRATION_FAILED, "state migration is already running");
    throw error;
  }
}

export async function migrateLegacyState(stateRoot, { failAfter = "" } = {}) {
  const paths = statePaths(stateRoot);
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  await fs.chmod(paths.root, 0o700);
  const lock = await acquireLock(paths.migrationLock);
  let createdDesired = false;
  let createdRuntime = false;
  try {
    const existingDesired = await readStrictJson(paths.desired, { missing: null });
    if (existingDesired) {
      const upgradedDesired = upgradeAppIdentity(existingDesired);
      const desired = validateDesiredState(upgradedDesired);
      const existingRuntime = await readStrictJson(paths.runtime, { missing: null });
      const upgradedRuntime = existingRuntime ? upgradeAppIdentity(existingRuntime) : null;
      if (upgradedRuntime) validateRuntimeState(upgradedRuntime);
      const identityMigrated = upgradedDesired !== existingDesired || upgradedRuntime !== existingRuntime;
      if (upgradedDesired !== existingDesired) await atomicWriteJson(paths.desired, upgradedDesired);
      if (upgradedRuntime !== existingRuntime) await atomicWriteJson(paths.runtime, upgradedRuntime);
      return { migrated: identityMigrated, reasonCode: identityMigrated ? "app_identity_migrated" : "state_already_migrated", desired };
    }

    const legacy = await readStrictJson(paths.legacy, { missing: null });
    let activeTheme = null;
    try {
      activeTheme = await themeMetadata(paths.active);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== REASON.MIGRATION_THEME_UNRECOGNIZED) throw error;
    }

    const backupId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
    const backupTemporary = path.join(paths.migrationBackups, `.${backupId}.tmp`);
    const backupFinal = path.join(paths.migrationBackups, backupId);
    await fs.mkdir(backupTemporary, { recursive: true, mode: 0o700 });
    if (legacy) await atomicCopy(paths.legacy, path.join(backupTemporary, "state.json"));
    if (activeTheme) await copyTreeStrict(paths.active, path.join(backupTemporary, "theme"));
    await fs.rename(backupTemporary, backupFinal);
    await syncDirectory(paths.migrationBackups);
    if (failAfter === "backup") throw new StateError(REASON.MIGRATION_FAILED, "injected migration failure after backup");

    const now = new Date().toISOString();
    const desiredTheme = activeTheme || { id: "native", version: "system" };
    const desired = {
      schemaVersion: STATE_SCHEMA_VERSION,
      app: APP_ID,
      profileId: PROFILE_ID,
      desiredTheme,
      lastKnownGoodTheme: null,
      restorePolicy: "always",
      paused: false,
      safeMode: false,
      generation: 1,
      updatedAt: now,
      migration: {
        source: "AIThemeStore/state.json+theme",
        backup: path.relative(paths.root, backupFinal),
        migratedAt: now,
      },
    };
    const runtime = legacyRuntime(legacy, desired.generation, desiredTheme, now);
    await atomicWriteJson(paths.desired, desired, { backup: false });
    createdDesired = true;
    if (failAfter === "desired") throw new StateError(REASON.MIGRATION_FAILED, "injected migration failure after desired state");
    await atomicWriteJson(paths.runtime, runtime, { backup: false });
    createdRuntime = true;
    if (failAfter === "runtime") throw new StateError(REASON.MIGRATION_FAILED, "injected migration failure after runtime state");
    return { migrated: true, reasonCode: runtime.reasonCode, desired, runtime, backup: backupFinal };
  } catch (error) {
    if (createdRuntime) await fs.rm(paths.runtime, { force: true }).catch(() => {});
    if (createdDesired) await fs.rm(paths.desired, { force: true }).catch(() => {});
    throw error;
  } finally {
    await lock.close().catch(() => {});
    await fs.rm(paths.migrationLock, { force: true }).catch(() => {});
  }
}

export async function structuredStatus(stateRoot) {
  const paths = statePaths(stateRoot);
  let desired;
  try {
    desired = validateDesiredState(await readStrictJson(paths.desired));
  } catch (error) {
    return {
      status: STATUS.FAILED,
      app: APP_ID,
      profileId: PROFILE_ID,
      desiredThemeId: "native",
      lastThemeId: null,
      hostVersion: "",
      adapterId: ADAPTER_ID,
      runtimeVerified: false,
      action: ACTION.NONE,
      reasonCode: error?.code || REASON.RUNTIME_EVIDENCE_INVALID,
      evidenceAt: null,
    };
  }
  const base = {
    app: APP_ID,
    profileId: PROFILE_ID,
    desiredThemeId: desired.desiredTheme.id,
    lastThemeId: desired.lastKnownGoodTheme?.id || null,
    adapterId: ADAPTER_ID,
    action: ACTION.NONE,
  };
  if (desired.safeMode) return { status: STATUS.SAFE_MODE, ...base, hostVersion: "", runtimeVerified: false, reasonCode: REASON.SAFE_MODE_ENABLED, evidenceAt: null };
  if (desired.paused) return { status: STATUS.PENDING, ...base, hostVersion: "", runtimeVerified: false, reasonCode: REASON.AUTO_RESTORE_PAUSED, evidenceAt: null };
  if (desired.desiredTheme.id === "native") return { status: STATUS.HEALTHY, ...base, hostVersion: "", runtimeVerified: true, action: ACTION.RESTORED, reasonCode: REASON.NATIVE_SELECTED, evidenceAt: desired.updatedAt };

  let runtime;
  try {
    const raw = await readStrictJson(paths.runtime, { missing: null });
    if (!raw) throw new StateError(REASON.RUNTIME_EVIDENCE_MISSING, "runtime-state is missing");
    runtime = validateRuntimeState(raw);
  } catch (error) {
    return { status: STATUS.PENDING, ...base, hostVersion: "", runtimeVerified: false, reasonCode: error?.code || REASON.RUNTIME_EVIDENCE_INVALID, evidenceAt: null };
  }
  const result = { ...base, hostVersion: runtime.hostVersion || "", runtimeVerified: false, action: runtime.action, evidenceAt: runtime.evidenceAt };
  if (runtime.desiredGeneration !== desired.generation) return { status: STATUS.PENDING, ...result, reasonCode: REASON.DESIRED_GENERATION_MISMATCH };
  if (!runtime.runtimeVerified) return { status: STATUS.PENDING, ...result, reasonCode: runtime.reasonCode };
  if (runtime.verifiedThemeId !== desired.desiredTheme.id || runtime.verifiedThemeVersion !== desired.desiredTheme.version) {
    return { status: STATUS.PENDING, ...result, reasonCode: REASON.DESIRED_THEME_MISMATCH };
  }
  if (!runtime.verifiedRoutes.includes("home")) return { status: STATUS.PENDING, ...result, reasonCode: REASON.HOME_ROUTE_PENDING };
  if (!runtime.verifiedRoutes.includes("task")) return { status: STATUS.PENDING, ...result, runtimeVerified: true, reasonCode: REASON.TASK_ROUTE_PENDING };
  return { status: STATUS.HEALTHY, ...result, runtimeVerified: true, reasonCode: REASON.RUNTIME_VERIFIED };
}

export async function writeRuntimeState(stateRoot, value) {
  const runtime = validateRuntimeState(value);
  await atomicWriteJson(statePaths(stateRoot).runtime, runtime);
  return runtime;
}

async function loadDesired(stateRoot) {
  const paths = statePaths(stateRoot);
  return validateDesiredState(await readStrictJson(paths.desired));
}

export async function updateDesiredState(stateRoot, mutate) {
  const paths = statePaths(stateRoot);
  const current = await loadDesired(stateRoot);
  const next = validateDesiredState({
    ...current,
    ...mutate(current),
    generation: current.generation + 1,
    updatedAt: new Date().toISOString(),
  });
  await atomicWriteJson(paths.desired, next);
  return next;
}

export async function setPaused(stateRoot, paused) {
  if (typeof paused !== "boolean") throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "paused must be boolean");
  return updateDesiredState(stateRoot, () => ({ paused }));
}

export async function setNative(stateRoot, { safeMode = false } = {}) {
  return updateDesiredState(stateRoot, (current) => ({
    desiredTheme: { id: "native", version: "system" },
    lastKnownGoodTheme: current.desiredTheme.id === "native" ? current.lastKnownGoodTheme : current.desiredTheme,
    paused: false,
    safeMode,
  }));
}

export async function enableSafeMode(stateRoot) {
  return updateDesiredState(stateRoot, () => ({ safeMode: true }));
}

export async function prepareManualRecovery(stateRoot) {
  return updateDesiredState(stateRoot, () => ({
    paused: false,
    safeMode: false,
  }));
}

export async function commitDesiredTheme(stateRoot, theme, previousTheme = null) {
  const selected = themeReference(theme, "theme");
  const previous = previousTheme ? themeReference(previousTheme, "previousTheme") : null;
  return updateDesiredState(stateRoot, () => ({
    desiredTheme: selected,
    lastKnownGoodTheme: previous,
    restorePolicy: "always",
    paused: false,
    safeMode: false,
  }));
}

function parseCli(argv) {
  const command = argv[0];
  const options = { command, stateRoot: "", failAfter: "", input: "", value: "", safeMode: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--state-root") options.stateRoot = argv[++index] || "";
    else if (arg === "--fail-after") options.failAfter = argv[++index] || "";
    else if (arg === "--input") options.input = argv[++index] || "";
    else if (arg === "--value") options.value = argv[++index] || "";
    else if (arg === "--safe-mode") options.safeMode = true;
    else throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `unknown argument: ${arg}`);
  }
  if (!options.stateRoot) throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "--state-root is required");
  return options;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  let result = null;
  if (options.command === "migrate") result = await migrateLegacyState(options.stateRoot, { failAfter: options.failAfter });
  else if (options.command === "status") result = await structuredStatus(options.stateRoot);
  else if (options.command === "write-runtime") {
    if (!options.input) throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "--input is required");
    result = await writeRuntimeState(options.stateRoot, await readStrictJson(options.input));
  } else if (options.command === "pause") {
    if (!new Set(["true", "false"]).has(options.value)) throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, "--value must be true or false");
    result = await setPaused(options.stateRoot, options.value === "true");
  } else if (options.command === "recover") {
    result = await prepareManualRecovery(options.stateRoot);
  } else if (options.command === "native") result = await setNative(options.stateRoot, { safeMode: options.safeMode });
  if (!result) throw new StateError(REASON.RUNTIME_EVIDENCE_INVALID, `unknown command: ${options.command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: STATUS.FAILED, reasonCode: error.code || REASON.MIGRATION_FAILED, message: error.message })}\n`);
    process.exitCode = 1;
  });
}
