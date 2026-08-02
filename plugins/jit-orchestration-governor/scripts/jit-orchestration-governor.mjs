#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const UNVERIFIED = "Unverified";
export const DIAGNOSTIC_FILE = "jit-orchestration-governor.jsonl";
export const CANONICAL_ORCHESTRATION_EFFECTS = Object.freeze([
  "browser",
  "build",
  "contract_change",
  "database_mutation",
  "dependency",
  "deployment",
  "destructive_operation",
  "external_communication",
  "filesystem_mutation",
  "git_history_rewrite",
  "migration",
  "privacy",
  "publication",
  "purchase",
  "release",
  "security",
  "source_mutation",
  "test"
]);
const MAX_DIAGNOSTIC_RECORD_BYTES = 2048;
const ACTION_KEYS = new Set([
  "immediate_intent", "estimated_duration_ms", "effects", "project_authority_granted",
  "seat0_coordination", "seat0_activity", "explicitly_atomic", "low_risk", "remedy_known",
  "delegation_overhead_dominates", "seat0_prohibited", "worker_owned_slice",
  "source_mutation_surface", "source_mutation_surfaces"
]);
const CANONICAL_EFFECTS = new Set(CANONICAL_ORCHESTRATION_EFFECTS);
const AUTHORITY_EFFECTS = new Set([
  "database_mutation", "deployment", "destructive_operation",
  "external_communication", "git_history_rewrite", "publication", "purchase", "release"
]);

let activeClassifier = null;
try {
  const activePath = path.join(os.homedir(), ".codex", "policies", "lib", "orchestration.mjs");
  if (fs.existsSync(activePath)) {
    const module = await import(pathToFileURL(activePath).href);
    if (typeof module.classifyJitOrchestration === "function") activeClassifier = module.classifyJitOrchestration;
    else if (typeof module.classifyImmediateIntent === "function") activeClassifier = module.classifyImmediateIntent;
  }
} catch {
  // The hook must remain fail-open for project work when policy support fails.
}

function fallbackClassifier(action) {
  if (!Array.isArray(action.effects)) throw new Error("effects must be an array");
  if (!Number.isInteger(action.estimated_duration_ms) || action.estimated_duration_ms < 0) {
    throw new Error("estimated_duration_ms must be a non-negative integer");
  }
  if (typeof action.immediate_intent !== "string" || !action.immediate_intent.trim()) {
    throw new Error("immediate_intent must be a non-empty string");
  }
  const effects = [...new Set(action.effects)].sort();
  const unknownEffect = effects.some((effect) => typeof effect !== "string" || !CANONICAL_EFFECTS.has(effect));
  const surfaces = Array.isArray(action.source_mutation_surfaces)
    ? action.source_mutation_surfaces
    : action.source_mutation_surface ? [action.source_mutation_surface] : [];
  const authority = effects.some((effect) => AUTHORITY_EFFECTS.has(effect));
  const workerEffect = effects.some((effect) => ["contract_change", "security", "privacy", "dependency", "migration", "build", "test", "browser"].includes(effect));
  const atomic = action.explicitly_atomic === true && action.low_risk === true && action.remedy_known === true &&
    action.delegation_overhead_dominates === true && action.seat0_prohibited !== true &&
    action.worker_owned_slice !== true && effects.length === 1 && effects[0] === "source_mutation" &&
    surfaces.length === 1 && action.estimated_duration_ms <= 300000;
  let classification = "worker_required";
  // Unknown or aliased effects are never eligible for the atomic allow path.
  // They deny only this action for every seat, rather than allowing a worker
  // to relabel an authority effect and bypass the metadata boundary.
  // Only the boolean literal true grants authority. A string such as "false"
  // or "true" never grants it and cannot weaken this boundary.
  if (unknownEffect) classification = "canonical_metadata_required";
  else if (authority && action.project_authority_granted !== true) classification = "project_authority_required";
  else if (action.seat0_activity && effects.length === 0 && surfaces.length === 0) classification = "seat0_owned";
  else if (!unknownEffect && atomic && !workerEffect) classification = "seat0_atomic_allowed";
  return { classification, classifier: "fallback", unknown_effect: unknownEffect };
}

function stateRoot(override) {
  if (override) return path.resolve(override);
  if (process.env.JIT_ORCHESTRATION_GOVERNOR_STATE_DIR) return path.resolve(process.env.JIT_ORCHESTRATION_GOVERNOR_STATE_DIR);
  if (process.env.PLUGIN_DATA) return path.join(path.resolve(process.env.PLUGIN_DATA), "jit-orchestration-governor");
  return path.join(os.homedir(), ".codex", "plugin-data", "jit-orchestration-governor");
}

function allow(additionalContext) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", ...(additionalContext ? { additionalContext } : {}) } };
}

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason }, systemMessage: reason };
}

function boundedAppend(root, record) {
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const file = path.join(root, DIAGNOSTIC_FILE);
    const bounded = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") bounded[key] = value.slice(0, 160);
      else if (typeof value === "boolean" || typeof value === "number") bounded[key] = value;
    }
    let line = JSON.stringify({ schema_version: 1, recorded_at: new Date().toISOString(), ...bounded });
    if (Buffer.byteLength(line) > MAX_DIAGNOSTIC_RECORD_BYTES) line = JSON.stringify({ schema_version: 1, recorded_at: new Date().toISOString(), outcome: "diagnostic_record_bounded" });
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  } catch {
    // Diagnostics are never an execution dependency.
  }
}

function actionMetadata(input) {
  const candidate = input?.tool_input?.jit_orchestration ?? input?.tool_input?.orchestration ?? input?.jit_orchestration;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const action = Object.fromEntries(Object.entries(candidate).filter(([key]) => ACTION_KEYS.has(key)));
  const seat = candidate.seat_id ?? candidate.seat ?? input?.seat_id;
  return { action, seat: typeof seat === "string" || typeof seat === "number" ? String(seat) : null };
}

function isMaterial(action) {
  return typeof action.immediate_intent === "string" && action.immediate_intent.length > 0 &&
    Number.isFinite(action.estimated_duration_ms) && Array.isArray(action.effects);
}

function isExplicitSeat0(seat) {
  return seat === "0" || seat?.trim().toLowerCase() === "seat-0" || seat?.trim().toLowerCase() === "seat 0";
}

function mustUseFallback(action) {
  if (!Array.isArray(action.effects)) return true;
  if (action.effects.some((effect) => typeof effect !== "string" || !CANONICAL_EFFECTS.has(effect))) return true;
  return action.project_authority_granted !== undefined && typeof action.project_authority_granted !== "boolean";
}

function fallbackFailureDisposition(root, seat) {
  boundedAppend(root, { outcome: "native_fallback", reason: "classifier_and_fallback_unavailable", seat: isExplicitSeat0(seat) ? "0" : "unverified", host_activation: UNVERIFIED });
  if (isExplicitSeat0(seat)) {
    return allow("Seat 0 JIT classification is unavailable. Agent System records this coverage warning but never enforces execution against Seat 0; external authority and safety constraints still apply.");
  }
  return allow("JIT classification evidence is unavailable; native project execution remains allowed. Host activation: Unverified.");
}

export function diagnosticPath(root) {
  return path.join(path.resolve(root), DIAGNOSTIC_FILE);
}

export function processHook(input, options = {}) {
  if (input?.hook_event_name !== "PreToolUse") return {};
  const root = stateRoot(options.stateRoot);
  const metadata = actionMetadata(input);
  if (!metadata || !isMaterial(metadata.action)) {
    if (metadata && isExplicitSeat0(metadata.seat)) {
      return fallbackFailureDisposition(root, metadata.seat);
    }
    boundedAppend(root, { outcome: "native_fallback", reason: "missing_material_action_metadata", host_activation: UNVERIFIED });
    return allow("JIT orchestration evidence is incomplete; native project execution remains allowed. Host activation: Unverified.");
  }
  let result;
  try {
    if (mustUseFallback(metadata.action)) {
      result = (options.fallbackClassifier ?? fallbackClassifier)(metadata.action);
    } else {
      const classifier = options.classifier ?? activeClassifier;
      result = classifier ? classifier(metadata.action) : fallbackClassifier(metadata.action);
    }
  } catch {
    try {
      result = (options.fallbackClassifier ?? fallbackClassifier)(metadata.action);
    } catch {
      return fallbackFailureDisposition(root, metadata.seat);
    }
  }
  const classification = result?.classification;
  const isSeat0 = isExplicitSeat0(metadata.seat);
  const actionDenied = !isSeat0 && (
    classification === "canonical_metadata_required" ||
    classification === "project_authority_required"
  );
  const evidence = {
    outcome: isSeat0 ? "seat0_advisory" : actionDenied ? "blocked" : "allowed",
    classification: typeof classification === "string" ? classification : "unknown",
    seat: isSeat0 ? "0" : "non-seat0",
    coverage: classification ? "classified" : "unverified",
    host_activation: UNVERIFIED
  };
  boundedAppend(root, evidence);
  if (isSeat0) {
    const authorityWarning = classification === "project_authority_required"
      ? " External project or user authority remains required."
      : "";
    return allow(`Seat 0 JIT advisory: ${classification || "unknown"}.${authorityWarning} Agent System records evidence and warnings but never enforces execution against Seat 0.`);
  }
  if (classification === "project_authority_required") {
    return deny("This action requires explicit project/user authority. Obtain that authority, then retry only this action; unrelated project work may continue.");
  }
  if (classification === "canonical_metadata_required") {
    return deny("This action declares a non-canonical effect. Supply complete canonical action metadata, then retry only this action; unrelated project work may continue.");
  }
  return allow(`JIT classification: ${classification || "unknown"}. Native project execution remains allowed. Host activation: Unverified.`);
}

function main() {
  if (process.argv[2] !== "hook") {
    process.stderr.write("Usage: jit-orchestration-governor.mjs hook\n");
    process.exitCode = 64;
    return;
  }
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    try { process.stdout.write(`${JSON.stringify(processHook(JSON.parse(raw)))}\n`); }
    catch { process.stdout.write(`${JSON.stringify(allow("JIT hook input could not be evaluated; native project execution remains allowed. Host activation: Unverified."))}\n`); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
