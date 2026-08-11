#!/bin/bash

set -euo pipefail

if [ -z "${HOME:-}" ]; then
  CURRENT_USER="$(/usr/bin/id -un)"
  HOME="$(/usr/bin/dscl . -read "/Users/$CURRENT_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
  [ -n "$HOME" ] || { printf 'AI ThemeStore: could not resolve the current macOS home directory.\n' >&2; exit 1; }
  export HOME
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
INJECTOR="$SCRIPT_DIR/injector.mjs"
INSTALL_ROOT="$HOME/.codex/ai-themestore"
STATE_ROOT="$HOME/Library/Application Support/AIThemeStore"
STATE_PATH="$STATE_ROOT/state.json"
DESIRED_STATE_PATH="$STATE_ROOT/desired-state.json"
RUNTIME_STATE_PATH="$STATE_ROOT/runtime-state.json"
STATE_STORE="$SCRIPT_DIR/state-store.mjs"
NAMESPACE_MIGRATOR="$SCRIPT_DIR/namespace-migration.mjs"
THEME_TRANSACTION="$SCRIPT_DIR/theme-transaction.mjs"
RUNTIME_RECORDER="$SCRIPT_DIR/runtime-recorder.mjs"
THEME_BACKUP_PATH="$STATE_ROOT/theme-backup.json"
THEME_DIR="${AI_THEMESTORE_THEME_DIR:-$STATE_ROOT/theme}"
CONFIG_PATH="$HOME/.codex/config.toml"
INJECTOR_LOG="$STATE_ROOT/injector.log"
INJECTOR_ERROR_LOG="$STATE_ROOT/injector-error.log"
APP_LOG="$STATE_ROOT/codex-launch.log"
APP_ERROR_LOG="$STATE_ROOT/codex-launch-error.log"
START_ERROR_LOG="$STATE_ROOT/start-error.log"
CODEX_APP_JOB_LABEL="com.openai.ai-themestore.app"
INJECTOR_JOB_LABEL="com.openai.ai-themestore.injector"
EXPECTED_CODEX_TEAM_ID="${CODEX_EXPECTED_TEAM_ID:-2DC432GLL2}"
if [ -f "$PROJECT_ROOT/VERSION" ]; then
  SKIN_VERSION="$(/usr/bin/tr -d '[:space:]' < "$PROJECT_ROOT/VERSION")"
elif [ -f "$PROJECT_ROOT/../../Info.plist" ]; then
  # Native App bundles keep their canonical version in Contents/Info.plist.
  # This fallback prevents a missing copied VERSION file from disabling every
  # bridge action before a structured status response can be produced.
  SKIN_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$PROJECT_ROOT/../../Info.plist")"
else
  printf 'AI ThemeStore: runtime version metadata is missing.\n' >&2
  exit 1
fi
[ -n "$SKIN_VERSION" ] || {
  printf 'AI ThemeStore: runtime version metadata is empty.\n' >&2
  exit 1
}

fail() {
  local message="$*"
  if [ -n "${START_ERROR_LOG:-}" ] && [ -n "${STATE_ROOT:-}" ]; then
    /bin/mkdir -p "$STATE_ROOT" 2>/dev/null || true
    printf '%s %s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$message" >> "$START_ERROR_LOG" 2>/dev/null || true
  fi
  printf 'AI ThemeStore: %s\n' "$message" >&2
  exit 1
}

ensure_state_root() {
  ensure_node_runtime
  "$NODE" "$NAMESPACE_MIGRATOR" \
    --target "$STATE_ROOT" \
    --application-support "$HOME/Library/Application Support" \
    --app codex >/dev/null
  /bin/mkdir -p "$STATE_ROOT"
  /bin/chmod 700 "$STATE_ROOT"
}

ensure_state_model() {
  ensure_node_runtime
  "$NODE" "$STATE_STORE" migrate --state-root "$STATE_ROOT" >/dev/null
}

json_file_field() {
  local file="$1"
  local key="$2"
  "$NODE" -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "$file" "$key"
}

runtime_field() {
  json_file_field "$RUNTIME_STATE_PATH" "$1"
}

desired_field() {
  json_file_field "$DESIRED_STATE_PATH" "$1"
}

discover_codex_app() {
  local candidate=""
  local identifier=""
  local executable_name=""
  local configured="${CODEX_APP_BUNDLE:-}"

  for candidate in "$configured" "/Applications/ChatGPT.app" "$HOME/Applications/ChatGPT.app"; do
    [ -n "$candidate" ] || continue
    [ -f "$candidate/Contents/Info.plist" ] || continue
    identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
    if [ "$identifier" = "com.openai.codex" ]; then
      CODEX_BUNDLE="$candidate"
      break
    fi
  done

  if [ -z "${CODEX_BUNDLE:-}" ]; then
    candidate="$(/usr/bin/mdfind 'kMDItemCFBundleIdentifier == "com.openai.codex"' | /usr/bin/head -n 1)"
    if [ -n "$candidate" ] && [ -f "$candidate/Contents/Info.plist" ]; then
      identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
      [ "$identifier" = "com.openai.codex" ] && CODEX_BUNDLE="$candidate"
    fi
  fi

  [ -n "${CODEX_BUNDLE:-}" ] || fail "Could not find the official Codex app bundle (com.openai.codex)."
  executable_name="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$CODEX_BUNDLE/Contents/Info.plist")"
  CODEX_EXE="$CODEX_BUNDLE/Contents/MacOS/$executable_name"
  CODEX_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$CODEX_BUNDLE/Contents/Info.plist")"
  [ -x "$CODEX_EXE" ] || fail "Codex executable is missing: $CODEX_EXE"
  export CODEX_BUNDLE CODEX_EXE CODEX_VERSION
}

codesign_team_id() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 \
    | /usr/bin/awk -F= '/^TeamIdentifier=/{print $2; exit}'
}

require_macos_runtime() {
  [ "$(/usr/bin/uname -s)" = "Darwin" ] || fail "This launcher requires macOS."
  [ -n "${CODEX_BUNDLE:-}" ] || fail "Discover the Codex app before validating its runtime."

  RUNTIME_NODE="$CODEX_BUNDLE/Contents/Resources/cua_node/bin/node"
  [ -x "$RUNTIME_NODE" ] || fail "The signed Node.js runtime bundled with Codex was not found: $RUNTIME_NODE"
  /usr/bin/codesign --verify --deep --strict "$CODEX_BUNDLE" >/dev/null 2>&1 \
    || fail "The Codex app signature is not valid. Restore or reinstall the official app before continuing."
  /usr/bin/codesign --verify --strict "$RUNTIME_NODE" >/dev/null 2>&1 \
    || fail "The Node.js runtime bundled with Codex failed code-signature validation."

  CODEX_TEAM_ID="$(codesign_team_id "$CODEX_BUNDLE")"
  NODE_TEAM_ID="$(codesign_team_id "$RUNTIME_NODE")"
  [ "$CODEX_TEAM_ID" = "$EXPECTED_CODEX_TEAM_ID" ] \
    || fail "Unexpected Codex signing team: ${CODEX_TEAM_ID:-missing}."
  [ "$NODE_TEAM_ID" = "$CODEX_TEAM_ID" ] \
    || fail "The bundled Node.js signer does not match the Codex app signer."

  local machine_arch
  local node_major
  machine_arch="$(/usr/bin/uname -m)"
  /usr/bin/file "$RUNTIME_NODE" | /usr/bin/grep -q "$machine_arch" \
    || fail "The Codex Node.js runtime does not match this Mac architecture ($machine_arch)."
  NODE_VERSION="$($RUNTIME_NODE --version)"
  node_major="${NODE_VERSION#v}"
  node_major="${node_major%%.*}"
  case "$node_major" in ''|*[!0-9]*) fail "Could not parse bundled Node.js version: $NODE_VERSION" ;; esac
  [ "$node_major" -ge 20 ] || fail "Codex bundled Node.js $NODE_VERSION is too old; version 20 or newer is required."

  NODE="$RUNTIME_NODE"
  export NODE RUNTIME_NODE NODE_VERSION CODEX_TEAM_ID NODE_TEAM_ID
}

codex_main_pids() {
  local pid
  local command_line
  while read -r pid command_line; do
    [ -n "$pid" ] || continue
    case "$command_line" in
      "$CODEX_EXE"*) printf '%s\n' "$pid" ;;
    esac
  done < <(/bin/ps -axo pid=,command=)
}

codex_is_running() {
  [ -n "$(codex_main_pids)" ]
}

process_started_at() {
  /bin/ps -p "$1" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}'
}

stop_codex() {
  local allow_force="${1:-false}"
  local deadline
  local pid

  release_codex_launchd_job
  codex_is_running || return 0
  /usr/bin/osascript -e 'tell application id "com.openai.codex" to quit' >/dev/null 2>&1 || true
  deadline=$((SECONDS + 15))
  while codex_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  codex_is_running || return 0

  [ "$allow_force" = "true" ] || fail "Codex did not close within 15 seconds; explicit restart authorization is required for a forced stop."
  while IFS= read -r pid; do
    [ -n "$pid" ] && /bin/kill -TERM "$pid" 2>/dev/null || true
  done < <(codex_main_pids)
  deadline=$((SECONDS + 5))
  while codex_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  if codex_is_running; then
    while IFS= read -r pid; do
      [ -n "$pid" ] && /bin/kill -KILL "$pid" 2>/dev/null || true
    done < <(codex_main_pids)
  fi
  /bin/sleep 0.5
  codex_is_running && fail "Codex could not be stopped safely."
  return 0
}

listener_pids() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u || true
}

port_is_available() {
  [ -z "$(listener_pids "$1")" ]
}

pid_is_codex_descendant() {
  local current="$1"
  local command_line=""
  local parent=""
  local depth=0
  while [ "$current" -gt 1 ] 2>/dev/null && [ "$depth" -lt 32 ]; do
    command_line="$(/bin/ps -p "$current" -o command= 2>/dev/null || true)"
    case "$command_line" in "$CODEX_EXE"*) return 0 ;; esac
    parent="$(/bin/ps -p "$current" -o ppid= 2>/dev/null | /usr/bin/awk '{$1=$1; print}')"
    case "$parent" in ''|*[!0-9]*) return 1 ;; esac
    [ "$parent" -ne "$current" ] || return 1
    current="$parent"
    depth=$((depth + 1))
  done
  return 1
}

port_belongs_to_codex() {
  local port="$1"
  local found_direct="false"
  local pid
  local command_line
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command_line" in
      "$CODEX_EXE"*) found_direct="true" ;;
      *) pid_is_codex_descendant "$pid" || return 1 ;;
    esac
  done < <(listener_pids "$port")
  [ "$found_direct" = "true" ]
}

# Cheap: can we talk to a loopback DevTools HTTP endpoint?
cdp_http_ready() {
  local port="$1"
  /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 \
    "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1
}

verified_cdp_endpoint() {
  local port="$1"
  # Prefer identity check, but accept loopback CDP if HTTP is healthy and a
  # ChatGPT/Codex process is listening (path case / helper PIDs can fail belongs).
  if port_belongs_to_codex "$port"; then
    cdp_http_ready "$port" || return 1
    return 0
  fi
  cdp_http_ready "$port" || return 1
  # Fallback: listener must still be ChatGPT-related.
  local pid command_line
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command_line" in
      *ChatGPT*|*Codex*|*codex*) return 0 ;;
    esac
  done < <(listener_pids "$port")
  return 1
}

select_available_port() {
  local preferred="$1"
  local candidate="$preferred"
  local last=$((preferred + 100))
  [ "$last" -le 65535 ] || last=65535
  while [ "$candidate" -le "$last" ]; do
    if port_is_available "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
  done
  fail "No free loopback port was found between $preferred and $last."
}

wait_for_cdp() {
  local port="$1"
  local deadline=$((SECONDS + 45))
  local last_note=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    # Fast path: HTTP up is enough to proceed once process identity is soft-ok.
    if cdp_http_ready "$port"; then
      if verified_cdp_endpoint "$port" || cdp_http_ready "$port"; then
        # If HTTP is up and ChatGPT is running, accept.
        if codex_is_running || verified_cdp_endpoint "$port"; then
          return 0
        fi
      fi
    fi
    if [ $((SECONDS - last_note)) -ge 8 ]; then
      last_note=$SECONDS
      printf 'Waiting for Codex debug port %s… (%ss)\n' "$port" "$SECONDS" >&2
    fi
    /bin/sleep 0.35
  done
  return 1
}

state_field() {
  local key="$1"
  "$NODE" -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "$STATE_PATH" "$key"
}

restore_runtime_context_from_state() {
  [ -f "$STATE_PATH" ] || return 0
  local value=""

  value="$(state_field codexBundle 2>/dev/null || true)"
  [ -z "$value" ] || CODEX_BUNDLE="$value"
  value="$(state_field codexExe 2>/dev/null || true)"
  [ -z "$value" ] || CODEX_EXE="$value"
  value="$(state_field codexVersion 2>/dev/null || true)"
  [ -z "$value" ] || CODEX_VERSION="$value"
  value="$(state_field codexTeamId 2>/dev/null || true)"
  [ -z "$value" ] || CODEX_TEAM_ID="$value"

  export CODEX_BUNDLE CODEX_EXE CODEX_VERSION CODEX_TEAM_ID
}

write_state() {
  local port="$1"
  local injector_pid="$2"
  local injector_started_at="$3"
  local codex_pid="$4"
  local node_ver="${NODE_VERSION:-unknown}"
  local bundle="${CODEX_BUNDLE:-}"
  local exe="${CODEX_EXE:-}"
  local app_ver="${CODEX_VERSION:-}"
  local team="${CODEX_TEAM_ID:-}"
  local codex_started_at=""
  [ "$codex_pid" = "0" ] || codex_started_at="$(process_started_at "$codex_pid")"
  "$NODE" "$RUNTIME_RECORDER" pending \
    --state-root "$STATE_ROOT" \
    --port "$port" \
    --injector-pid "$injector_pid" \
    --injector-started-at "$injector_started_at" \
    --injector-path "$INJECTOR" \
    --theme-dir "$THEME_DIR" \
    --codex-pid "${codex_pid:-0}" \
    --codex-started-at "$codex_started_at" \
    --host-version "$app_ver" \
    --codex-bundle "$bundle" \
    --codex-exe "$exe" \
    --codex-team-id "$team" >/dev/null
}

write_verified_runtime() {
  local verification="$1"
  local port="$2"
  local injector_pid="$3"
  local injector_started_at="$4"
  local codex_pid="$5"
  local action="${6:-applied}"
  local codex_started_at=""
  [ "$codex_pid" = "0" ] || codex_started_at="$(process_started_at "$codex_pid")"
  "$NODE" "$RUNTIME_RECORDER" verified \
    --state-root "$STATE_ROOT" \
    --verification "$verification" \
    --port "$port" \
    --injector-pid "$injector_pid" \
    --injector-started-at "$injector_started_at" \
    --injector-path "$INJECTOR" \
    --theme-dir "$THEME_DIR" \
    --codex-pid "${codex_pid:-0}" \
    --codex-started-at "$codex_started_at" \
    --host-version "${CODEX_VERSION:-}" \
    --codex-bundle "${CODEX_BUNDLE:-}" \
    --codex-exe "${CODEX_EXE:-}" \
    --codex-team-id "${CODEX_TEAM_ID:-}" \
    --action "$action" >/dev/null
}

stop_recorded_injector() {
  local recorded_state="$STATE_PATH"
  [ -f "$RUNTIME_STATE_PATH" ] && recorded_state="$RUNTIME_STATE_PATH"
  [ -f "$recorded_state" ] || return 0
  local pid
  local saved_start
  local saved_node
  local saved_injector
  local actual_start
  local command_line
  pid="$(json_file_field "$recorded_state" injectorPid 2>/dev/null || true)"
  # Already paused / no daemon
  if [ -z "${pid:-}" ] || [ "$pid" = "0" ]; then
    /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
    return 0
  fi
  /bin/kill -0 "$pid" 2>/dev/null || {
    /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
    return 0
  }
  saved_start="$(json_file_field "$recorded_state" injectorStartedAt 2>/dev/null || true)"
  saved_node="$(json_file_field "$recorded_state" nodePath 2>/dev/null || true)"
  saved_injector="$(json_file_field "$recorded_state" injectorPath 2>/dev/null || true)"
  # Soft identity check (macOS path case: /Users/Fei vs /Users/fei)
  local node_ok="true" inj_ok="true"
  if [ -n "$saved_node" ] && [ -n "${NODE:-}" ]; then
    [ "$(printf '%s' "$saved_node" | /usr/bin/tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$NODE" | /usr/bin/tr '[:upper:]' '[:lower:]')" ] || node_ok="false"
  fi
  if [ -n "$saved_injector" ] && [ -n "${INJECTOR:-}" ]; then
    [ "$(printf '%s' "$saved_injector" | /usr/bin/tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$INJECTOR" | /usr/bin/tr '[:upper:]' '[:lower:]')" ] || inj_ok="false"
  fi
  # If identity clearly wrong but process looks like our injector, still stop by cmdline.
  command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command_line" in
    *injector.mjs*--watch*) ;;
    *)
      if [ "$node_ok" = "true" ] && [ "$inj_ok" = "true" ]; then
        :
      else
        # Stale PID that is not our injector — ignore
        return 0
      fi
      ;;
  esac
  if [ -n "$saved_start" ]; then
    actual_start="$(process_started_at "$pid")"
    if [ -n "$actual_start" ] && [ "$actual_start" != "$saved_start" ]; then
      # PID recycled — do not kill stranger
      return 0
    fi
  fi
  /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  /bin/kill -TERM "$pid" 2>/dev/null || true
  local deadline=$((SECONDS + 6))
  while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  /bin/kill -KILL "$pid" 2>/dev/null || true
  return 0
}

stop_competing_injector_jobs() {
  local port="$1"
  local launch_domain="gui/$(/usr/bin/id -u)"
  local pid=""
  local label=""
  local deadline=0
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    label="$(/bin/launchctl list 2>/dev/null \
      | /usr/bin/awk -v target="$pid" '$1 == target { print $3; exit }')"
    if [ -n "$label" ]; then
      /bin/launchctl bootout "$launch_domain/$label" >/dev/null 2>&1 || true
      /bin/launchctl remove "$label" >/dev/null 2>&1 || true
    fi
    /bin/kill -TERM "$pid" 2>/dev/null || true
    deadline=$((SECONDS + 4))
    while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do
      /bin/sleep 0.1
    done
    /bin/kill -KILL "$pid" 2>/dev/null || true
  done < <(/bin/ps -axo pid=,command= | /usr/bin/awk -v port="--port $port" '
    index($0, "injector.mjs") && index($0, "--watch") && index($0, port) { print $1 }
  ')
}

launch_injector_daemon() {
  local port="$1"
  local theme_dir="${2:-$THEME_DIR}"
  local desired_generation="${3:-${AI_THEMESTORE_DESIRED_GENERATION:-0}}"
  local pid=""
  local launch_domain="gui/$(/usr/bin/id -u)"
  local deadline=$((SECONDS + 10))
  : > "$INJECTOR_LOG"
  : > "$INJECTOR_ERROR_LOG"
  # A pre-namespace launchd job can keep an older theme directory alive and
  # race the current watcher. Remove every watcher using this exact bundled
  # injector before creating the single canonical job.
  stop_competing_injector_jobs "$port"
  /bin/launchctl bootout "$launch_domain/$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if ! /bin/launchctl print "$launch_domain/$INJECTOR_JOB_LABEL" >/dev/null 2>&1; then break; fi
    /bin/sleep 0.1
  done
  if /bin/launchctl print "$launch_domain/$INJECTOR_JOB_LABEL" >/dev/null 2>&1; then
    fail "The previous injector launchd job did not stop."
  fi

  # A user launchd job survives the short-lived App bridge process. Direct
  # nohup children can be reaped when the Codex desktop task runner closes its
  # process group, even when they initially remain alive long enough to probe.
  /bin/launchctl submit -l "$INJECTOR_JOB_LABEL" -o "$INJECTOR_LOG" -e "$INJECTOR_ERROR_LOG" -- \
    "$NODE" "$INJECTOR" --watch --port "$port" --theme-dir "$theme_dir" \
    --desired-generation "$desired_generation" >/dev/null 2>&1 || true
  while [ "$SECONDS" -lt "$deadline" ]; do
    pid="$(/bin/launchctl print "$launch_domain/$INJECTOR_JOB_LABEL" 2>/dev/null \
      | /usr/bin/awk '/^[[:space:]]*pid = [0-9]+/{print $3; exit}')"
    if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
      printf '%s\n' "$pid"
      return 0
    fi
    /bin/sleep 0.2
  done

  # Fallback for hosts where launchctl submit is unavailable.
  /usr/bin/nohup "$NODE" "$INJECTOR" --watch --port "$port" --theme-dir "$theme_dir" \
    --desired-generation "$desired_generation" \
    >>"$INJECTOR_LOG" 2>>"$INJECTOR_ERROR_LOG" &
  pid="$!"
  /bin/sleep 0.4
  if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "$pid"
    return 0
  fi
  fail "The injector did not start. See $INJECTOR_ERROR_LOG and $INJECTOR_LOG"
}

# Resolve Node quickly: prefer known Codex path, else full runtime check.
ensure_node_runtime() {
  if [ -n "${NODE:-}" ] && [ -x "${NODE:-}" ]; then
    if [ -z "${NODE_VERSION:-}" ]; then
      NODE_VERSION="$("$NODE" --version 2>/dev/null || echo unknown)"
      export NODE_VERSION
    fi
    # Fill CODEX_* if missing so write_state does not explode under set -u
    : "${CODEX_BUNDLE:=}"
    : "${CODEX_EXE:=}"
    : "${CODEX_VERSION:=}"
    : "${CODEX_TEAM_ID:=}"
    return 0
  fi
  local candidate
  for candidate in \
    "/Applications/Codex.app/Contents/Resources/cua_node/bin/node" \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
    "$HOME/Applications/Codex.app/Contents/Resources/cua_node/bin/node"
  do
    if [ -x "$candidate" ]; then
      NODE="$candidate"
      NODE_VERSION="$("$NODE" --version 2>/dev/null || echo unknown)"
      export NODE NODE_VERSION
      : "${CODEX_BUNDLE:=/Applications/Codex.app}"
      : "${CODEX_EXE:=/Applications/Codex.app/Contents/MacOS/ChatGPT}"
      : "${CODEX_VERSION:=}"
      : "${CODEX_TEAM_ID:=}"
      restore_runtime_context_from_state
      return 0
    fi
  done
  discover_codex_app
  require_macos_runtime
}

# Fast path when CDP is already open: restart injector + one-shot inject.
# Returns 0 on success, 1 if CDP is not ready (caller should full-start).
hot_reapply_theme() {
  local port="${1:-9341}"
  local timeout_ms="${2:-8000}"
  local desired_generation="${AI_THEMESTORE_DESIRED_GENERATION:-0}"

  cdp_http_ready "$port" || return 1
  ensure_node_runtime || return 1
  if [ -f "$DESIRED_STATE_PATH" ] && [ "$desired_generation" = "0" ]; then
    desired_generation="$(desired_field generation 2>/dev/null || printf '0')"
  fi

  stop_recorded_injector 2>/dev/null || true
  # Kill any leftover watch injectors for this theme injector path
  local old
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    /bin/kill -TERM "$old" 2>/dev/null || true
  done < <(/bin/ps -axo pid=,command= | /usr/bin/awk -v inj="$INJECTOR" '
    index($0, inj) && index($0, "--watch") { print $1 }
  ')
  /bin/sleep 0.15

  local inj_pid
  inj_pid="$(launch_injector_daemon "$port" "$THEME_DIR" "$desired_generation")"
  /bin/sleep 0.25
  /bin/kill -0 "$inj_pid" 2>/dev/null || return 1

  # One-shot reloads theme files from disk (watch may still be starting).
  if ! "$NODE" "$INJECTOR" --once --port "$port" --theme-dir "$THEME_DIR" \
    --desired-generation "$desired_generation" --timeout-ms "$timeout_ms" >/dev/null 2>&1; then
    # Soft: keep watch running even if once flaked
    :
  fi

  local started_at codex_pid
  started_at="$(process_started_at "$inj_pid")"
  codex_pid="$(codex_main_pids 2>/dev/null | /usr/bin/head -n 1)"
  [ -n "$started_at" ] || started_at="$(/bin/date)"
  write_state "$port" "$inj_pid" "$started_at" "${codex_pid:-0}"
  return 0
}

# Always tear down any leftover launchd babysitter for the themed Codex process.
# Older builds used `launchctl submit` which can relaunch Codex after the user quits
# or after SwiftBar exits — that is unexpected and unwanted.
release_codex_launchd_job() {
  /bin/launchctl remove "gui/$(/usr/bin/id -u)/$CODEX_APP_JOB_LABEL" >/dev/null 2>&1 || true
  /bin/launchctl remove "$CODEX_APP_JOB_LABEL" >/dev/null 2>&1 || true
}

launch_codex_with_cdp() {
  local port="$1"
  local host_launcher="${THEMESTORE_HOST_LAUNCHER:-$PROJECT_ROOT/../../Helpers/themestore-host-launcher}"
  : > "$APP_LOG"
  : > "$APP_ERROR_LOG"
  release_codex_launchd_job
  # Keep Codex as its own LaunchServices application. Executing the bundle's
  # Mach-O as our child makes macOS attribute Codex privacy requests to
  # AI ThemeStore instead of the app that actually requested the capability.
  if [ -x "$host_launcher" ]; then
    /usr/bin/env -u AI_THEMESTORE_THEME_DIR -u AI_THEMESTORE_DESIRED_GENERATION \
      "$host_launcher" launch-codex --bundle "$CODEX_BUNDLE" --port "$port" \
      >>"$APP_LOG" 2>>"$APP_ERROR_LOG"
  else
    # Source/legacy installs without the native helper still use LaunchServices.
    /usr/bin/env -u AI_THEMESTORE_THEME_DIR -u AI_THEMESTORE_DESIRED_GENERATION \
      /usr/bin/open -na "$CODEX_BUNDLE" --args \
      --remote-debugging-address=127.0.0.1 \
      --remote-debugging-port="$port" \
      >>"$APP_LOG" 2>>"$APP_ERROR_LOG"
  fi
}

launch_codex_normally() {
  release_codex_launchd_job
  /usr/bin/env -u AI_THEMESTORE_THEME_DIR -u AI_THEMESTORE_DESIRED_GENERATION \
    /usr/bin/open -na "$CODEX_BUNDLE"
}
