import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ACTION, REASON, STATUS } from "./state-contract.mjs";
import { readStrictJson, statePaths, structuredStatus, validateRuntimeState } from "./state-store.mjs";

const run = promisify(execFile);

async function command(file, args) {
  try {
    return (await run(file, args, { encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
  } catch {
    return "";
  }
}

async function commandResult(file, args, options = {}) {
  try {
    const result = await run(file, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
    return { stdout: result.stdout.trim(), exitCode: 0 };
  } catch (error) {
    return {
      stdout: String(error?.stdout || "").trim(),
      exitCode: Number.isSafeInteger(error?.code) ? error.code : 1,
    };
  }
}

async function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  const output = await command("/bin/ps", ["-p", String(pid), "-o", "ppid=", "-o", "lstart=", "-o", "command="]);
  const match = output.match(/^\s*(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([\s\S]+)$/);
  return match ? { ppid: Number(match[1]), startedAt: match[2].replace(/\s+/g, " "), command: match[3] } : null;
}

async function isDescendant(pid, ancestor) {
  let current = pid;
  for (let depth = 0; depth < 32 && current > 1; depth += 1) {
    if (current === ancestor) return true;
    const info = await processInfo(current);
    if (!info || info.ppid === current) return false;
    current = info.ppid;
  }
  return false;
}

function pending(base, reasonCode) {
  return { ...base, status: STATUS.PENDING, runtimeVerified: false, action: ACTION.NONE, reasonCode };
}

export function conflictingInjectorPids(processList, runtime) {
  if (!Number.isSafeInteger(runtime?.injectorPid) || !Number.isSafeInteger(runtime?.port)) return [];
  return String(processList || "").split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+([\s\S]+)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    const processCommand = match[2];
    if (pid === runtime.injectorPid ||
        !processCommand.includes("injector.mjs") ||
        !processCommand.includes("--watch") ||
        !processCommand.includes(`--port ${runtime.port}`)) {
      return [];
    }
    return [pid];
  });
}

export function rendererVerificationMatches(output, runtime) {
  let document;
  try {
    document = JSON.parse(output);
  } catch {
    return false;
  }
  if (!Array.isArray(document?.targets) || document.targets.length === 0) return false;
  return document.targets.every(({ result }) =>
    result?.installed === true &&
    result?.stylePresent === true &&
    result?.chromePresent === true &&
    result?.themeId === runtime.verifiedThemeId &&
    result?.themeVersion === runtime.verifiedThemeVersion &&
    result?.desiredGeneration === runtime.desiredGeneration
  );
}

export async function inspectRuntimeHealth(stateRoot) {
  const contract = await structuredStatus(stateRoot);
  let runtime;
  try {
    runtime = validateRuntimeState(await readStrictJson(statePaths(stateRoot).runtime));
  } catch {
    return pending(contract, REASON.RUNTIME_EVIDENCE_INVALID);
  }
  // A renderer can have verified the active home or task route while the
  // broader two-route release gate is still pending. Continue validating the
  // recorded process/listener identity before preserving that live evidence.
  if (!runtime.runtimeVerified) return contract;

  const codex = await processInfo(runtime.codexPid);
  if (!codex) return pending(contract, REASON.CODEX_PROCESS_MISSING);
  if (!runtime.codexExe || !codex.command.startsWith(runtime.codexExe) || codex.startedAt !== runtime.codexStartedAt) {
    return pending(contract, REASON.CODEX_PROCESS_MISMATCH);
  }
  try {
    const infoPath = path.join(runtime.codexBundle, "Contents", "Info.plist");
    await fs.access(infoPath);
    const currentVersion = await command("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPath]);
    if (!currentVersion || currentVersion !== runtime.hostVersion) return pending(contract, REASON.CODEX_VERSION_MISMATCH);
  } catch {
    return pending(contract, REASON.CODEX_VERSION_MISMATCH);
  }

  const injector = await processInfo(runtime.injectorPid);
  if (!injector) return pending(contract, REASON.INJECTOR_PROCESS_MISSING);
  const injectorIdentity = runtime.injectorPath && runtime.themeDir &&
    injector.command.includes(runtime.injectorPath) && injector.command.includes("--watch") &&
    injector.command.includes(`--port ${runtime.port}`) && injector.command.includes(`--theme-dir ${runtime.themeDir}`) &&
    injector.startedAt === runtime.injectorStartedAt;
  if (!injectorIdentity) return pending(contract, REASON.INJECTOR_PROCESS_MISMATCH);

  const listenerOutput = await command("/usr/sbin/lsof", ["-nP", `-iTCP:${runtime.port}`, "-sTCP:LISTEN", "-Fpn"]);
  if (!listenerOutput) return pending(contract, REASON.CDP_LISTENER_MISSING);
  const listenerPids = [];
  let listenerPid = 0;
  let loopbackOnly = true;
  for (const line of listenerOutput.split("\n")) {
    if (line.startsWith("p")) {
      listenerPid = Number(line.slice(1));
      if (Number.isSafeInteger(listenerPid)) listenerPids.push(listenerPid);
    } else if (line.startsWith("n")) {
      const address = line.slice(1);
      if (!address.startsWith(`127.0.0.1:${runtime.port}`)) loopbackOnly = false;
    }
  }
  if (!loopbackOnly) return pending(contract, REASON.CDP_NOT_LOOPBACK);
  let ownerMatches = false;
  for (const pid of new Set(listenerPids)) {
    if (await isDescendant(pid, runtime.codexPid)) {
      ownerMatches = true;
      break;
    }
  }
  if (!ownerMatches) return pending(contract, REASON.CDP_OWNER_MISMATCH);
  const cdp = await command("/usr/bin/curl", ["--noproxy", "*", "--silent", "--fail", "--max-time", "1", `http://127.0.0.1:${runtime.port}/json/version`]);
  if (!cdp) return pending(contract, REASON.CDP_UNREACHABLE);

  const processList = await command("/bin/ps", ["-axo", "pid=,command="]);
  if (conflictingInjectorPids(processList, runtime).length > 0) {
    return pending(contract, REASON.CONFLICTING_INJECTOR_PROCESS);
  }

  const liveVerification = await commandResult(process.execPath, [
    runtime.injectorPath,
    "--verify",
    "--port", String(runtime.port),
    "--theme-dir", runtime.themeDir,
    "--desired-generation", String(runtime.desiredGeneration),
    "--timeout-ms", "4000",
  ], { timeout: 7000 });
  if (!liveVerification.stdout) {
    return pending(contract, REASON.RENDERER_VERIFICATION_FAILED);
  }
  if (!rendererVerificationMatches(liveVerification.stdout, runtime)) {
    return pending(contract, REASON.RENDERER_THEME_MISMATCH);
  }
  return { ...contract, runtimeVerified: true };
}

const stateRootIndex = process.argv.indexOf("--state-root");
if (stateRootIndex >= 0) {
  const stateRoot = process.argv[stateRootIndex + 1] || "";
  inspectRuntimeHealth(stateRoot).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
