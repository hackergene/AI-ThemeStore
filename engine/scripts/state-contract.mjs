export const STATE_SCHEMA_VERSION = 2;
export const APP_ID = "codex";
export const PROFILE_ID = "default";
export const ADAPTER_ID = "codex-restricted-v1";

export const STATUS = Object.freeze({
  HEALTHY: "healthy",
  PENDING: "pending",
  SAFE_MODE: "safe_mode",
  FAILED: "failed",
});

export const ACTION = Object.freeze({
  NONE: "none",
  RELAUNCHED: "relaunched",
  APPLIED: "applied",
  ROLLED_BACK: "rolled_back",
  RESTORED: "restored",
});

export const REASON = Object.freeze({
  RUNTIME_VERIFIED: "runtime_verified",
  RUNTIME_EVIDENCE_MISSING: "runtime_evidence_missing",
  RUNTIME_EVIDENCE_INVALID: "runtime_evidence_invalid",
  CODEX_PROCESS_MISSING: "codex_process_missing",
  CODEX_PROCESS_MISMATCH: "codex_process_mismatch",
  CODEX_VERSION_MISMATCH: "codex_version_mismatch",
  CODEX_NOT_RUNNING: "codex_not_running",
  ESTABLISHED_SESSION_PENDING: "established_session_pending",
  INJECTOR_PROCESS_MISSING: "injector_process_missing",
  INJECTOR_PROCESS_MISMATCH: "injector_process_mismatch",
  CONFLICTING_INJECTOR_PROCESS: "conflicting_injector_process",
  CDP_LISTENER_MISSING: "cdp_listener_missing",
  CDP_NOT_LOOPBACK: "cdp_not_loopback",
  CDP_OWNER_MISMATCH: "cdp_owner_mismatch",
  CDP_UNREACHABLE: "cdp_unreachable",
  RENDERER_VERIFICATION_FAILED: "renderer_verification_failed",
  RENDERER_THEME_MISMATCH: "renderer_theme_mismatch",
  LEGACY_RUNTIME_UNVERIFIED: "legacy_runtime_unverified",
  DESIRED_GENERATION_MISMATCH: "desired_generation_mismatch",
  DESIRED_THEME_MISMATCH: "desired_theme_mismatch",
  HOME_ROUTE_PENDING: "home_route_pending",
  TASK_ROUTE_PENDING: "task_route_pending",
  AUTO_RESTORE_PAUSED: "auto_restore_paused",
  NATIVE_SELECTED: "native_selected",
  SAFE_MODE_ENABLED: "safe_mode_enabled",
  MIGRATION_THEME_UNRECOGNIZED: "migration_theme_unrecognized",
  MIGRATION_FAILED: "migration_failed",
  APPLY_STAGED: "apply_staged",
  APPLY_VERIFICATION_FAILED: "apply_verification_failed",
  APPLY_COMMITTED: "apply_committed",
  ROLLBACK_APPLIED: "rollback_applied",
  ROLLBACK_FAILED_NATIVE_SAFE_MODE: "rollback_failed_native_safe_mode",
  RECOVERY_ATTEMPT_CLAIMED: "recovery_attempt_claimed",
  RECOVERY_ATTEMPT_ALREADY_USED: "recovery_attempt_already_used",
  RECOVERY_SUCCEEDED: "recovery_succeeded",
  RECOVERY_FAILED: "recovery_failed",
});

export const CONTRACT_STATUSES = new Set(Object.values(STATUS));
export const CONTRACT_ACTIONS = new Set(Object.values(ACTION));
export const CONTRACT_REASONS = new Set(Object.values(REASON));
