import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REASON } from "./state-contract.mjs";
import {
  atomicWriteJson,
  commitDesiredTheme,
  copyTreeStrict,
  enableSafeMode,
  readStrictJson,
  statePaths,
  StateError,
  themeMetadata,
} from "./state-store.mjs";

async function exists(filename) {
  try {
    await fs.lstat(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function transactionPath(paths) {
  return path.join(paths.staging, "transaction.json");
}

async function acquire(paths) {
  await fs.mkdir(paths.staging, { recursive: true, mode: 0o700 });
  try {
    return await fs.open(path.join(paths.staging, ".transaction.lock"), "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "a theme transaction is already running");
    throw error;
  }
}

async function release(paths, lock) {
  await lock.close().catch(() => {});
  await fs.rm(path.join(paths.staging, ".transaction.lock"), { force: true }).catch(() => {});
}

async function writeJournal(paths, journal) {
  await atomicWriteJson(transactionPath(paths), journal, { backup: false });
}

export async function recoverInterruptedTransaction(stateRoot) {
  const paths = statePaths(stateRoot);
  const journal = await readStrictJson(transactionPath(paths), { missing: null });
  if (!journal) return { recovered: false };
  const previous = path.join(paths.root, `.theme.previous.${journal.id}`);
  const oldRollback = path.join(paths.root, `.rollback.previous.${journal.id}`);
  if (journal.phase === "active_promoted" && await exists(previous)) {
    await fs.rm(paths.active, { recursive: true, force: true });
    await fs.rename(previous, paths.active);
  } else if (journal.phase === "rollback_rotated" && await exists(paths.rollback)) {
    await fs.rm(paths.active, { recursive: true, force: true });
    await fs.rename(paths.rollback, paths.active);
    if (await exists(oldRollback)) await fs.rename(oldRollback, paths.rollback);
  }
  await fs.rm(journal.stagedPath, { recursive: true, force: true }).catch(() => {});
  await fs.rm(previous, { recursive: true, force: true }).catch(() => {});
  await fs.rm(oldRollback, { recursive: true, force: true }).catch(() => {});
  await fs.rm(transactionPath(paths), { force: true });
  return { recovered: true, reasonCode: REASON.ROLLBACK_APPLIED };
}

export async function prepareThemeTransaction(stateRoot, source) {
  const paths = statePaths(stateRoot);
  const lock = await acquire(paths);
  let stagedPath = "";
  let temporary = "";
  try {
    await recoverInterruptedTransaction(stateRoot);
    const id = crypto.randomUUID();
    stagedPath = path.join(paths.staging, id);
    temporary = path.join(paths.staging, `.${id}.tmp`);
    await copyTreeStrict(path.resolve(source), temporary);
    const theme = await themeMetadata(temporary);
    await fs.rename(temporary, stagedPath);
    const previousTheme = await themeMetadata(paths.active).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const journal = {
      schemaVersion: 1,
      id,
      phase: "staged",
      theme,
      previousTheme,
      stagedPath,
      createdAt: new Date().toISOString(),
    };
    await writeJournal(paths, journal);
    return { status: "staged", reasonCode: REASON.APPLY_STAGED, ...journal };
  } catch (error) {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    if (stagedPath) await fs.rm(stagedPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await release(paths, lock);
  }
}

async function requireJournal(paths, id) {
  const journal = await readStrictJson(transactionPath(paths));
  if (!journal || journal.id !== id || journal.phase !== "staged") {
    throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "theme transaction identity or phase is invalid");
  }
  const actual = await themeMetadata(journal.stagedPath);
  if (actual.id !== journal.theme.id || actual.version !== journal.theme.version) {
    throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "staged theme changed before commit");
  }
  return journal;
}

export async function commitThemeTransaction(stateRoot, id, { failAfter = "" } = {}) {
  const paths = statePaths(stateRoot);
  const lock = await acquire(paths);
  const previous = path.join(paths.root, `.theme.previous.${id}`);
  const oldRollback = path.join(paths.root, `.rollback.previous.${id}`);
  let journal;
  try {
    journal = await requireJournal(paths, id);
    if (await exists(previous) || await exists(oldRollback)) throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "transaction recovery paths already exist");
    if (await exists(paths.active)) await fs.rename(paths.active, previous);
    await fs.rename(journal.stagedPath, paths.active);
    journal.phase = "active_promoted";
    await writeJournal(paths, journal);
    if (failAfter === "active") throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "injected commit failure after active promotion");
    if (await exists(paths.rollback)) await fs.rename(paths.rollback, oldRollback);
    if (await exists(previous)) await fs.rename(previous, paths.rollback);
    journal.phase = "rollback_rotated";
    await writeJournal(paths, journal);
    if (failAfter === "rollback") throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "injected commit failure after rollback rotation");
    if (failAfter === "desired") throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "injected commit failure before desired state");
    const desired = await commitDesiredTheme(stateRoot, journal.theme, journal.previousTheme);
    journal.phase = "desired_committed";
    await writeJournal(paths, journal);
    await fs.rm(oldRollback, { recursive: true, force: true });
    await fs.rm(transactionPath(paths), { force: true });
    return { status: "committed", reasonCode: REASON.APPLY_COMMITTED, theme: journal.theme, previousTheme: journal.previousTheme, desiredGeneration: desired.generation };
  } catch (error) {
    if (journal) await recoverInterruptedTransaction(stateRoot).catch(() => {});
    throw error;
  } finally {
    await release(paths, lock);
  }
}

export async function abortThemeTransaction(stateRoot, id, { rollbackSucceeded = true } = {}) {
  const paths = statePaths(stateRoot);
  const lock = await acquire(paths);
  try {
    const journal = await readStrictJson(transactionPath(paths), { missing: null });
    if (journal && journal.id !== id) throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "theme transaction identity is invalid");
    if (journal?.stagedPath) await fs.rm(journal.stagedPath, { recursive: true, force: true });
    await fs.rm(transactionPath(paths), { force: true });
    if (!rollbackSucceeded) {
      const desired = await enableSafeMode(stateRoot);
      return { status: "safe_mode", reasonCode: REASON.ROLLBACK_FAILED_NATIVE_SAFE_MODE, desiredGeneration: desired.generation };
    }
    return { status: "rolled_back", reasonCode: REASON.ROLLBACK_APPLIED };
  } finally {
    await release(paths, lock);
  }
}

function parse(argv) {
  const result = { command: argv[0], stateRoot: "", source: "", id: "", rollbackSucceeded: true, failAfter: "" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--state-root") result.stateRoot = argv[++index] || "";
    else if (arg === "--source") result.source = argv[++index] || "";
    else if (arg === "--id") result.id = argv[++index] || "";
    else if (arg === "--rollback-failed") result.rollbackSucceeded = false;
    else if (arg === "--fail-after") result.failAfter = argv[++index] || "";
    else throw new StateError(REASON.APPLY_VERIFICATION_FAILED, `unknown argument: ${arg}`);
  }
  if (!result.stateRoot) throw new StateError(REASON.APPLY_VERIFICATION_FAILED, "--state-root is required");
  return result;
}

async function main() {
  const options = parse(process.argv.slice(2));
  let result;
  if (options.command === "prepare") result = await prepareThemeTransaction(options.stateRoot, options.source);
  else if (options.command === "commit") result = await commitThemeTransaction(options.stateRoot, options.id, { failAfter: options.failAfter });
  else if (options.command === "abort") result = await abortThemeTransaction(options.stateRoot, options.id, { rollbackSucceeded: options.rollbackSucceeded });
  else if (options.command === "recover") result = await recoverInterruptedTransaction(options.stateRoot);
  else throw new StateError(REASON.APPLY_VERIFICATION_FAILED, `unknown command: ${options.command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "failed", reasonCode: error.code || REASON.APPLY_VERIFICATION_FAILED, message: error.message })}\n`);
    process.exitCode = 1;
  });
}
