import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REASON } from "./state-contract.mjs";
import { atomicWriteJson, enableSafeMode, readStrictJson, statePaths } from "./state-store.mjs";

function parse(argv) {
  const value = { command: argv[0], stateRoot: "", key: "", outcome: "" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--state-root") value.stateRoot = argv[++index] || "";
    else if (arg === "--key") value.key = argv[++index] || "";
    else if (arg === "--outcome") value.outcome = argv[++index] || "";
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!value.stateRoot || !value.key || value.key.length > 1024) throw new Error("state root and bounded attempt key are required");
  return value;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const paths = statePaths(options.stateRoot);
  const filename = path.join(paths.root, "recovery-attempts.json");
  const hash = crypto.createHash("sha256").update(options.key).digest("hex");
  const current = await readStrictJson(filename, { missing: { schemaVersion: 1, consecutiveFailures: 0, attempts: {} } });
  if (current.schemaVersion !== 1 || !current.attempts || typeof current.attempts !== "object") throw new Error("recovery attempt state is invalid");
  const attempts = Object.fromEntries(Object.entries(current.attempts).slice(-63));
  let result;
  if (options.command === "claim") {
    if (attempts[hash]) {
      result = { claimed: false, reasonCode: REASON.RECOVERY_ATTEMPT_ALREADY_USED, attemptId: hash };
    } else {
      attempts[hash] = { claimedAt: new Date().toISOString(), outcome: "running" };
      await atomicWriteJson(filename, { ...current, attempts, updatedAt: new Date().toISOString() });
      result = { claimed: true, reasonCode: REASON.RECOVERY_ATTEMPT_CLAIMED, attemptId: hash };
    }
  } else if (options.command === "finish") {
    if (!attempts[hash]) throw new Error("recovery attempt was not claimed");
    if (!new Set(["success", "failure"]).has(options.outcome)) throw new Error("outcome must be success or failure");
    attempts[hash] = { ...attempts[hash], outcome: options.outcome, finishedAt: new Date().toISOString() };
    const consecutiveFailures = options.outcome === "success" ? 0 : Number(current.consecutiveFailures || 0) + 1;
    await atomicWriteJson(filename, { ...current, attempts, consecutiveFailures, updatedAt: new Date().toISOString() });
    let safeMode = false;
    if (consecutiveFailures >= 2) {
      await enableSafeMode(options.stateRoot);
      safeMode = true;
    }
    result = {
      finished: true,
      reasonCode: options.outcome === "success" ? REASON.RECOVERY_SUCCEEDED : REASON.RECOVERY_FAILED,
      consecutiveFailures,
      safeMode,
      attemptId: hash,
    };
  } else {
    throw new Error(`unknown command: ${options.command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

