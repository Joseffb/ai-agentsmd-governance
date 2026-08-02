import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXECUTION_COMMON_FIELDS,
  EXECUTION_EVIDENCE_EVENT_SPECS,
  MATERIAL_DECISION_AUTHORITIES,
  MATERIAL_DECISION_SCOPES,
  projectCanonicalEventEnvelope,
  projectExecutionLifecycles
} from "./execution-evidence.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_EFFICIENCY_HOURLY_BUCKETS = 24;
const MAX_QUOTA_SNAPSHOT_DETAILS = 24;
const SOURCES = new Set(["operator", "seat_workflow", "runtime", "scheduler", "import"]);
const BASE_FIELDS = new Set([
  "schema_version",
  "event_id",
  "occurred_at",
  "recorded_at",
  "type",
  "project",
  "thread_id",
  "task_id",
  "work_id",
  "attempt_id",
  "seat_id",
  "source",
  "evidence_class",
  "evidence_authority",
  "coverage_status",
  ...EXECUTION_COMMON_FIELDS
]);

const EVIDENCE_CLASSES = Object.freeze(["observed", "user_report", "derived", "proposed", "unknown"]);
// This describes how a metric was evidenced. It is deliberately not an execution,
// authorization, or routing decision.
const EVIDENCE_AUTHORITIES = Object.freeze([
  "runtime_metadata", "operator_record", "imported_record", "derived_projection",
  "proposal", "unknown"
]);
const COVERAGE_STATUSES = Object.freeze(["complete", "partial", "unknown", "not_applicable"]);

const EVENT_SPECS = new Map([
  ["task.started", {}],
  ["task.result_usable", {}],
  ["task.completed", {}],
  ["task.restarted", {}],
  ["task.abandoned", {}],
  ["task.blocked", {}],
  ["workstream.registered", {
    fields: ["workstream_id", "evidence_class"],
    required: ["workstream_id", "evidence_class"],
    enums: { evidence_class: ["observed"] }
  }],
  ["estimate.manual_hours", { fields: ["manual_hours_estimate"], required: ["manual_hours_estimate"] }],
  ["estimate.manual_hours_avoided", { fields: ["manual_hours_avoided_estimate"], required: ["manual_hours_avoided_estimate"] }],
  ["seat.started", { required: ["seat_id"] }],
  ["seat.stopped", { required: ["seat_id"] }],
  ["seat.idle_started", { required: ["seat_id"] }],
  ["seat.idle_stopped", { required: ["seat_id"] }],
  ["seat.prepared", { required: ["seat_id"] }],
  ["seat.recovered", { required: ["seat_id"] }],
  ["seat.continued", { required: ["seat_id"] }],
  ["seat.finalized", { required: ["seat_id"] }],
  ["seat.relaunched", { required: ["seat_id"] }],
  ["seat.collision", { required: ["seat_id"] }],
  ["seat.continuation_failed", { required: ["seat_id"] }],
  ["operator.approval", { fields: ["material"], required: ["material"] }],
  ["operator.intervention", { fields: ["material"], required: ["material"] }],
  ["operator.redirect", { fields: ["material"], required: ["material"] }],
  ["operator.clarification", { fields: ["material"], required: ["material"] }],
  ["quality.acceptance", { fields: ["first_pass"], required: ["first_pass"] }],
  ["quality.rework", { fields: ["duration_ms"] }],
  ["quality.duplicated_work", { fields: ["duration_ms"], required: ["duration_ms"] }],
  ["quality.regression", {}],
  ["validation.completed", { fields: ["outcome"], required: ["outcome"], outcomes: ["passed", "failed"] }],
  ["proof.completed", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coverage.intervention", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coverage.quality", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coverage.validation", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coverage.proof", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coverage.seat_intervals", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coverage.duplicated_work", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coverage.coordination", { fields: ["outcome"], required: ["outcome"], outcomes: ["complete", "incomplete"] }],
  ["coordination.overhead", { fields: ["duration_ms"], required: ["duration_ms"] }],
  ["forecast.created", {
    fields: [
      "workstream_id", "p50_wall_clock_hours", "p80_wall_clock_hours",
      "critical_path_hours", "aggregate_seat_hours_estimate",
      "machine_validation_serial_hours", "machine_validation_parallel_hours",
      "operator_touch_hours_estimate", "operator_wait_hours_estimate",
      "manual_hours_p50", "manual_hours_p80", "rework_allowance_hours",
      "confidence", "sample_size", "assumption_count",
      "external_dependency_count", "stop_gate_count", "evidence_class"
    ],
    required: [
      "workstream_id", "p50_wall_clock_hours", "p80_wall_clock_hours",
      "critical_path_hours", "manual_hours_p50", "manual_hours_p80",
      "confidence", "sample_size", "evidence_class"
    ],
    enums: {
      confidence: ["low", "medium", "high"],
      evidence_class: ["proposed"]
    }
  }],
  ["forecast.remaining", {
    fields: [
      "workstream_id", "p50_remaining_hours", "p80_remaining_hours",
      "critical_path_remaining_hours",
      "machine_validation_serial_remaining_hours", "forecast_reason",
      "prior_forecast_event_id", "confidence", "evidence_class",
      "scope_version", "gate_count_total", "gate_count_complete"
    ],
    required: [
      "workstream_id", "p50_remaining_hours", "p80_remaining_hours",
      "critical_path_remaining_hours", "forecast_reason", "confidence",
      "evidence_class", "scope_version", "gate_count_total",
      "gate_count_complete"
    ],
    enums: {
      forecast_reason: [
        "initial", "gate_completed", "scope_change", "new_failure",
        "validation_floor_change", "parallelism_change",
        "calibration_update", "operator_change"
      ],
      confidence: ["low", "medium", "high"],
      evidence_class: ["proposed"]
    }
  }],
  ["estimate.conventional", {
    fields: [
      "workstream_id", "p50_hours", "p80_hours", "scope_class",
      "time_basis", "evidence_class", "qualification", "supersedes_event_id"
    ],
    required: [
      "workstream_id", "p50_hours", "p80_hours", "scope_class",
      "time_basis", "evidence_class", "qualification"
    ],
    enums: {
      scope_class: ["source_task", "accepted_product", "full_program", "historical_assumption", "slice"],
      time_basis: ["active_human_estimate"],
      evidence_class: ["proposed", "user_report"],
      qualification: ["primary", "narrower_scope", "full_program", "historical", "superseded"]
    }
  }],
  ["runtime.segment", {
    fields: [
      "workstream_id", "segment_id", "parent_segment_id", "duration_ms",
      "tokens_used", "runtime_status", "completeness", "evidence_class",
      "qualification", "supersedes_event_id"
    ],
    required: [
      "workstream_id", "segment_id", "runtime_status", "completeness",
      "evidence_class", "qualification"
    ],
    enums: {
      runtime_status: ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete", "unknown"],
      completeness: ["complete", "lower_bound", "unknown"],
      evidence_class: ["observed", "user_report", "unknown"],
      qualification: ["current_segment", "prior_segment", "historical_estimate", "measurement_boundary_unknown"]
    }
  }],
  ["runtime.gap", {
    fields: [
      "workstream_id", "segment_id", "parent_segment_id", "duration_ms",
      "completeness", "evidence_class", "qualification", "supersedes_event_id"
    ],
    required: ["workstream_id", "segment_id", "completeness", "evidence_class", "qualification"],
    enums: {
      completeness: ["complete", "lower_bound", "unknown"],
      evidence_class: ["observed", "user_report", "unknown"],
      qualification: ["inter_segment_gap", "uncounted_elapsed"]
    }
  }],
  ["runtime.tooling_fallback", {
    fields: ["evidence_class", "evidence_authority", "coverage_status"],
    enums: {
      evidence_class: ["observed", "user_report", "unknown"],
      evidence_authority: ["runtime_metadata", "operator_record", "imported_record", "unknown"],
      coverage_status: ["complete", "partial", "unknown", "not_applicable"]
    }
  }],
  ["token.usage", {
    fields: [
      "input_tokens", "output_tokens", "cached_input_tokens",
      "cache_write_input_tokens", "reasoning_output_tokens", "total_tokens",
      "provider_latency_ms", "evidence_class", "evidence_authority", "coverage_status"
    ],
    enums: {
      evidence_class: ["observed", "user_report", "unknown"],
      evidence_authority: ["runtime_metadata", "operator_record", "imported_record", "unknown"],
      coverage_status: ["complete", "partial", "unknown"]
    }
  }],
  ["token.quota_snapshot", {
    fields: [
      "used_percent", "window_minutes", "reset_at", "reset_epoch_seconds",
      "evidence_class", "evidence_authority", "coverage_status"
    ],
    enums: {
      evidence_class: ["observed", "user_report", "unknown"],
      evidence_authority: ["runtime_metadata", "operator_record", "imported_record", "unknown"],
      coverage_status: ["complete", "partial", "unknown"]
    }
  }],
  ["validation.run", {
    fields: [
      "workstream_id", "duration_ms", "outcome", "first_pass",
      "validation_mode", "completeness", "evidence_class"
    ],
    required: [
      "workstream_id", "duration_ms", "outcome", "validation_mode",
      "completeness", "evidence_class"
    ],
    outcomes: ["passed", "failed", "unknown"],
    enums: {
      validation_mode: ["serial", "parallel"],
      completeness: ["complete", "lower_bound", "unknown"],
      evidence_class: ["observed", "user_report"]
    }
  }],
  ["operator.touch", {
    fields: ["workstream_id", "duration_ms", "completeness", "evidence_class"],
    required: ["workstream_id", "duration_ms", "completeness", "evidence_class"],
    enums: {
      completeness: ["complete", "lower_bound", "unknown"],
      evidence_class: ["observed", "user_report"]
    }
  }],
  ["operator.wait", {
    fields: ["workstream_id", "duration_ms", "completeness", "evidence_class"],
    required: ["workstream_id", "duration_ms", "completeness", "evidence_class"],
    enums: {
      completeness: ["complete", "lower_bound", "unknown"],
      evidence_class: ["observed", "user_report"]
    }
  }],
  ["benchmark.qualification", {
    fields: [
      "workstream_id", "supersedes_event_id", "evidence_class",
      "qualification", "comparability"
    ],
    required: [
      "workstream_id", "supersedes_event_id", "evidence_class",
      "qualification", "comparability"
    ],
    enums: {
      evidence_class: ["observed", "user_report", "derived", "proposed"],
      qualification: [
        "scope_superseded", "boundary_superseded", "current_segment_only",
        "maximum_supported_bound", "sensitivity_only"
      ],
      comparability: ["comparable", "category_mismatch", "unknown"]
    }
  }],
  ["benchmark.compression_snapshot", {
    fields: [
      "workstream_id", "manual_hours_lower", "manual_hours_upper",
      "denominator_hours", "numerator_scope", "denominator_scope",
      "evidence_class", "qualification", "comparability"
    ],
    required: [
      "workstream_id", "manual_hours_lower", "manual_hours_upper",
      "denominator_hours", "numerator_scope", "denominator_scope",
      "evidence_class", "qualification", "comparability"
    ],
    enums: {
      numerator_scope: ["source_task", "accepted_product", "full_program", "slice"],
      denominator_scope: ["current_goal_segment", "complete_workstream"],
      evidence_class: ["derived"],
      qualification: ["operator_directed_current_segment", "complete_comparable"],
      comparability: ["comparable", "category_mismatch", "unknown"]
    }
  }],
  ["benchmark.estimate_sample", {
    fields: [
      "workstream_id", "response_artifact_id", "central_hours",
      "lower_hours", "upper_hours", "team_size", "variant",
      "evidence_class", "qualification", "model_family", "reasoning_level",
      "model_attestation", "spontaneous_ai_distinction"
    ],
    required: [
      "workstream_id", "central_hours", "lower_hours", "upper_hours",
      "team_size", "variant", "evidence_class", "qualification",
      "model_family", "reasoning_level", "model_attestation",
      "spontaneous_ai_distinction"
    ],
    enums: {
      variant: ["generic", "human_specific", "ai_specific", "telemetry_informed"],
      evidence_class: ["observed", "proposed"],
      qualification: ["blinded", "reconstructed_not_blinded", "operator_included_context_disclosed"],
      model_family: ["luna", "terra", "sol", "spark", "other", "unknown"],
      reasoning_level: ["low", "medium", "high", "xhigh", "max", "ultra", "unknown"],
      model_attestation: ["attested", "unverified"]
    }
  }],
  ["benchmark.probe", {
    fields: [
      "workstream_id", "prompt_fixture_id", "prompt_digest",
      "response_artifact_id", "variant", "sample_status", "evidence_class",
      "bootstrap_attestation", "prompt_purity", "invalid_reason",
      "central_hours", "lower_hours", "upper_hours", "team_size",
      "response_units", "spontaneous_ai_distinction",
      "requested_model_family", "requested_reasoning_level",
      "actual_model_family", "actual_reasoning_level", "model_attestation",
      "governance_release_id", "system_version"
    ],
    required: [
      "workstream_id", "prompt_fixture_id", "prompt_digest", "variant",
      "sample_status", "evidence_class", "bootstrap_attestation",
      "prompt_purity", "invalid_reason", "actual_model_family",
      "actual_reasoning_level", "model_attestation"
    ],
    enums: {
      variant: ["generic", "human_specific", "ai_specific", "telemetry_informed"],
      sample_status: ["admitted", "invalid", "invalid_contaminated"],
      evidence_class: ["observed"],
      bootstrap_attestation: ["current_hook_attested", "stale_parent", "missing", "unverified"],
      prompt_purity: ["pure", "contaminated"],
      invalid_reason: [
        "none", "stale_parent_no_current_hooks", "governance_prompt_contamination",
        "prohibited_prior_context_inspection", "raw_route_failures",
        "automatic_bootstrap_missing"
      ],
      response_units: ["engineering_hours", "calendar_days", "calendar_weeks", "calendar_months", "none"],
      requested_model_family: ["luna", "terra", "sol", "spark", "other", "default", "unknown"],
      requested_reasoning_level: ["low", "medium", "high", "xhigh", "max", "ultra", "default", "unknown"],
      actual_model_family: ["luna", "terra", "sol", "spark", "other", "unknown"],
      actual_reasoning_level: ["low", "medium", "high", "xhigh", "max", "ultra", "unknown"],
      model_attestation: ["attested", "unverified"]
    }
  }],
  ["governance.out_of_scope_attempt", {}],
  ["governance.authority_denial", {}],
  ["governance.stale_receipt_recovered", {}],
  ["governance.unsafe_mutation_prevented", {}],
  ["governance.restart_recovered", {}],
  ...Object.entries(EXECUTION_EVIDENCE_EVENT_SPECS)
]);
const TASK_SCOPED_PREFIXES = Object.freeze([
  "task.",
  "estimate.",
  "operator.",
  "quality.",
  "validation.",
  "proof.",
  "coverage.",
  "coordination.",
  "forecast.",
  "runtime.",
  "token.",
  "benchmark.",
  "workstream."
]);
const IDENTIFIER_FIELDS = Object.freeze([
  "thread_id", "task_id", "work_id", "attempt_id", "seat_id",
  "workstream_id", "segment_id", "parent_segment_id", "supersedes_event_id",
  "response_artifact_id", "prompt_fixture_id", "prompt_digest",
  "governance_release_id", "system_version", "prior_forecast_event_id",
  "scope_version", "execution_id", "correlation_id", "causation_id",
  "accepted_work_id", "revision", "accepted_by", "artifact_validation_ref",
  "linked_execution_id", "legacy_reference", "decision_id", "decision_scope",
  "decision_authority", "billing_benchmark_id", "billing_project_ref",
  "decision_revision", "decision_basis_ref", "decision_artifact_ref",
  "decision_type", "requested_action", "normal_path", "actor",
  "accepted_scope_id"
]);
const IDENTIFIER_ARRAY_FIELDS = Object.freeze([
  "authority_refs", "evidence_refs", "rule_refs", "alternative_codes",
  "result_event_ids", "artifact_refs", "validation_refs", "rework_event_ids"
]);
const DECISION_SUMMARY_FIELDS = Object.freeze([
  "reason_summary", "risk_summary", "expected_effect"
]);
const ENRICHED_DECISION_REQUIRED_FIELDS = Object.freeze([
  "decision_type", "requested_action", "normal_path", "authority_refs",
  "evidence_refs", "rule_refs", "reason_summary", "alternative_codes",
  "risk_summary", "expected_effect", "actor", "decision_artifact_ref",
  "result_event_ids"
]);
const ENRICHED_ACCEPTANCE_REQUIRED_FIELDS = Object.freeze([
  "accepted_scope_id", "artifact_refs", "validation_refs", "first_pass",
  "rework_event_ids"
]);
const HOUR_FIELDS = Object.freeze([
  "p50_wall_clock_hours", "p80_wall_clock_hours", "critical_path_hours",
  "aggregate_seat_hours_estimate", "machine_validation_serial_hours",
  "machine_validation_parallel_hours", "operator_touch_hours_estimate",
  "operator_wait_hours_estimate", "manual_hours_p50", "manual_hours_p80",
  "rework_allowance_hours", "p50_hours", "p80_hours",
  "central_hours", "lower_hours", "upper_hours", "p50_remaining_hours",
  "p80_remaining_hours", "critical_path_remaining_hours",
  "machine_validation_serial_remaining_hours", "manual_hours_lower",
  "manual_hours_upper", "denominator_hours"
]);
const COUNT_FIELDS = Object.freeze([
  "tokens_used", "input_tokens", "output_tokens", "cached_input_tokens",
  "cache_write_input_tokens", "reasoning_output_tokens", "total_tokens",
  "provider_latency_ms", "sample_size", "assumption_count",
  "external_dependency_count", "stop_gate_count", "team_size",
  "gate_count_total", "gate_count_complete"
]);
const QUOTA_NUMBER_FIELDS = Object.freeze(["used_percent", "window_minutes"]);
const BILLING_NUMBER_FIELDS = Object.freeze(["billing_quantity", "billing_rate_micros", "credit_amount_micros"]);

export const ENGINEERING_EVENT_TYPES = Object.freeze([...EVENT_SPECS.keys()]);
export const ENGINEERING_EVENT_FAMILIES = Object.freeze({
  Runtime: Object.freeze(["runtime.", "seat."]),
  Work: Object.freeze(["task.", "workstream.", "estimate.", "forecast.", "coordination.", "operator."]),
  Token: Object.freeze(["token."]),
  Acceptance: Object.freeze(["quality.", "validation.", "proof.", "coverage."]),
  Execution: Object.freeze(["execution.", "accepted_work.", "correlation.", "decision.", "billing."]),
  Utilization: Object.freeze(["seat.", "operator.touch", "operator.wait"])
});

// Kept separate from delivery metrics so incomplete execution evidence cannot
// be mistaken for acceptance, authorization, or a scheduling signal.
export function projectExecutionEvidenceLifecycles(events = []) {
  return projectExecutionLifecycles(events);
}

function fail(message) {
  throw new Error(message);
}

function isoTimestamp(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(`${label} must be an ISO-8601 timestamp`);
  return new Date(timestamp).toISOString();
}

function identifier(value, label, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) fail(`${label} is required`);
    return undefined;
  }
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    fail(`${label} must be an opaque identifier without whitespace or path separators`);
  }
  return value;
}

function projectSlug(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    fail("project must be a lowercase portable slug");
  }
  return value;
}

function nonNegativeNumber(value, label, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    fail(`${label} must be a finite non-negative number no greater than ${maximum}`);
  }
  return value;
}

function identifierArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 32) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array with no more than 32 identifiers`);
  }
  const normalized = value.map((item) => identifier(item, `${label} item`, true));
  if (new Set(normalized).size !== normalized.length) fail(`${label} must contain unique identifiers`);
  if (JSON.stringify([...normalized].sort()) !== JSON.stringify(normalized)) {
    fail(`${label} must be sorted`);
  }
  return normalized;
}

function boundedDecisionSummary(value, label) {
  if (typeof value !== "string" || !value.length || value.length > 240 || /[\r\n\u0000-\u001f]/u.test(value)) {
    fail(`${label} must be a single-line bounded summary no longer than 240 characters`);
  }
  if (/\b(?:prompt|reasoning|chain[- ]of[- ]thought|hidden[- ]reasoning)\b/iu.test(value)) {
    fail(`${label} must not contain prompt or reasoning content`);
  }
  return value;
}

export function engineeringLedgerPath(override = null) {
  return path.resolve(
    override ||
    process.env.ACG_METRICS_LEDGER ||
    path.join(os.homedir(), ".codex", "governance", "engineering-events.jsonl")
  );
}

export function normalizeEngineeringEvent(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("event must be an object");
  const type = input.type;
  const spec = EVENT_SPECS.get(type);
  if (!spec) fail(`Unknown engineering event type: ${String(type)}`);
  const allowed = new Set([...BASE_FIELDS, ...(spec.fields || [])]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`Engineering event contains prohibited or unknown fields: ${unknown.sort().join(", ")}`);
  for (const field of spec.required || []) {
    if (input[field] === undefined || input[field] === null) fail(`${field} is required for ${type}`);
  }

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const occurredAt = isoTimestamp(input.occurred_at || now.toISOString(), "occurred_at");
  const recordedAt = isoTimestamp(input.recorded_at || now.toISOString(), "recorded_at");
  const source = input.source || "operator";
  if (!SOURCES.has(source)) fail(`source must be one of: ${[...SOURCES].join(", ")}`);

  const normalized = {
    schema_version: 1,
    event_id: identifier(input.event_id || crypto.randomUUID(), "event_id", true),
    occurred_at: occurredAt,
    recorded_at: recordedAt,
    type,
    project: projectSlug(input.project),
    source
  };
  for (const [field, values] of Object.entries({
    evidence_class: EVIDENCE_CLASSES,
    evidence_authority: EVIDENCE_AUTHORITIES,
    coverage_status: COVERAGE_STATUSES
  })) {
    if (input[field] === undefined) continue;
    if (!values.includes(input[field])) fail(`${field} for ${type} must be one of: ${values.join(", ")}`);
    normalized[field] = input[field];
  }
  for (const field of IDENTIFIER_FIELDS) {
    const value = identifier(input[field], field, (spec.required || []).includes(field));
    if (value !== undefined) normalized[field] = value;
  }
  for (const field of IDENTIFIER_ARRAY_FIELDS) {
    if (input[field] === undefined) continue;
    normalized[field] = identifierArray(input[field], field, {
      allowEmpty: [
        "alternative_codes", "result_event_ids", "rework_event_ids"
      ].includes(field)
    });
  }
  for (const field of DECISION_SUMMARY_FIELDS) {
    if (input[field] !== undefined) normalized[field] = boundedDecisionSummary(input[field], field);
  }
  if (
    type !== "runtime.tooling_fallback" &&
    TASK_SCOPED_PREFIXES.some((prefix) => type.startsWith(prefix)) &&
    !normalized.thread_id &&
    !normalized.task_id &&
    !normalized.work_id &&
    !normalized.execution_id
  ) {
    fail(`${type} requires one of thread_id, task_id, or work_id`);
  }
  if (input.duration_ms !== undefined) {
    normalized.duration_ms = nonNegativeNumber(input.duration_ms, "duration_ms", 10 * 365 * DAY_MS);
  }
  if (input.manual_hours_estimate !== undefined) {
    normalized.manual_hours_estimate = nonNegativeNumber(
      input.manual_hours_estimate,
      "manual_hours_estimate",
      1_000_000
    );
  }
  if (input.manual_hours_avoided_estimate !== undefined) {
    normalized.manual_hours_avoided_estimate = nonNegativeNumber(
      input.manual_hours_avoided_estimate,
      "manual_hours_avoided_estimate",
      1_000_000
    );
  }
  if (input.material !== undefined) {
    if (typeof input.material !== "boolean") fail("material must be boolean");
    normalized.material = input.material;
  }
  if (input.first_pass !== undefined) {
    if (typeof input.first_pass !== "boolean") fail("first_pass must be boolean");
    normalized.first_pass = input.first_pass;
  }
  if (input.spontaneous_ai_distinction !== undefined) {
    if (typeof input.spontaneous_ai_distinction !== "boolean") {
      fail("spontaneous_ai_distinction must be boolean");
    }
    normalized.spontaneous_ai_distinction = input.spontaneous_ai_distinction;
  }
  if (input.outcome !== undefined) {
    if (!spec.outcomes?.includes(input.outcome)) {
      fail(`outcome for ${type} must be one of: ${(spec.outcomes || []).join(", ")}`);
    }
    normalized.outcome = input.outcome;
  }
  for (const field of HOUR_FIELDS) {
    if (input[field] !== undefined) {
      normalized[field] = nonNegativeNumber(input[field], field, 1_000_000);
    }
  }
  for (const field of COUNT_FIELDS) {
    if (input[field] === undefined) continue;
    const value = nonNegativeNumber(input[field], field, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(value)) fail(`${field} must be an integer`);
    normalized[field] = value;
  }
  for (const field of BILLING_NUMBER_FIELDS) {
    if (input[field] === undefined) continue;
    const value = nonNegativeNumber(input[field], field, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(value)) fail(`${field} must be an integer`);
    normalized[field] = value;
  }
  for (const [field, values] of Object.entries(spec.enums || {})) {
    if (input[field] === undefined) continue;
    if (!values.includes(input[field])) fail(`${field} for ${type} must be one of: ${values.join(", ")}`);
    normalized[field] = input[field];
  }
  if (spec.currency) {
    if (typeof input.billing_currency !== "string" || !/^[A-Z]{3}$/.test(input.billing_currency)) {
      fail("billing_currency must be a three-letter uppercase currency code");
    }
    normalized.billing_currency = input.billing_currency;
  }
  if (type === "token.usage" && ![
    "input_tokens", "output_tokens", "cached_input_tokens", "cache_write_input_tokens",
    "reasoning_output_tokens", "total_tokens", "provider_latency_ms"
  ].some((field) => normalized[field] !== undefined)) {
    fail("token.usage requires at least one observed token or provider latency field");
  }
  if (type === "token.quota_snapshot") {
    for (const field of QUOTA_NUMBER_FIELDS) {
      if (input[field] === undefined) continue;
      const maximum = field === "used_percent" ? 100 : 1_000_000;
      normalized[field] = nonNegativeNumber(input[field], field, maximum);
    }
    if (input.reset_at !== undefined) normalized.reset_at = isoTimestamp(input.reset_at, "reset_at");
    if (input.reset_epoch_seconds !== undefined) {
      const epoch = nonNegativeNumber(input.reset_epoch_seconds, "reset_epoch_seconds", Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(epoch)) fail("reset_epoch_seconds must be an integer");
      normalized.reset_epoch_seconds = epoch;
    }
    if (normalized.used_percent === undefined && normalized.window_minutes === undefined &&
        normalized.reset_at === undefined && normalized.reset_epoch_seconds === undefined) {
      fail("token.quota_snapshot requires an observed primary rate-limit field");
    }
  }
  if (
    normalized.supersedes_event_id !== undefined &&
    normalized.supersedes_event_id === normalized.event_id
  ) {
    fail("supersedes_event_id cannot reference the same event");
  }
  if (type === "accepted_work.recorded" &&
      ["revised", "superseded"].includes(normalized.acceptance_status) &&
      !normalized.supersedes_event_id) {
    fail(`${normalized.acceptance_status} accepted_work.recorded requires supersedes_event_id`);
  }
  if (type === "accepted_work.recorded") {
    const enriched = ENRICHED_ACCEPTANCE_REQUIRED_FIELDS.some((field) => input[field] !== undefined);
    if (enriched) {
      for (const field of ENRICHED_ACCEPTANCE_REQUIRED_FIELDS) {
        if (input[field] === undefined || input[field] === null) {
          fail(`${field} is required for enriched accepted_work.recorded`);
        }
      }
    }
  }
  if (type === "decision.material" && normalized.decision_status === "superseded" && !normalized.supersedes_event_id) {
    fail("superseded decision.material requires supersedes_event_id");
  }
  if (type === "decision.material") {
    const enriched = ENRICHED_DECISION_REQUIRED_FIELDS.some((field) => input[field] !== undefined);
    if (enriched) {
      for (const field of ENRICHED_DECISION_REQUIRED_FIELDS) {
        if (input[field] === undefined || input[field] === null) {
          fail(`${field} is required for enriched decision.material`);
        }
      }
      if (!MATERIAL_DECISION_SCOPES.includes(normalized.decision_scope)) {
        fail(`decision_scope for enriched decision.material must be one of: ${MATERIAL_DECISION_SCOPES.join(", ")}`);
      }
      if (!MATERIAL_DECISION_AUTHORITIES.includes(normalized.decision_authority)) {
        fail(`decision_authority for enriched decision.material must be one of: ${MATERIAL_DECISION_AUTHORITIES.join(", ")}`);
      }
    }
  }
  if (type === "decision.result_linked" && normalized.result_event_ids.length === 0) {
    fail("decision.result_linked requires at least one result_event_id");
  }
  if (
    normalized.prior_forecast_event_id !== undefined &&
    normalized.prior_forecast_event_id === normalized.event_id
  ) {
    fail("prior_forecast_event_id cannot reference the same event");
  }
  if (type === "benchmark.probe") {
    if (!/^[a-f0-9]{64}$/.test(normalized.prompt_digest)) {
      fail("prompt_digest for benchmark.probe must be a lowercase SHA-256 digest");
    }
    if (normalized.sample_status === "admitted") {
      if (
        normalized.bootstrap_attestation !== "current_hook_attested" ||
        normalized.prompt_purity !== "pure" ||
        normalized.invalid_reason !== "none"
      ) {
        fail("admitted benchmark.probe requires current hooks, pure prompt evidence, and no invalid reason");
      }
    } else if (normalized.invalid_reason === "none") {
      fail("invalid benchmark.probe requires a bounded invalid reason");
    }
    if (
      normalized.sample_status === "invalid_contaminated" &&
      normalized.prompt_purity !== "contaminated"
    ) {
      fail("invalid_contaminated benchmark.probe requires contaminated prompt purity");
    }
  }
  if (normalized.p80_wall_clock_hours !== undefined &&
      normalized.p80_wall_clock_hours < normalized.p50_wall_clock_hours) {
    fail("p80_wall_clock_hours must be greater than or equal to p50_wall_clock_hours");
  }
  if (normalized.p80_remaining_hours !== undefined &&
      normalized.p80_remaining_hours < normalized.p50_remaining_hours) {
    fail("p80_remaining_hours must be greater than or equal to p50_remaining_hours");
  }
  if (type === "forecast.remaining") {
    if (normalized.gate_count_complete > normalized.gate_count_total) {
      fail("gate_count_complete must be no greater than gate_count_total");
    }
    if (normalized.forecast_reason === "initial" && normalized.prior_forecast_event_id) {
      fail("initial forecast.remaining must not reference a prior forecast");
    }
    if (normalized.forecast_reason !== "initial" && !normalized.prior_forecast_event_id) {
      fail("revised forecast.remaining requires prior_forecast_event_id");
    }
  }
  if (type === "benchmark.compression_snapshot") {
    if (normalized.qualification === "operator_directed_current_segment" && (
      normalized.denominator_scope !== "current_goal_segment" ||
      normalized.comparability !== "category_mismatch"
    )) {
      fail("operator_directed_current_segment requires a current-goal category mismatch");
    }
    if (normalized.qualification === "complete_comparable" && (
      normalized.denominator_scope !== "complete_workstream" ||
      normalized.comparability !== "comparable"
    )) {
      fail("complete_comparable requires a comparable complete-workstream denominator");
    }
  }
  if (normalized.p80_hours !== undefined && normalized.p80_hours < normalized.p50_hours) {
    fail("p80_hours must be greater than or equal to p50_hours");
  }
  if (normalized.manual_hours_p80 !== undefined &&
      normalized.manual_hours_p80 < normalized.manual_hours_p50) {
    fail("manual_hours_p80 must be greater than or equal to manual_hours_p50");
  }
  if (normalized.upper_hours !== undefined && normalized.upper_hours < normalized.lower_hours) {
    fail("upper_hours must be greater than or equal to lower_hours");
  }
  if (normalized.manual_hours_upper !== undefined &&
      normalized.manual_hours_upper < normalized.manual_hours_lower) {
    fail("manual_hours_upper must be greater than or equal to manual_hours_lower");
  }
  if (normalized.denominator_hours !== undefined && normalized.denominator_hours === 0) {
    fail("denominator_hours must be greater than zero");
  }
  if (normalized.central_hours !== undefined &&
      (normalized.central_hours < normalized.lower_hours ||
       normalized.central_hours > normalized.upper_hours)) {
    fail("central_hours must be within lower_hours and upper_hours");
  }
  return normalized;
}

export function normalizeEngineeringEventEnvelope(input, options = {}) {
  return projectCanonicalEventEnvelope(normalizeEngineeringEvent(input, options));
}

export function recordEngineeringEvent(input, options = {}) {
  const event = normalizeEngineeringEvent(input, options);
  const ledger = engineeringLedgerPath(options.ledger);
  fs.mkdirSync(path.dirname(ledger), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(ledger, "a", 0o600);
  try {
    const line = Buffer.from(`${JSON.stringify(event)}\n`);
    let offset = 0;
    while (offset < line.length) {
      const written = fs.writeSync(descriptor, line, offset, line.length - offset);
      if (written <= 0) fail("Engineering event ledger write made no progress");
      offset += written;
    }
    fs.fchmodSync(descriptor, 0o600);
  } finally {
    fs.closeSync(descriptor);
  }
  return event;
}

export function recordEngineeringEventBestEffort(input, options = {}) {
  if (/^(?:1|true|yes)$/i.test(process.env.ACG_METRICS_DISABLED || "")) return false;
  try {
    recordEngineeringEvent(input, options);
    return true;
  } catch {
    return false;
  }
}

export function readEngineeringEvents(options = {}) {
  const ledger = engineeringLedgerPath(options.ledger);
  if (!fs.existsSync(ledger)) {
    return {
      ledger,
      events: [],
      valid_lines: 0,
      invalid_lines: 0,
      partial_tail_lines: 0,
      duplicate_events: 0,
      conflicting_event_ids: 0
    };
  }
  const content = fs.readFileSync(ledger, "utf8");
  const lines = content.split(/\r?\n/);
  const events = [];
  let invalidLines = 0;
  let partialTailLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (Buffer.byteLength(line) > 16 * 1024) {
      invalidLines += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (!parsed.event_id) fail("event_id is required in persisted rows");
      events.push(normalizeEngineeringEvent(parsed));
    } catch {
      const finalPartial = index === lines.length - 1 && !content.endsWith("\n");
      if (finalPartial) partialTailLines += 1;
      else invalidLines += 1;
    }
  }
  const deduplicated = deduplicateEvents(events);
  return {
    ledger,
    events: deduplicated.events,
    valid_lines: events.length,
    invalid_lines: invalidLines,
    partial_tail_lines: partialTailLines,
    duplicate_events: deduplicated.duplicate_events,
    conflicting_event_ids: deduplicated.conflicting_event_ids
  };
}

function canonicalEvent(event) {
  return JSON.stringify(Object.fromEntries(Object.entries(event).sort(([left], [right]) => left.localeCompare(right))));
}

function deduplicateEvents(events) {
  const byId = new Map();
  const conflicts = new Set();
  let duplicates = 0;
  for (const event of events) {
    if (conflicts.has(event.event_id)) continue;
    const existing = byId.get(event.event_id);
    if (!existing) {
      byId.set(event.event_id, event);
      continue;
    }
    if (canonicalEvent(existing) === canonicalEvent(event)) {
      duplicates += 1;
    } else {
      byId.delete(event.event_id);
      conflicts.add(event.event_id);
    }
  }
  const output = [...byId.values()].sort((left, right) =>
    Date.parse(left.occurred_at) - Date.parse(right.occurred_at) ||
    left.event_id.localeCompare(right.event_id)
  );
  return {
    events: output,
    duplicate_events: duplicates,
    conflicting_event_ids: conflicts.size
  };
}

function resolveSupersessions(events) {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  const edges = new Map();
  let invalid = 0;
  for (const event of events) {
    if (!event.supersedes_event_id) continue;
    const target = byId.get(event.supersedes_event_id);
    const sameTask =
      (event.thread_id || null) === (target?.thread_id || null) &&
      (event.task_id || null) === (target?.task_id || null) &&
      (event.work_id || null) === (target?.work_id || null);
    if (
      !target ||
      target.event_id === event.event_id ||
      target.project !== event.project ||
      target.workstream_id !== event.workstream_id ||
      !sameTask
    ) {
      invalid += 1;
      continue;
    }
    edges.set(event.event_id, target.event_id);
  }
  const cyclic = new Set();
  for (const start of edges.keys()) {
    const seen = new Set();
    let current = start;
    while (edges.has(current)) {
      if (seen.has(current)) {
        for (const id of seen) cyclic.add(id);
        break;
      }
      seen.add(current);
      current = edges.get(current);
    }
  }
  invalid += cyclic.size;
  const superseded = new Set();
  for (const [source, target] of edges.entries()) {
    if (!cyclic.has(source)) superseded.add(target);
  }
  return {
    events: events.filter((event) => !superseded.has(event.event_id)),
    superseded_events: superseded.size,
    invalid_supersessions: invalid
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function total(values) {
  return values.reduce((sum, value) => sum + value, 0);
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function rounded(value) {
  return value === null || value === undefined ? null : Number(value.toFixed(6));
}

function taskIdentity(event) {
  const task = event.task_id || event.work_id || event.thread_id || null;
  return task && event.attempt_id ? `${task}#${event.attempt_id}` : task;
}

function pairIntervals(events, startType, stopType) {
  const grouped = new Map();
  for (const event of events) {
    if (event.type !== startType && event.type !== stopType) continue;
    const seat = event.seat_id;
    if (!seat || seat === "0") continue;
    if (!grouped.has(seat)) grouped.set(seat, []);
    grouped.get(seat).push(event);
  }
  const intervals = [];
  let unmatchedStarts = 0;
  let unmatchedStops = 0;
  let invalidOrder = 0;
  for (const [seat, seatEvents] of grouped.entries()) {
    seatEvents.sort((left, right) =>
      Date.parse(left.occurred_at) - Date.parse(right.occurred_at) ||
      (left.type === stopType ? -1 : 1)
    );
    let start = null;
    for (const event of seatEvents) {
      const timestamp = Date.parse(event.occurred_at);
      if (event.type === startType) {
        if (start !== null) {
          invalidOrder += 1;
        } else {
          start = timestamp;
        }
      } else if (start === null) {
        unmatchedStops += 1;
      } else {
        if (timestamp > start) intervals.push({ seat, start, end: timestamp });
        else invalidOrder += 1;
        start = null;
      }
    }
    if (start !== null) unmatchedStarts += 1;
  }
  return {
    intervals,
    unmatched_starts: unmatchedStarts,
    unmatched_stops: unmatchedStops,
    invalid_order: invalidOrder
  };
}

function intervalsContained(inner, outer) {
  return inner.every((candidate) =>
    outer.some((container) =>
      candidate.seat === container.seat &&
      candidate.start >= container.start &&
      candidate.end <= container.end
    )
  );
}

function subtractIntervals(active, idle) {
  const output = [];
  for (const interval of active) {
    let segments = [{ ...interval }];
    for (const pause of idle.filter((candidate) => candidate.seat === interval.seat)) {
      const next = [];
      for (const segment of segments) {
        if (pause.end <= segment.start || pause.start >= segment.end) {
          next.push(segment);
          continue;
        }
        if (pause.start > segment.start) next.push({ ...segment, end: pause.start });
        if (pause.end < segment.end) next.push({ ...segment, start: pause.end });
      }
      segments = next;
    }
    output.push(...segments.filter((segment) => segment.end > segment.start));
  }
  return output;
}

function peakConcurrency(intervals) {
  const points = [];
  for (const interval of intervals) {
    points.push({ at: interval.start, delta: 1 });
    points.push({ at: interval.end, delta: -1 });
  }
  points.sort((left, right) => left.at - right.at || left.delta - right.delta);
  let current = 0;
  let peak = 0;
  for (const point of points) {
    current += point.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function taskSummary(key, events) {
  const sorted = [...events].sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
  const first = (type) => sorted.find((event) => event.type === type);
  const last = (type) => [...sorted].reverse().find((event) => event.type === type);
  const start = first("task.started");
  const usable = first("task.result_usable");
  const terminal = [...sorted].reverse().find((event) =>
    ["task.completed", "task.restarted", "task.blocked", "task.abandoned"].includes(event.type)
  );
  const startMs = start ? Date.parse(start.occurred_at) : null;
  const usableMs = usable ? Date.parse(usable.occurred_at) : null;
  const wallMs = startMs !== null && usableMs !== null && usableMs > startMs
    ? usableMs - startMs
    : null;
  const estimate = last("estimate.manual_hours")?.manual_hours_estimate ?? null;
  const avoidedEstimate = last("estimate.manual_hours_avoided")?.manual_hours_avoided_estimate ?? null;
  const seats = pairIntervals(sorted, "seat.started", "seat.stopped");
  const idle = pairIntervals(sorted, "seat.idle_started", "seat.idle_stopped");
  const observedSeatMs = seats.intervals.length
    ? total(seats.intervals.map((interval) => interval.end - interval.start))
    : null;
  const observedSeatSpanMs = seats.intervals.length
    ? Math.max(...seats.intervals.map((interval) => interval.end)) -
      Math.min(...seats.intervals.map((interval) => interval.start))
    : null;
  const observedWorkerDiagnostics = {
    coverage_status: seats.intervals.length ? "partial" : "unknown",
    qualification: seats.intervals.length ? "lower_bound" : null,
    distinct_delegated_seats: seats.intervals.length
      ? new Set(seats.intervals.map((interval) => interval.seat)).size
      : null,
    paired_intervals: seats.intervals.length || null,
    observed_active_seat_hours: observedSeatMs === null ? null : rounded(observedSeatMs / HOUR_MS),
    observed_average_concurrent_seats_lower_bound:
      observedSeatMs !== null && observedSeatSpanMs > 0
        ? rounded(observedSeatMs / observedSeatSpanMs)
        : null,
    observed_peak_concurrent_seats_lower_bound:
      seats.intervals.length ? peakConcurrency(seats.intervals) : null
  };
  const seatIntervalCoverageComplete =
    last("coverage.seat_intervals")?.outcome === "complete";
  const intervalBoundsValid =
    wallMs !== null &&
    [...seats.intervals, ...idle.intervals].every((interval) =>
      interval.start >= startMs && interval.end <= usableMs
    );
  const idleContained = intervalsContained(idle.intervals, seats.intervals);
  const completeSeatEvidence =
    seatIntervalCoverageComplete &&
    seats.intervals.length > 0 &&
    seats.unmatched_starts === 0 &&
    seats.unmatched_stops === 0 &&
    seats.invalid_order === 0 &&
    idle.unmatched_starts === 0 &&
    idle.unmatched_stops === 0 &&
    idle.invalid_order === 0 &&
    intervalBoundsValid &&
    idleContained;
  const effectiveIntervals = completeSeatEvidence
    ? subtractIntervals(seats.intervals, idle.intervals)
    : [];
  const seatMs = completeSeatEvidence
    ? total(effectiveIntervals.map((interval) => interval.end - interval.start))
    : null;
  const peak = completeSeatEvidence ? peakConcurrency(effectiveIntervals) : null;
  const materialOperatorEvents = sorted.filter((event) =>
    event.type.startsWith("operator.") && event.material === true
  );
  const coverageComplete = (kind) => last(`coverage.${kind}`)?.outcome === "complete";
  const interventionCoverageComplete = coverageComplete("intervention");
  const qualityCoverageComplete = coverageComplete("quality");
  const validationCoverageComplete = coverageComplete("validation");
  const proofCoverageComplete = coverageComplete("proof");
  const duplicatedWorkCoverageComplete = coverageComplete("duplicated_work");
  const coordinationCoverageComplete = coverageComplete("coordination");
  let autonomyState = null;
  if (terminal?.type === "task.blocked") autonomyState = "blocked";
  else if (terminal?.type === "task.abandoned") autonomyState = "abandoned";
  else if (terminal?.type === "task.restarted") autonomyState = "restarted";
  else if (terminal?.type === "task.completed" && usable && interventionCoverageComplete) {
    autonomyState = materialOperatorEvents.length
      ? "completed_after_intervention"
      : "completed_without_intervention";
  }
  const acceptance = first("quality.acceptance");
  const acceptanceMs = acceptance ? Date.parse(acceptance.occurred_at) : null;
  const priorRework = acceptanceMs === null
    ? false
    : sorted.some((event) =>
      event.type === "quality.rework" && Date.parse(event.occurred_at) <= acceptanceMs
    );
  const reworkEvents = sorted.filter((event) => event.type === "quality.rework");
  const reworkDurationComplete = reworkEvents.every((event) => event.duration_ms !== undefined);
  const duplicatedWorkEvents = sorted.filter((event) => event.type === "quality.duplicated_work");
  const duplicatedWorkDurationComplete = duplicatedWorkEvents.every((event) => event.duration_ms !== undefined);
  const coordinationEvents = sorted.filter((event) => event.type === "coordination.overhead");
  const coordinationDurationComplete = coordinationEvents.every((event) => event.duration_ms !== undefined);
  const acceptedAtMs = acceptance ? Date.parse(acceptance.occurred_at) : null;
  const accepted = Boolean(
    terminal?.type === "task.completed" && qualityCoverageComplete && acceptance &&
    startMs !== null && acceptedAtMs !== null && acceptedAtMs >= startMs
  );
  const acceptedTaskLatencyMs = accepted ? acceptedAtMs - startMs : null;
  const validation = last("validation.completed");
  const proof = last("proof.completed");
  const forecast = last("forecast.created");
  const conventional = sorted.filter((event) => event.type === "estimate.conventional");
  const runtimeSegments = sorted.filter((event) => event.type === "runtime.segment");
  const runtimeGaps = sorted.filter((event) => event.type === "runtime.gap");
  const runtimeComplete =
    runtimeSegments.length > 0 &&
    runtimeSegments.every((event) => event.completeness === "complete" && event.duration_ms !== undefined) &&
    runtimeGaps.every((event) => event.completeness === "complete" && event.duration_ms !== undefined);
  const observedRuntimeMs = total(runtimeSegments.map((event) => event.duration_ms || 0));
  const observedGapMs = total(runtimeGaps.map((event) => event.duration_ms || 0));
  const runtimeHours = runtimeComplete ? (observedRuntimeMs + observedGapMs) / HOUR_MS : null;
  const runtimeLowerBoundHours =
    observedRuntimeMs + observedGapMs > 0 ? (observedRuntimeMs + observedGapMs) / HOUR_MS : null;
  const tokenSegments = runtimeSegments.filter((event) => event.tokens_used !== undefined);
  const runtimeTokensComplete =
    runtimeSegments.length > 0 &&
    tokenSegments.length === runtimeSegments.length &&
    runtimeSegments.every((event) => event.completeness === "complete");
  const tokenUsage = sorted.filter((event) => event.type === "token.usage");
  const quotaSnapshots = sorted.filter((event) => event.type === "token.quota_snapshot");
  const tokenFieldView = (field) => {
    const observed = tokenUsage.filter((event) => event[field] !== undefined);
    const complete = tokenUsage.length > 0 &&
      observed.length === tokenUsage.length &&
      tokenUsage.every((event) => event.coverage_status === "complete");
    return {
      value: observed.length ? total(observed.map((event) => event[field])) : null,
      coverage_status: tokenUsage.length === 0 ? "unknown" : complete ? "complete" : "partial",
      observed_events: observed.length,
      event_count: tokenUsage.length
    };
  };
  const tokenView = Object.fromEntries([
    "input_tokens", "output_tokens", "cached_input_tokens", "cache_write_input_tokens",
    "reasoning_output_tokens", "total_tokens", "provider_latency_ms"
  ].map((field) => [field, tokenFieldView(field)]));
  const retainedQuotaSnapshots = quotaSnapshots.slice(-MAX_QUOTA_SNAPSHOT_DETAILS);
  const quotaCoverageCounts = (snapshots) => Object.fromEntries(
    COVERAGE_STATUSES.map((status) => [
      status,
      snapshots.filter((event) => (event.coverage_status || "unknown") === status).length
    ])
  );
  tokenView.quota_snapshot_count = quotaSnapshots.length;
  tokenView.quota_snapshot_retained_count = retainedQuotaSnapshots.length;
  tokenView.quota_snapshot_truncated_count = quotaSnapshots.length - retainedQuotaSnapshots.length;
  tokenView.quota_snapshot_coverage_counts = {
    total: quotaCoverageCounts(quotaSnapshots),
    retained: quotaCoverageCounts(retainedQuotaSnapshots)
  };
  tokenView.quota_snapshots = retainedQuotaSnapshots.map((event) => ({
    occurred_at: event.occurred_at,
    used_percent: event.used_percent ?? null,
    window_minutes: event.window_minutes ?? null,
    reset_at: event.reset_at ?? null,
    reset_epoch_seconds: event.reset_epoch_seconds ?? null,
    evidence_class: event.evidence_class,
    evidence_authority: event.evidence_authority,
    coverage_status: event.coverage_status
  }));
  const validationRuns = sorted.filter((event) => event.type === "validation.run");
  const serialValidation = validationRuns.filter((event) => event.validation_mode === "serial");
  const parallelValidation = validationRuns.filter((event) => event.validation_mode === "parallel");
  const operatorTouch = sorted.filter((event) => event.type === "operator.touch");
  const operatorWait = sorted.filter((event) => event.type === "operator.wait");
  const completeDurationHours = (rows) =>
    rows.length > 0 && rows.every((event) => event.completeness === "complete")
      ? total(rows.map((event) => event.duration_ms)) / HOUR_MS
      : null;
  const estimateSamples = sorted.filter((event) => event.type === "benchmark.estimate_sample");
  const benchmarkProbes = sorted.filter((event) => event.type === "benchmark.probe");
  const compressionSnapshots = sorted.filter(
    (event) => event.type === "benchmark.compression_snapshot"
  );
  const remainingForecasts = sorted.filter((event) => event.type === "forecast.remaining");
  const remainingForecastById = new Map(
    remainingForecasts.map((event) => [event.event_id, event])
  );
  const completionTarget = (event, field) =>
    new Date(Date.parse(event.occurred_at) + event[field] * HOUR_MS).toISOString();
  const remainingForecastHistory = remainingForecasts.map((event) => {
    const candidatePrior = event.prior_forecast_event_id
      ? remainingForecastById.get(event.prior_forecast_event_id)
      : null;
    let lineageError = null;
    if (event.prior_forecast_event_id) {
      if (!candidatePrior) lineageError = "prior_not_found";
      else if (candidatePrior.workstream_id !== event.workstream_id) {
        lineageError = "cross_workstream_prior";
      } else if (Date.parse(candidatePrior.occurred_at) >= Date.parse(event.occurred_at)) {
        lineageError = "prior_not_strictly_earlier";
      } else {
        const seen = new Set([event.event_id]);
        let cursor = candidatePrior;
        while (cursor) {
          if (seen.has(cursor.event_id)) {
            lineageError = "lineage_cycle";
            break;
          }
          seen.add(cursor.event_id);
          if (!cursor.prior_forecast_event_id) break;
          cursor = remainingForecastById.get(cursor.prior_forecast_event_id);
          if (!cursor) {
            lineageError = "ancestor_not_found";
            break;
          }
          if (cursor.workstream_id !== event.workstream_id) {
            lineageError = "ancestor_cross_workstream";
            break;
          }
        }
      }
    }
    const prior = lineageError ? null : candidatePrior;
    const targetShift = (field) => {
      if (!prior) return null;
      const currentTargetMs = Date.parse(event.occurred_at) + event[field] * HOUR_MS;
      const priorTargetMs = Date.parse(prior.occurred_at) + prior[field] * HOUR_MS;
      return rounded((currentTargetMs - priorTargetMs) / HOUR_MS);
    };
    return {
      event_id: event.event_id,
      occurred_at: event.occurred_at,
      forecast_reason: event.forecast_reason,
      confidence: event.confidence,
      evidence_class: event.evidence_class,
      scope_version: event.scope_version,
      p50_remaining_hours: event.p50_remaining_hours,
      p80_remaining_hours: event.p80_remaining_hours,
      critical_path_remaining_hours: event.critical_path_remaining_hours,
      machine_validation_serial_remaining_hours:
        event.machine_validation_serial_remaining_hours ?? null,
      gate_count_complete: event.gate_count_complete,
      gate_count_total: event.gate_count_total,
      p50_target_at: completionTarget(event, "p50_remaining_hours"),
      p80_target_at: completionTarget(event, "p80_remaining_hours"),
      prior_forecast_event_id: event.prior_forecast_event_id ?? null,
      prior_forecast_available: event.prior_forecast_event_id ? Boolean(prior) : null,
      lineage_valid: lineageError === null,
      lineage_error: lineageError,
      elapsed_since_prior_hours:
        prior
          ? rounded((Date.parse(event.occurred_at) - Date.parse(prior.occurred_at)) / HOUR_MS)
          : null,
      p50_target_shift_hours: targetShift("p50_remaining_hours"),
      p80_target_shift_hours: targetShift("p80_remaining_hours")
    };
  });
  const runtimeView = {
    complete_wall_clock_hours: rounded(runtimeHours),
    observed_lower_bound_hours: rounded(runtimeLowerBoundHours),
    coverage_status: runtimeSegments.length === 0 ? "unknown" : runtimeComplete ? "complete" : "partial",
    evidence_authority: runtimeSegments.length && runtimeSegments.every(
      (event) => event.evidence_authority === "runtime_metadata"
    ) ? "runtime_metadata" : "unknown",
    seat_lifecycle_events: sorted.filter((event) => event.type.startsWith("seat.")).length,
    tooling_fallback_events: sorted.filter((event) => event.type === "runtime.tooling_fallback").length,
    anchorless_runtime_evidence: !start && sorted.some((event) =>
      event.type.startsWith("runtime.") || event.type.startsWith("seat.") || event.type.startsWith("token.")
    )
  };
  const workView = {
    coverage_status: start && terminal ? "complete" : start ? "partial" : "unknown",
    task_linked: Boolean(key),
    started_at: start?.occurred_at ?? null,
    terminal_type: terminal?.type ?? null
  };
  const acceptanceView = {
    coverage_status: qualityCoverageComplete ? "complete" : "partial",
    first_pass_accepted:
      qualityCoverageComplete && terminal?.type === "task.completed"
        ? Boolean(acceptance?.first_pass === true && !priorRework)
        : null,
    validation_passed:
      validationCoverageComplete && validation ? validation.outcome === "passed" : null,
    proof_complete: proofCoverageComplete && proof ? proof.outcome === "complete" : null
  };
  const utilizationView = {
    coverage_status: completeSeatEvidence ? "complete" : "partial",
    effective_seat_hours: seatMs === null ? null : seatMs / HOUR_MS,
    peak_concurrent_seats: peak,
    average_concurrent_seats: seatMs !== null && wallMs > 0 ? seatMs / wallMs : null,
    observed_worker_diagnostics: observedWorkerDiagnostics
  };
  return {
    key,
    thread_id: sorted.find((event) => event.thread_id)?.thread_id ?? null,
    task_id: sorted.find((event) => event.task_id)?.task_id ?? null,
    work_id: sorted.find((event) => event.work_id)?.work_id ?? null,
    attempt_id: sorted.find((event) => event.attempt_id)?.attempt_id ?? null,
    started_at: start?.occurred_at ?? null,
    usable_at: usable?.occurred_at ?? null,
    terminal_at: terminal?.occurred_at ?? null,
    terminal_type: terminal?.type ?? null,
    wall_clock_hours: wallMs !== null && wallMs >= 0 ? wallMs / HOUR_MS : null,
    human_waiting_hours: wallMs !== null ? wallMs / HOUR_MS : null,
    manual_hours_estimate: estimate,
    manual_hours_avoided_estimate: avoidedEstimate,
    effective_seat_hours: seatMs === null ? null : seatMs / HOUR_MS,
    peak_concurrent_seats: peak,
    average_concurrent_seats:
      seatMs !== null && wallMs > 0 ? seatMs / wallMs : null,
    accepted,
    accepted_at: accepted ? acceptance.occurred_at : null,
    accepted_task_latency_hours: acceptedTaskLatencyMs === null ? null : acceptedTaskLatencyMs / HOUR_MS,
    delegated_worker_count: completeSeatEvidence
      ? new Set(effectiveIntervals.map((interval) => interval.seat)).size
      : null,
    duplicated_work_hours:
      duplicatedWorkCoverageComplete && duplicatedWorkDurationComplete
        ? total(duplicatedWorkEvents.map((event) => event.duration_ms)) / HOUR_MS
        : null,
    coordination_overhead_hours:
      coordinationCoverageComplete && coordinationDurationComplete
        ? total(coordinationEvents.map((event) => event.duration_ms)) / HOUR_MS
        : null,
    parallelization_efficiency:
      seatMs !== null && wallMs > 0 && peak > 0 ? seatMs / (wallMs * peak) : null,
    idle_hours: completeSeatEvidence
      ? total(idle.intervals.map((interval) => interval.end - interval.start)) / HOUR_MS
      : null,
    operator_load: interventionCoverageComplete ? materialOperatorEvents.length : null,
    autonomy_state: autonomyState,
    quality: {
      coverage_complete: qualityCoverageComplete,
      first_pass_accepted:
        qualityCoverageComplete && terminal?.type === "task.completed"
          ? Boolean(acceptance?.first_pass === true && !priorRework)
          : null,
      rework_events: qualityCoverageComplete ? reworkEvents.length : null,
      rework_hours:
        qualityCoverageComplete && reworkDurationComplete
          ? total(reworkEvents.map((event) => event.duration_ms || 0)) / HOUR_MS
          : null,
      regressions: qualityCoverageComplete ? eventCount(sorted, "quality.regression") : null
    },
    validation_passed:
      validationCoverageComplete && validation ? validation.outcome === "passed" : null,
    proof_complete:
      proofCoverageComplete && proof ? proof.outcome === "complete" : null,
    forecasting: {
      forecast: forecast ? {
        p50_wall_clock_hours: forecast.p50_wall_clock_hours,
        p80_wall_clock_hours: forecast.p80_wall_clock_hours,
        critical_path_hours: forecast.critical_path_hours,
        aggregate_seat_hours_estimate: forecast.aggregate_seat_hours_estimate ?? null,
        machine_validation_serial_hours: forecast.machine_validation_serial_hours ?? null,
        machine_validation_parallel_hours: forecast.machine_validation_parallel_hours ?? null,
        operator_touch_hours_estimate: forecast.operator_touch_hours_estimate ?? null,
        operator_wait_hours_estimate: forecast.operator_wait_hours_estimate ?? null,
        manual_hours_p50: forecast.manual_hours_p50,
        manual_hours_p80: forecast.manual_hours_p80,
        rework_allowance_hours: forecast.rework_allowance_hours ?? null,
        confidence: forecast.confidence,
        sample_size: forecast.sample_size,
        assumption_count: forecast.assumption_count ?? null,
        external_dependency_count: forecast.external_dependency_count ?? null,
        stop_gate_count: forecast.stop_gate_count ?? null,
        evidence_class: forecast.evidence_class
      } : null,
      conventional_estimates: conventional.map((event) => ({
        p50_hours: event.p50_hours,
        p80_hours: event.p80_hours,
        scope_class: event.scope_class,
        time_basis: event.time_basis,
        evidence_class: event.evidence_class,
        qualification: event.qualification
      })),
      runtime: {
        complete_wall_clock_hours: rounded(runtimeHours),
        observed_lower_bound_hours: rounded(runtimeLowerBoundHours),
        observed_tokens: tokenSegments.length
          ? total(tokenSegments.map((event) => event.tokens_used))
          : null,
        tokens_complete: runtimeTokensComplete,
        segment_count: runtimeSegments.length,
        complete_segments: runtimeSegments.filter((event) => event.completeness === "complete").length,
        lower_bound_segments: runtimeSegments.filter((event) => event.completeness === "lower_bound").length,
        unknown_segments: runtimeSegments.filter((event) => event.completeness === "unknown").length,
        unknown_gaps: runtimeGaps.filter((event) => event.completeness === "unknown").length
      },
      actual_vs_forecast: {
        covered: Boolean(forecast && runtimeHours !== null),
        p50_error_hours:
          forecast && runtimeHours !== null
            ? rounded(runtimeHours - forecast.p50_wall_clock_hours)
            : null,
        p80_error_hours:
          forecast && runtimeHours !== null
            ? rounded(runtimeHours - forecast.p80_wall_clock_hours)
            : null,
        within_p80:
          forecast && runtimeHours !== null
            ? runtimeHours <= forecast.p80_wall_clock_hours
            : null
      },
      validation: {
        serial_hours: rounded(completeDurationHours(serialValidation)),
        parallel_hours: rounded(completeDurationHours(parallelValidation)),
        first_pass_yield: rounded(ratio(
          validationRuns.filter((event) => event.first_pass === true && event.outcome === "passed").length,
          validationRuns.filter((event) => event.first_pass !== undefined).length
        ))
      },
      operator_touch_hours: rounded(completeDurationHours(operatorTouch)),
      operator_wait_hours: rounded(completeDurationHours(operatorWait)),
      estimate_samples: estimateSamples.map((event) => ({
        variant: event.variant,
        central_hours: event.central_hours,
        lower_hours: event.lower_hours,
        upper_hours: event.upper_hours,
        team_size: event.team_size,
        evidence_class: event.evidence_class,
        qualification: event.qualification,
        model_family: event.model_family,
        reasoning_level: event.reasoning_level,
        model_attestation: event.model_attestation,
        spontaneous_ai_distinction: event.spontaneous_ai_distinction
      })),
      probes: benchmarkProbes.map((event) => ({
        variant: event.variant,
        sample_status: event.sample_status,
        evidence_class: event.evidence_class,
        bootstrap_attestation: event.bootstrap_attestation,
        prompt_purity: event.prompt_purity,
        invalid_reason: event.invalid_reason,
        central_hours: event.central_hours ?? null,
        lower_hours: event.lower_hours ?? null,
        upper_hours: event.upper_hours ?? null,
        team_size: event.team_size ?? null,
        response_units: event.response_units ?? "none",
        spontaneous_ai_distinction: event.spontaneous_ai_distinction ?? null,
        requested_model_family: event.requested_model_family ?? null,
        requested_reasoning_level: event.requested_reasoning_level ?? null,
        actual_model_family: event.actual_model_family,
        actual_reasoning_level: event.actual_reasoning_level,
        model_attestation: event.model_attestation,
        governance_release_id: event.governance_release_id ?? null,
        system_version: event.system_version ?? null
      })),
      compression_snapshots: compressionSnapshots.map((event) => ({
        occurred_at: event.occurred_at,
        manual_hours_lower: event.manual_hours_lower,
        manual_hours_upper: event.manual_hours_upper,
        denominator_hours: event.denominator_hours,
        compression_lower: rounded(event.manual_hours_lower / event.denominator_hours),
        compression_midpoint: rounded(
          ((event.manual_hours_lower + event.manual_hours_upper) / 2) /
            event.denominator_hours
        ),
        compression_upper: rounded(event.manual_hours_upper / event.denominator_hours),
        numerator_scope: event.numerator_scope,
        denominator_scope: event.denominator_scope,
        evidence_class: event.evidence_class,
        qualification: event.qualification,
        comparability: event.comparability,
        north_star_eligible: (
          event.qualification === "complete_comparable" &&
          event.denominator_scope === "complete_workstream" &&
          event.comparability === "comparable"
        )
      })),
      remaining_forecast_history: remainingForecastHistory
    },
    views: {
      runtime: runtimeView,
      work: workView,
      token: tokenView,
      acceptance: acceptanceView,
      utilization: utilizationView
    },
    coverage: {
      intervention_complete: interventionCoverageComplete,
      quality_complete: qualityCoverageComplete,
      validation_complete: validationCoverageComplete,
      proof_complete: proofCoverageComplete,
      duplicated_work_complete: duplicatedWorkCoverageComplete,
      coordination_complete: coordinationCoverageComplete,
      seat_intervals_complete: seatIntervalCoverageComplete,
      complete_seat_intervals: completeSeatEvidence,
      unmatched_seat_starts: seats.unmatched_starts,
      unmatched_seat_stops: seats.unmatched_stops,
      invalid_seat_order: seats.invalid_order,
      unmatched_idle_starts: idle.unmatched_starts,
      unmatched_idle_stops: idle.unmatched_stops,
      invalid_idle_order: idle.invalid_order,
      intervals_within_task: intervalBoundsValid,
      idle_within_active: idleContained
    }
  };
}

function coverage(covered, eligible) {
  return {
    covered,
    eligible,
    missing: Math.max(0, eligible - covered),
    ratio: rounded(ratio(covered, eligible))
  };
}

function eventCount(events, type) {
  return events.filter((event) => event.type === type).length;
}

function efficiencyHour(timestamp) {
  return new Date(Math.floor(Date.parse(timestamp) / HOUR_MS) * HOUR_MS).toISOString();
}

// This is a compact, descriptive projection only. It deliberately derives no
// signal from provider quota snapshots and cannot influence execution.
function hourlyEfficiencyProjection(events, tasks) {
  const buckets = new Map();
  const bucketFor = (timestamp) => {
    const hourStart = efficiencyHour(timestamp);
    if (!buckets.has(hourStart)) {
      buckets.set(hourStart, {
        hour_start: hourStart,
        token_events: [],
        accepted_work: 0
      });
    }
    return buckets.get(hourStart);
  };
  for (const event of events) {
    if (event.type === "token.usage") bucketFor(event.occurred_at).token_events.push(event);
  }
  for (const task of tasks) {
    if (task.accepted && task.accepted_at) bucketFor(task.accepted_at).accepted_work += 1;
  }

  const tokenField = (tokenEvents, field, transform = (event) => event[field]) => {
    const observed = tokenEvents.filter((event) =>
      event.evidence_class === "observed" &&
      transform(event) !== undefined
    );
    const complete = tokenEvents.length > 0 && observed.length === tokenEvents.length;
    return {
      value: complete ? total(observed.map(transform)) : null,
      coverage_status: tokenEvents.length === 0 ? "unknown" : complete ? "complete" : "partial"
    };
  };

  const rows = [...buckets.values()]
    .sort((left, right) => left.hour_start.localeCompare(right.hour_start))
    .map((bucket) => {
      const input = tokenField(bucket.token_events, "input_tokens");
      const cached = tokenField(bucket.token_events, "cached_input_tokens");
      const uncached = tokenField(
        bucket.token_events,
        "input_tokens",
        (event) => event.input_tokens === undefined || event.cached_input_tokens === undefined
          ? undefined
          : event.input_tokens - event.cached_input_tokens
      );
      const output = tokenField(bucket.token_events, "output_tokens");
      const reasoning = tokenField(bucket.token_events, "reasoning_output_tokens");
      const cacheRatio = input.value !== null && cached.value !== null && input.value > 0
        ? rounded(cached.value / input.value)
        : null;
      const cacheRatioCoverage = input.coverage_status === "complete" &&
        cached.coverage_status === "complete" && input.value > 0
        ? "complete"
        : input.coverage_status === "unknown" && cached.coverage_status === "unknown"
          ? "unknown"
          : "partial";
      // An accepted task is an explicit positive fact, but the event ledger
      // cannot establish that every task/work item in this hour was observed
      // for acceptance. Do not infer a zero or a complete cohort.
      const acceptedCoverage = bucket.accepted_work > 0 ? "partial" : "unknown";
      return {
        hour_start: bucket.hour_start,
        uncached_input_tokens: uncached.value,
        output_tokens: output.value,
        reasoning_tokens: reasoning.value,
        cache_ratio: cacheRatio,
        accepted_work: bucket.accepted_work || null,
        accepted_work_per_hour: bucket.accepted_work || null,
        accepted_work_per_uncached_million_tokens:
          bucket.accepted_work > 0 && uncached.value !== null && uncached.value > 0
            ? rounded(bucket.accepted_work / (uncached.value / 1_000_000))
            : null,
        coverage: {
          time: "complete",
          uncached_input_tokens: uncached.coverage_status,
          output_tokens: output.coverage_status,
          reasoning_tokens: reasoning.coverage_status,
          cache_ratio: cacheRatioCoverage,
          accepted_work: acceptedCoverage,
          accepted_work_per_hour: acceptedCoverage,
          accepted_work_per_uncached_million_tokens:
            acceptedCoverage === "unknown" && uncached.coverage_status === "unknown"
                ? "unknown"
                : "partial"
        }
      };
    });
  const retained = rows.slice(-MAX_EFFICIENCY_HOURLY_BUCKETS);
  return {
    bucket_unit: "hour",
    retained_bucket_count: retained.length,
    truncated_bucket_count: rows.length - retained.length,
    hourly_trend: retained
  };
}

function summarizeProject(project, events, days) {
  const groupedTasks = new Map();
  for (const event of events) {
    const key = taskIdentity(event);
    if (!key) continue;
    if (!groupedTasks.has(key)) groupedTasks.set(key, []);
    groupedTasks.get(key).push(event);
  }
  const tasks = [...groupedTasks.entries()]
    .map(([key, taskEvents]) => taskSummary(key, taskEvents))
    .sort((left, right) => left.key.localeCompare(right.key));
  const wallTasks = tasks.filter((task) => task.wall_clock_hours !== null);
  const estimateTasks = tasks.filter((task) => task.manual_hours_estimate !== null);
  const avoidedTasks = tasks.filter((task) => task.manual_hours_avoided_estimate !== null);
  const compressionTasks = tasks.filter((task) =>
    task.manual_hours_estimate !== null && task.wall_clock_hours !== null && task.wall_clock_hours > 0
  );
  const parallelTasks = tasks.filter((task) =>
    task.effective_seat_hours !== null &&
    task.wall_clock_hours !== null &&
    task.wall_clock_hours > 0 &&
    task.peak_concurrent_seats > 0
  );
  const waitingTasks = tasks.filter((task) => task.human_waiting_hours !== null);
  const spanStarts = tasks.map((task) => task.started_at).filter(Boolean).map((value) => Date.parse(value));
  const spanEnds = tasks.map((task) => task.usable_at || task.terminal_at).filter(Boolean).map((value) => Date.parse(value));
  const calendarDays = spanStarts.length && spanEnds.length
    ? Math.max(0, (Math.max(...spanEnds) - Math.min(...spanStarts)) / DAY_MS)
    : null;
  const autonomyCounts = Object.fromEntries([
    "completed_without_intervention",
    "completed_after_intervention",
    "restarted",
    "abandoned",
    "blocked"
  ].map((state) => [state, tasks.filter((task) => task.autonomy_state === state).length]));
  const autonomyEligible = total(Object.values(autonomyCounts));
  const materialOperatorEvents = events.filter((event) =>
    event.type.startsWith("operator.") && event.material === true
  );
  const coordination = events.filter((event) => event.type === "coordination.overhead");
  const coordinationWithDuration = coordination.filter((event) => event.duration_ms !== undefined);
  const completedTaskRows = tasks.filter((task) => task.terminal_type === "task.completed" && task.usable_at);
  const completedTasks = completedTaskRows.length;
  const interventionCovered = tasks.filter((task) => task.coverage.intervention_complete);
  const operatorCoverageComplete = tasks.length > 0 && interventionCovered.length === tasks.length;
  const qualityTasks = completedTaskRows.filter((task) => task.coverage.quality_complete);
  const validationTasks = completedTaskRows.filter((task) => task.coverage.validation_complete);
  const proofTasks = completedTaskRows.filter((task) => task.coverage.proof_complete);
  const reworkDurationTasks = qualityTasks.filter((task) => task.quality.rework_hours !== null);
  const forecastTasks = tasks.filter((task) => task.forecasting.forecast !== null);
  const forecastActualTasks = forecastTasks.filter((task) => task.forecasting.actual_vs_forecast.covered);
  const compressionWall = total(compressionTasks.map((task) => task.wall_clock_hours));
  const parallelCapacity = total(parallelTasks.map((task) =>
    task.wall_clock_hours * task.peak_concurrent_seats
  ));
  const acceptedTasks = tasks.filter((task) => task.accepted);
  const acceptedTimingTasks = acceptedTasks.filter((task) => task.accepted_task_latency_hours !== null);
  const acceptedTimingComplete = acceptedTasks.length > 0 && acceptedTimingTasks.length === acceptedTasks.length;
  const acceptedWallClockHours = acceptedTimingComplete
    ? (Math.max(...acceptedTasks.map((task) => Date.parse(task.accepted_at))) -
      Math.min(...acceptedTasks.map((task) => Date.parse(task.started_at)))) / HOUR_MS
    : null;
  const exactTokenTasks = acceptedTasks.filter((task) =>
    task.views.token.total_tokens.coverage_status === "complete" &&
    task.views.token.total_tokens.value !== null
  );
  const exactTokensComplete = acceptedTasks.length > 0 && exactTokenTasks.length === acceptedTasks.length;
  const observedExactTokens = exactTokensComplete
    ? total(exactTokenTasks.map((task) => task.views.token.total_tokens.value))
    : null;
  const delegatedWorkerTasks = acceptedTasks.filter((task) => task.delegated_worker_count !== null);
  const delegatedWorkersComplete = acceptedTasks.length > 0 && delegatedWorkerTasks.length === acceptedTasks.length;
  const observedWorkerTasks = acceptedTasks.filter((task) =>
    task.views.utilization.observed_worker_diagnostics.distinct_delegated_seats !== null
  );
  const duplicateCoveredTasks = acceptedTasks.filter((task) =>
    task.coverage.duplicated_work_complete && task.duplicated_work_hours !== null &&
    task.effective_seat_hours !== null
  );
  const duplicatedWorkComplete = acceptedTasks.length > 0 && duplicateCoveredTasks.length === acceptedTasks.length;
  const coordinationCoveredTasks = acceptedTasks.filter((task) =>
    task.coverage.coordination_complete && task.coordination_overhead_hours !== null
  );
  const coordinationComplete = acceptedTasks.length > 0 && coordinationCoveredTasks.length === acceptedTasks.length;
  const efficiencyProjection = hourlyEfficiencyProjection(events, tasks);

  return {
    project,
    event_count: events.length,
    task_count: tasks.length,
    delivery: {
      wall_clock_hours: wallTasks.length ? rounded(total(wallTasks.map((task) => task.wall_clock_hours))) : null,
      calendar_days: rounded(calendarDays),
      active_seat_hours: parallelTasks.length
        ? rounded(total(parallelTasks.map((task) => task.effective_seat_hours)))
        : null,
      completed_tasks: completedTasks,
      throughput_tasks_per_day: rounded(ratio(completedTasks, days)),
      delivery_compression: compressionWall > 0
        ? rounded(total(compressionTasks.map((task) => task.manual_hours_estimate)) / compressionWall)
        : null,
      manual_hours_avoided_estimate: avoidedTasks.length
        ? rounded(total(avoidedTasks.map((task) => task.manual_hours_avoided_estimate)))
        : null,
      manual_hours_avoided_is_estimate: avoidedTasks.length ? true : null,
      human_waiting_hours_median: rounded(median(waitingTasks.map((task) => task.human_waiting_hours)))
    },
    quality: {
      first_pass_acceptance_rate: rounded(ratio(
        qualityTasks.filter((task) => task.quality.first_pass_accepted === true).length,
        qualityTasks.length
      )),
      rework_events: qualityTasks.length
        ? total(qualityTasks.map((task) => task.quality.rework_events))
        : null,
      rework_hours: qualityTasks.length && reworkDurationTasks.length === qualityTasks.length
        ? rounded(total(qualityTasks.map((task) => task.quality.rework_hours)))
        : null,
      regressions: qualityTasks.length
        ? total(qualityTasks.map((task) => task.quality.regressions))
        : null,
      validation_pass_rate: rounded(ratio(
        validationTasks.filter((task) => task.validation_passed === true).length,
        validationTasks.length
      )),
      proof_completion_rate: rounded(ratio(
        proofTasks.filter((task) => task.proof_complete === true).length,
        proofTasks.length
      ))
    },
    agent_efficiency: {
      average_concurrent_seats: parallelTasks.length
        ? rounded(total(parallelTasks.map((task) => task.effective_seat_hours)) /
          total(parallelTasks.map((task) => task.wall_clock_hours)))
        : null,
      peak_concurrent_seats: parallelTasks.length
        ? Math.max(...parallelTasks.map((task) => task.peak_concurrent_seats))
        : null,
      parallelization_efficiency: parallelCapacity > 0
        ? rounded(total(parallelTasks.map((task) => task.effective_seat_hours)) / parallelCapacity)
        : null,
      idle_hours: parallelTasks.length
        ? rounded(total(parallelTasks.map((task) => task.idle_hours || 0)))
        : null,
      coordination_overhead_hours: coordinationWithDuration.length
        ? rounded(total(coordinationWithDuration.map((event) => event.duration_ms)) / HOUR_MS)
        : null,
      relaunches: eventCount(events, "seat.relaunched"),
      collisions: eventCount(events, "seat.collision"),
      failed_continuations: eventCount(events, "seat.continuation_failed"),
      efficiency_projection: efficiencyProjection
    },
    operator_load: {
      material_events: operatorCoverageComplete ? materialOperatorEvents.length : null,
      approvals: operatorCoverageComplete ? eventCount(materialOperatorEvents, "operator.approval") : null,
      interventions: operatorCoverageComplete ? eventCount(materialOperatorEvents, "operator.intervention") : null,
      redirects: operatorCoverageComplete ? eventCount(materialOperatorEvents, "operator.redirect") : null,
      clarification_requests: operatorCoverageComplete
        ? eventCount(materialOperatorEvents, "operator.clarification")
        : null
    },
    autonomous_completion: {
      counts: autonomyCounts,
      autonomous_completion_rate: rounded(ratio(
        autonomyCounts.completed_without_intervention,
        autonomyEligible
      ))
    },
    comparison: {
      // Operator-requested only. Each metric is intentionally null unless its
      // full denominator is directly observed for the accepted-task cohort.
      accepted_tasks_per_hour:
        acceptedWallClockHours !== null && acceptedWallClockHours > 0
          ? rounded(acceptedTasks.length / acceptedWallClockHours)
          : null,
      accepted_tasks_per_million_exact_observed_tokens:
        observedExactTokens !== null && observedExactTokens > 0
          ? rounded(acceptedTasks.length / (observedExactTokens / 1_000_000))
          : null,
      task_latency_hours_mean:
        acceptedTimingComplete
          ? rounded(total(acceptedTimingTasks.map((task) => task.accepted_task_latency_hours)) / acceptedTasks.length)
          : null,
      average_delegated_worker_count:
        delegatedWorkersComplete
          ? rounded(total(delegatedWorkerTasks.map((task) => task.delegated_worker_count)) / acceptedTasks.length)
          : null,
      observed_average_delegated_worker_count_lower_bound:
        observedWorkerTasks.length
          ? rounded(total(observedWorkerTasks.map((task) =>
            task.views.utilization.observed_worker_diagnostics.distinct_delegated_seats
          )) / observedWorkerTasks.length)
          : null,
      duplicated_work_duration_over_total_admitted_seat_time:
        duplicatedWorkComplete && total(duplicateCoveredTasks.map((task) => task.effective_seat_hours)) > 0
          ? rounded(total(duplicateCoveredTasks.map((task) => task.duplicated_work_hours)) /
            total(duplicateCoveredTasks.map((task) => task.effective_seat_hours)))
          : null,
      orchestration_overhead_duration_over_wall_clock:
        coordinationComplete && acceptedWallClockHours !== null && acceptedWallClockHours > 0
          ? rounded(total(coordinationCoveredTasks.map((task) => task.coordination_overhead_hours)) /
            acceptedWallClockHours)
          : null,
      coverage: {
        accepted_tasks: coverage(acceptedTasks.length, tasks.length),
        accepted_task_timing: coverage(acceptedTimingTasks.length, acceptedTasks.length),
        exact_observed_tokens: coverage(exactTokenTasks.length, acceptedTasks.length),
        delegated_worker_count: coverage(delegatedWorkerTasks.length, acceptedTasks.length),
        observed_delegated_worker_count: coverage(observedWorkerTasks.length, acceptedTasks.length),
        observed_delegated_worker_count_qualification:
          observedWorkerTasks.length ? "lower_bound" : null,
        duplicated_work_duration: coverage(duplicateCoveredTasks.length, acceptedTasks.length),
        coordination_duration: coverage(coordinationCoveredTasks.length, acceptedTasks.length),
        accepted_wall_clock_complete: acceptedTimingComplete && acceptedWallClockHours !== null,
        exact_observed_token_total: observedExactTokens,
        admitted_seat_hours: duplicatedWorkComplete
          ? rounded(total(duplicateCoveredTasks.map((task) => task.effective_seat_hours)))
          : null
      }
    },
    governance_signals: {
      out_of_scope_attempts: eventCount(events, "governance.out_of_scope_attempt"),
      authority_denials: eventCount(events, "governance.authority_denial"),
      stale_receipt_recoveries: eventCount(events, "governance.stale_receipt_recovered"),
      unsafe_mutation_preventions: eventCount(events, "governance.unsafe_mutation_prevented"),
      restart_recoveries: eventCount(events, "governance.restart_recovered")
    },
    forecasting: {
      forecasted_tasks: forecastTasks.length,
      actual_vs_forecast_covered: forecastActualTasks.length,
      within_p80_rate: rounded(ratio(
        forecastActualTasks.filter((task) => task.forecasting.actual_vs_forecast.within_p80 === true).length,
        forecastActualTasks.length
      )),
      p50_error_hours_median: rounded(median(
        forecastActualTasks.map((task) => task.forecasting.actual_vs_forecast.p50_error_hours)
      )),
      p80_error_hours_median: rounded(median(
        forecastActualTasks.map((task) => task.forecasting.actual_vs_forecast.p80_error_hours)
      ))
    },
    coverage: {
      wall_clock: coverage(wallTasks.length, tasks.length),
      manual_hours_estimate: coverage(estimateTasks.length, tasks.length),
      manual_hours_avoided_estimate: coverage(avoidedTasks.length, tasks.length),
      delivery_compression: coverage(compressionTasks.length, tasks.length),
      active_seat_intervals: coverage(parallelTasks.length, tasks.length),
      human_waiting: coverage(waitingTasks.length, tasks.length),
      operator_intervention: coverage(interventionCovered.length, tasks.length),
      first_pass_acceptance: coverage(qualityTasks.length, completedTasks),
      rework_duration: coverage(reworkDurationTasks.length, qualityTasks.length),
      validation: coverage(validationTasks.length, completedTasks),
      proof: coverage(proofTasks.length, completedTasks),
      coordination_duration: coverage(coordinationWithDuration.length, coordination.length),
      forecast: coverage(forecastTasks.length, tasks.length),
      actual_vs_forecast: coverage(forecastActualTasks.length, forecastTasks.length)
    },
    tasks
  };
}

function weekStart(value) {
  const date = new Date(value);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function groupedProjectSummaries(events, days, includeTasks) {
  const projects = new Map();
  for (const event of events) {
    if (!projects.has(event.project)) projects.set(event.project, []);
    projects.get(event.project).push(event);
  }
  return [...projects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([project, projectEvents]) => {
      const summary = summarizeProject(project, projectEvents, days);
      if (!includeTasks) delete summary.tasks;
      return summary;
    });
}

function firstTaskStarts(events) {
  const starts = new Map();
  for (const event of events) {
    if (event.type !== "task.started") continue;
    const key = taskIdentity(event);
    if (!key) continue;
    const timestamp = Date.parse(event.occurred_at);
    if (!starts.has(key) || timestamp < starts.get(key)) starts.set(key, timestamp);
  }
  for (const event of events) {
    if (event.type !== "workstream.registered") continue;
    const key = taskIdentity(event);
    if (!key || starts.has(key)) continue;
    starts.set(key, Date.parse(event.occurred_at));
  }
  return starts;
}

function cohortEvents(events, starts, fromMs, throughMs) {
  const keys = new Set(
    [...starts.entries()]
      .filter(([, timestamp]) => timestamp >= fromMs && timestamp < throughMs)
      .map(([key]) => key)
  );
  return events.filter((event) => {
    const timestamp = Date.parse(event.occurred_at);
    if (timestamp >= throughMs) return false;
    const key = taskIdentity(event);
    if (!key) return timestamp >= fromMs;
    if (keys.has(key)) return true;
    // A task that started before the window contributes only its in-window
    // observations. It is deliberately not treated as a new task cohort.
    if (starts.has(key)) return timestamp >= fromMs;
    // Runtime and token evidence can be correlated to a live task/thread even
    // when its transcript has no task/workstream anchor. Preserve that exact
    // in-window evidence without inventing any lifecycle facts.
    return timestamp >= fromMs && (
      event.type.startsWith("runtime.") || event.type.startsWith("seat.") || event.type.startsWith("token.")
    );
  });
}

function runtimeDiagnostics(events, starts) {
  const unlinkedSeatLifecycle = events.filter((event) =>
    event.type.startsWith("seat.") && !taskIdentity(event)
  );
  const toolingFallbacks = events.filter((event) => event.type === "runtime.tooling_fallback");
  const anchorlessRuntimeEvidence = events.filter((event) => {
    const key = taskIdentity(event);
    return key && !starts.has(key) && (
      event.type.startsWith("runtime.") || event.type.startsWith("seat.") || event.type.startsWith("token.")
    );
  });
  return {
    coverage_status: unlinkedSeatLifecycle.length || toolingFallbacks.length || anchorlessRuntimeEvidence.length
      ? "partial"
      : "not_applicable",
    unlinked_seat_lifecycle_events: unlinkedSeatLifecycle.length,
    tooling_fallback_events: toolingFallbacks.length,
    anchorless_runtime_evidence: {
      coverage_status: anchorlessRuntimeEvidence.length ? "partial" : "not_applicable",
      event_count: anchorlessRuntimeEvidence.length,
      task_count: new Set(anchorlessRuntimeEvidence.map((event) => taskIdentity(event))).size
    },
    // Diagnostics are operational observations only: they never feed delivery,
    // task, quality, acceptance, or utilization KPI numerators/denominators.
    kpi_effect: "none"
  };
}

export function buildMetricsReport(options = {}) {
  const days = options.days === undefined ? 30 : Number(options.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) fail("days must be an integer from 1 through 3650");
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(now.getTime())) fail("now must be a valid date");
  const from = new Date(now.getTime() - days * DAY_MS);
  let read;
  if (options.events) {
    const normalized = options.events.map((event) => normalizeEngineeringEvent(event));
    const deduplicated = deduplicateEvents(normalized);
    read = {
      ledger: engineeringLedgerPath(options.ledger),
      events: deduplicated.events,
      valid_lines: normalized.length,
      invalid_lines: 0,
      partial_tail_lines: 0,
      duplicate_events: deduplicated.duplicate_events,
      conflicting_event_ids: deduplicated.conflicting_event_ids
    };
  } else {
    read = readEngineeringEvents({ ledger: options.ledger });
  }
  const supersession = resolveSupersessions(read.events);
  const project = options.project === undefined ? null : projectSlug(options.project);
  const thread = options.thread === undefined ? null : identifier(options.thread, "thread", true);
  const filtered = supersession.events.filter((event) =>
    (!project || event.project === project) &&
    (!thread || event.thread_id === thread || event.task_id === thread)
  );
  const starts = firstTaskStarts(filtered);
  const events = cohortEvents(filtered, starts, from.getTime(), now.getTime());
  const orphanTaskEvents = filtered.filter((event) => {
    const key = taskIdentity(event);
    const timestamp = Date.parse(event.occurred_at);
    return key && !starts.has(key) && timestamp >= from.getTime() && timestamp < now.getTime();
  }).length;
  const selectedRuntimeDiagnostics = runtimeDiagnostics(events, starts);
  const reportType = thread ? "thread" : project ? "project" : "portfolio";
  const weeklyKeys = new Map();
  for (const [key, timestamp] of starts.entries()) {
    if (timestamp < from.getTime() || timestamp >= now.getTime()) continue;
    const week = weekStart(timestamp);
    if (!weeklyKeys.has(week)) weeklyKeys.set(week, new Set());
    weeklyKeys.get(week).add(key);
  }
  for (const event of events) {
    if (taskIdentity(event)) continue;
    const week = weekStart(event.occurred_at);
    if (!weeklyKeys.has(week)) weeklyKeys.set(week, new Set());
  }
  const currentWeek = weekStart(now);
  const weeklyTrend = [...weeklyKeys.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([week, keys]) => {
      const weekEvents = events.filter((event) => {
        const key = taskIdentity(event);
        return key ? keys.has(key) : weekStart(event.occurred_at) === week;
      });
      return {
        week_start: week,
        partial: week === currentWeek,
        projects: groupedProjectSummaries(weekEvents, 7, false)
      };
    });
  return {
    schema_version: 1,
    report_type: reportType,
    generated_at: now.toISOString(),
    window: {
      days,
      from: from.toISOString(),
      through: now.toISOString()
    },
    filters: { project, thread },
    ledger: {
      configured: Boolean(read.ledger),
      valid_lines: read.valid_lines,
      invalid_lines: read.invalid_lines,
      partial_tail_lines: read.partial_tail_lines,
      duplicate_events: read.duplicate_events,
      conflicting_event_ids: read.conflicting_event_ids,
      superseded_events: supersession.superseded_events,
      invalid_supersessions: supersession.invalid_supersessions,
      orphan_task_events: orphanTaskEvents,
      orphan_seat_lifecycle_events: selectedRuntimeDiagnostics.unlinked_seat_lifecycle_events,
      anchorless_runtime_evidence_events: selectedRuntimeDiagnostics.anchorless_runtime_evidence.event_count,
      selected_events: events.length
    },
    projects: groupedProjectSummaries(events, days, reportType === "thread"),
    weekly_trend: weeklyTrend,
    runtime_diagnostics: selectedRuntimeDiagnostics,
    semantics: {
      architecture: "Kernel -> Receipts -> Events -> Metrics",
      governance_influence: "none",
      evidence_authority: "evidence_provenance_not_execution_authority",
      tooling_runtime_fallback: "diagnostic_only_not_task_product_or_quality_failure",
      missing_values: "null_with_coverage",
      manual_hours_avoided: "estimate_based",
      scheduled_task_design: "report_is_read_only_and_does_not_schedule"
    }
  };
}

export function buildAfterActionReport(options = {}) {
  if (!options.project) fail("after-action report requires project");
  if (!options.thread) fail("after-action report requires thread");
  const report = buildMetricsReport(options);
  const project = report.projects[0] ?? null;
  return {
    schema_version: 1,
    report_type: "agent_system_after_action",
    generated_at: report.generated_at,
    window: report.window,
    project: project?.project ?? options.project,
    task_count: project?.task_count ?? 0,
    delivery: project?.delivery ?? null,
    quality: project?.quality ?? null,
    agent_efficiency: project?.agent_efficiency ?? null,
    operator_load: project?.operator_load ?? null,
    autonomous_completion: project?.autonomous_completion ?? null,
    forecasting: project?.forecasting ?? null,
    coverage: project?.coverage ?? null,
    outcome: project?.tasks?.[0]?.terminal_type ?? null,
    runtime_limitations: {
      actual_model_reasoning: "Unverified_without_runtime_attestation",
      missing_values: "null_with_coverage"
    },
    semantics: {
      architecture: "Kernel -> Receipts -> Events -> Metrics",
      governance_influence: "none",
      completion_effect: "none",
      project_ownership_effect: "none",
      identity_projection: "raw_task_and_thread_ids_excluded"
    }
  };
}
