import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
}

const targetRoot = path.resolve(option("--target"));
const applicationSupportRoot = path.resolve(option("--application-support"));
const targetApp = option("--app");
const desiredFilename = "desired-state.json";
const targetDesiredPath = path.join(targetRoot, desiredFilename);
const allowedEntries = [
  "desired-state.json.backup",
  "images",
  "migration-backups",
  "recovery-attempts.json",
  "recovery-attempts.json.backup",
  "rollback",
  "theme",
  "theme-backup.json",
  "themes",
];

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function regularJson(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return null;
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function assertSafeTree(entry) {
  const stat = await fs.lstat(entry);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error(`Unsupported state entry: ${entry}`);
  }
  if (!stat.isDirectory()) return;
  for (const child of await fs.readdir(entry)) {
    await assertSafeTree(path.join(entry, child));
  }
}

async function exists(entry) {
  try {
    await fs.lstat(entry);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function copyEntry(sourceRoot, name) {
  const source = path.join(sourceRoot, name);
  const destination = path.join(targetRoot, name);
  if (!(await exists(source)) || await exists(destination)) return;
  await assertSafeTree(source);
  const temporary = path.join(
    targetRoot,
    `.namespace-migration-${process.pid}-${crypto.randomUUID()}-${name}`,
  );
  await fs.cp(source, temporary, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  await fs.rename(temporary, destination);
}

async function main() {
  if (path.dirname(targetRoot) !== applicationSupportRoot ||
      !inside(applicationSupportRoot, targetRoot)) {
    throw new Error("Target state directory must be a direct Application Support child");
  }
  await fs.mkdir(targetRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(targetRoot, 0o700);
  const currentDesired = await exists(targetDesiredPath)
    ? await regularJson(targetDesiredPath)
    : null;

  const candidates = [];
  for (const entry of await fs.readdir(applicationSupportRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === path.basename(targetRoot)) continue;
    const root = path.join(applicationSupportRoot, entry.name);
    try {
      const desired = await regularJson(path.join(root, desiredFilename));
      if (desired?.schemaVersion !== 2 || desired?.app !== targetApp ||
          !Number.isSafeInteger(desired?.generation) || desired.generation < 0) {
        continue;
      }
      candidates.push({ root, desired });
    } catch {
      // Unrelated Application Support entries are intentionally ignored.
    }
  }
  candidates.sort((left, right) => {
    const generation = right.desired.generation - left.desired.generation;
    if (generation !== 0) return generation;
    return String(right.desired.updatedAt || "").localeCompare(String(left.desired.updatedAt || ""));
  });
  if (candidates.length === 0) {
    console.log(JSON.stringify({
      migrated: false,
      reason: currentDesired ? "current_state_exists" : "no_compatible_state",
    }));
    return;
  }

  const selected = candidates[0];
  const currentIsBootstrapState = currentDesired?.schemaVersion === 2 &&
    currentDesired?.app === targetApp &&
    currentDesired?.desiredTheme?.id === "native" &&
    currentDesired?.desiredTheme?.version === "system" &&
    Number.isSafeInteger(currentDesired?.generation) &&
    selected.desired.generation > currentDesired.generation;
  if (currentDesired && !currentIsBootstrapState) {
    console.log(JSON.stringify({ migrated: false, reason: "current_state_exists" }));
    return;
  }
  for (const name of allowedEntries) await copyEntry(selected.root, name);
  const desired = {
    ...selected.desired,
    migration: {
      migratedAt: new Date().toISOString(),
      source: "application-support-namespace",
    },
  };
  const temporaryDesired = path.join(
    targetRoot,
    `.namespace-migration-${process.pid}-${crypto.randomUUID()}.json`,
  );
  await fs.writeFile(temporaryDesired, `${JSON.stringify(desired, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  if (currentDesired) {
    const backup = path.join(targetRoot, "desired-state.namespace-backup.json");
    if (!(await exists(backup))) await fs.copyFile(targetDesiredPath, backup);
  }
  await fs.rename(temporaryDesired, targetDesiredPath);
  await fs.chmod(targetDesiredPath, 0o600);
  console.log(JSON.stringify({ migrated: true }));
}

await main();
