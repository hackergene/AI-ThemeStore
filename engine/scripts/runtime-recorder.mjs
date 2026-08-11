import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION, ADAPTER_ID, APP_ID, PROFILE_ID, REASON, STATE_SCHEMA_VERSION, STATUS } from "./state-contract.mjs";
import { readStrictJson, statePaths, validateDesiredState, writeRuntimeState } from "./state-store.mjs";

function integer(value, label, { zero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (zero ? 0 : 1)) throw new Error(`${label} is invalid`);
  return parsed;
}

function parse(argv) {
  const result = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    result[arg.slice(2)] = argv[++index] || "";
  }
  if (!result["state-root"]) throw new Error("--state-root is required");
  return result;
}

async function desired(options) {
  return validateDesiredState(await readStrictJson(statePaths(options["state-root"]).desired));
}

function base(options, selected) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    app: APP_ID,
    profileId: PROFILE_ID,
    adapterId: ADAPTER_ID,
    desiredGeneration: selected.generation,
    hostVersion: options["host-version"] || "",
    codexBundle: options["codex-bundle"] || "",
    codexExe: options["codex-exe"] || "",
    codexTeamId: options["codex-team-id"] || "",
    codexPid: integer(options["codex-pid"] || 0, "codex pid", { zero: true }),
    codexStartedAt: options["codex-started-at"] || "",
    port: integer(options.port, "port"),
    injectorPid: integer(options["injector-pid"], "injector pid"),
    injectorStartedAt: options["injector-started-at"] || "",
    injectorPath: options["injector-path"] || "",
    themeDir: options["theme-dir"] || "",
    verifiedThemeId: null,
    verifiedThemeVersion: null,
    verifiedRoutes: [],
    status: STATUS.PENDING,
    runtimeVerified: false,
    action: ACTION.NONE,
    reasonCode: REASON.RUNTIME_EVIDENCE_MISSING,
    evidenceAt: null,
    updatedAt: new Date().toISOString(),
  };
}

async function pending(options) {
  if (Number(options.port) < 1024 || Number(options.port) > 65535) throw new Error("port is invalid");
  const selected = await desired(options);
  return writeRuntimeState(options["state-root"], base(options, selected));
}

async function verified(options) {
  if (Number(options.port) < 1024 || Number(options.port) > 65535) throw new Error("port is invalid");
  const selected = await desired(options);
  const runtime = base(options, selected);
  if (!options.verification) throw new Error("--verification is required");
  const verification = await readStrictJson(options.verification, { maxBytes: 4 * 1024 * 1024 });
  if (!Array.isArray(verification.targets) || verification.targets.length === 0) throw new Error("verification has no renderer targets");
  const routes = new Set();
  for (const target of verification.targets) {
    const result = target?.result;
    if (!result?.pass) throw new Error("renderer verification failed");
    if (result.themeId !== selected.desiredTheme.id || result.themeVersion !== selected.desiredTheme.version ||
        result.desiredGeneration !== selected.generation || ![1, 2].includes(result.themeSchemaVersion)) {
      throw new Error("renderer identity does not match desired state");
    }
    routes.add(result.homeRoute ? "home" : "task");
  }
  runtime.verifiedThemeId = selected.desiredTheme.id;
  runtime.verifiedThemeVersion = selected.desiredTheme.version;
  runtime.verifiedRoutes = [...routes].sort();
  runtime.runtimeVerified = true;
  runtime.action = options.action || ACTION.APPLIED;
  runtime.evidenceAt = new Date().toISOString();
  runtime.updatedAt = runtime.evidenceAt;
  if (!routes.has("home")) {
    runtime.status = STATUS.PENDING;
    runtime.reasonCode = REASON.HOME_ROUTE_PENDING;
  } else if (!routes.has("task")) {
    runtime.status = STATUS.PENDING;
    runtime.reasonCode = REASON.TASK_ROUTE_PENDING;
  } else {
    runtime.status = STATUS.HEALTHY;
    runtime.reasonCode = REASON.RUNTIME_VERIFIED;
  }
  return writeRuntimeState(options["state-root"], runtime);
}

async function main() {
  const options = parse(process.argv.slice(2));
  const result = options.command === "pending" ? await pending(options)
    : options.command === "verified" ? await verified(options) : null;
  if (!result) throw new Error(`unknown command: ${options.command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
