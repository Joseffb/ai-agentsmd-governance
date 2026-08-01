import crypto from "node:crypto";
import path from "node:path";

export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const ORCHESTRATION_BUNDLE_SCHEMA_VERSION = 6;
export const ORCHESTRATION_COMPOSER_VERSION = "1.4.0";
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

const UNVERIFIED = "Unverified";
const CANONICAL_ORCHESTRATION_EFFECT_SET = new Set(CANONICAL_ORCHESTRATION_EFFECTS);

const CLASSIFICATIONS = new Set([
  "seat0_owned",
  "seat0_atomic_allowed",
  "worker_required",
  "project_authority_required"
]);

const BUNDLE_FIELDS = new Set([
  "schema_version",
  "bundle_type",
  "bundle_digest",
  "release_identity",
  "project_identity",
  "predecessor_digest",
  "execution_id",
  "correlation_id",
  "causation_id",
  "immediate_intent",
  "classification",
  "seat0_decision",
  "rule_selection",
  "topology",
  "model_recommendation",
  "contracts",
  "native_fallback"
]);

const CLASSIFICATION_FIELDS = new Set([
  "immediate_intent",
  "classification",
  "estimated_duration_ms",
  "effects",
  "seat0_activity",
  "source_mutation_surfaces",
  "five_minute_limit_ms",
  "anti_evasion"
]);

const ANTI_EVASION_FIELDS = new Set([
  "duration_over_limit_requires_worker",
  "effect_requires_worker",
  "effect_requires_project_authority",
  "mandatory_effect_requires_worker",
  "seat0_prohibition_requires_worker",
  "unknown_remedy_requires_worker",
  "worker_owned_slice_requires_worker",
  "multiple_surfaces_requires_worker",
  "atomic_source_mutation_surface_count",
  "low_risk_correction",
  "delegation_overhead_dominates",
  "future_operations_considered"
]);

const SEAT0_DECISION_FIELDS = new Set([
  "seat",
  "decision",
  "reasons",
  "material",
  "decision_scope",
  "decision_authority",
  "provenance_write_failure",
  "evidence_controls_execution"
]);
const V6_SEAT0_DECISION_FIELDS = new Set([
  ...SEAT0_DECISION_FIELDS,
  "execution_id",
  "correlation_id",
  "causation_id"
]);
const LEGACY_SEAT0_DECISION_FIELDS = new Set(["seat", "decision", "reasons"]);
const RULE_SELECTION_FIELDS = new Set([
  "immediate_intent",
  "required_rule_ids",
  "rule_delta",
  "context_ledger",
  "accumulated_policy_tokens"
]);
const RULE_DELTA_FIELDS = new Set(["order", "id", "digest", "estimated_tokens"]);
const TOPOLOGY_FIELDS = new Set([
  "coordinator",
  "capacity_limit",
  "capacity_evidence",
  "worker_count",
  "seat0_included_in_worker_count",
  "maximum_useful_disjoint_workers",
  "workers",
  "decomposed_items",
  "queued_item_ids",
  "queued_write_scopes",
  "execution_class",
  "decomposition_complete",
  "coherent_chain",
  "dependency_edges",
  "launch_stages",
  "artifact_expectations",
  "integration_order",
  "shared_resource_declarations",
  "scheduler_fallback"
]);
const V3_TOPOLOGY_FIELDS = new Set([...TOPOLOGY_FIELDS].filter((field) => ![
  "execution_class", "decomposition_complete", "coherent_chain", "dependency_edges", "launch_stages",
  "artifact_expectations", "integration_order", "shared_resource_declarations", "scheduler_fallback"
].includes(field)));
const LEGACY_TOPOLOGY_ITEM_FIELDS = new Set(["id", "write_scopes"]);
const TOPOLOGY_COORDINATOR_FIELDS = new Set(["seat", "label"]);
const TOPOLOGY_WORKER_FIELDS = new Set([
  "seat",
  "label",
  "item_ids",
  "assignment_ids",
  "write_scopes",
  "requested_model",
  "requested_reasoning_raw",
  "actual_model",
  "actual_reasoning_raw",
  "model_attestation",
  "reasoning_attestation",
  "prompt_envelope"
]);
const V4_TOPOLOGY_WORKER_FIELDS = new Set([...TOPOLOGY_WORKER_FIELDS, "worker_kind"]);
const TOPOLOGY_ITEM_FIELDS = new Set(["id", "write_scopes", "depends_on", "expected_artifact", "shared_resources"]);
const DEPENDENCY_EDGE_FIELDS = new Set(["from", "to"]);
const LAUNCH_STAGE_FIELDS = new Set(["stage", "item_ids"]);
const ARTIFACT_EXPECTATION_FIELDS = new Set(["item_id", "expected_artifact"]);
const SHARED_RESOURCE_DECLARATION_FIELDS = new Set(["item_id", "shared_resources"]);
const WORKER_PROMPT_ENVELOPE_FIELDS = new Set([
  "schema_version", "scope", "authority", "non_authority", "non_goals",
  "acceptance", "stop_conditions", "validation", "isolation_effects",
  "evidence", "return", "requested_model", "requested_reasoning_raw", "fallback"
]);
const V4_WORKER_PROMPT_ENVELOPE_FIELDS = new Set([...WORKER_PROMPT_ENVELOPE_FIELDS, "worker_kind"]);
const V6_WORKER_PROMPT_ENVELOPE_FIELDS = new Set([
  ...V4_WORKER_PROMPT_ENVELOPE_FIELDS,
  "execution_id",
  "correlation_id",
  "causation_id"
]);
const MODEL_RECOMMENDATION_FIELDS = new Set([
  "model",
  "reasoning",
  "rationale",
  "actual_model",
  "actual_reasoning_raw"
]);
const V5_MODEL_RECOMMENDATION_FIELDS = new Set([...MODEL_RECOMMENDATION_FIELDS, "spark_gate"]);
const SPARK_GATE_FIELDS = new Set([
  "work_kind",
  "requires_judgment",
  "availability",
  "actual_availability",
  "worker_required",
  "excluded_effects"
]);
const SPARK_WORK_KINDS = new Set(["bounded_ai_transformation", "mechanical_edit"]);
const SPARK_AVAILABILITY = new Set([
  "selectable",
  "authoritatively_unavailable",
  "separate_pool_exhausted",
  "unknown_or_unexposed"
]);
const SPARK_ALLOWED_EFFECTS = new Set(["filesystem_mutation", "source_mutation", "test"]);
const CONTRACT_FIELDS = new Set(["authority", "isolation", "validation", "return", "fallback", "lifecycle"]);
const AUTHORITY_CONTRACT_FIELDS = new Set([
  "origin",
  "bundle_grants_project_authority",
  "digest_proves"
]);
const ISOLATION_FIELDS = new Set(["required_for_worker_mutation", "mode", "evidence"]);
const VALIDATION_FIELDS = new Set([
  "coordinator_seat",
  "worker_results_are_advisory_until_verified",
  "required_outcome",
  "evidence"
]);
const RETURN_CONTRACT_FIELDS = new Set(["recipient_seat", "required_fields"]);
const FALLBACK_FIELDS = new Set([
  "mode",
  "requested_model",
  "requested_reasoning_raw",
  "actual_model",
  "actual_reasoning_raw",
  "attestation"
]);
const LIFECYCLE_FIELDS = new Set([
  "stages",
  "capacity_bound_work_is_queued",
  "mutating_worker_isolation",
  "parallel_phase",
  "integration_seat",
  "final_validation",
  "execution_evidence",
  "execution_class",
  "launch_stages",
  "scheduler_scope",
  "scheduler_failure_fallback"
]);
const LEGACY_LIFECYCLE_FIELDS = new Set([...LIFECYCLE_FIELDS].filter((field) => ![
  "execution_class", "launch_stages", "scheduler_scope", "scheduler_failure_fallback"
].includes(field)));
const LEGACY_LIFECYCLE_STAGES = Object.freeze([
  "decompose",
  "reserve_disjoint_lanes_within_capacity",
  "isolate_mutating_workers",
  "planned_parallel_work_test_review",
  "seat0_integration",
  "planned_authoritative_final_validation"
]);
const MAX_WORK_ITEMS = 64;
const MAX_ITEM_DEPENDENCIES = 32;
const MAX_SHARED_RESOURCES = 32;
const MAX_METADATA_VALUE_LENGTH = 256;
const EXECUTION_CLASSES = new Set(["PARALLEL", "PIPELINED", "SERIAL", "EXPLORATORY"]);

function hardBoundaryRule({
  id,
  prevented_failure,
  why_failure_is_expensive_or_irreversible,
  enforcement_cost,
  seat0_escalation_path,
  safe_fallback
}) {
  return Object.freeze({
    id,
    prevented_failure,
    why_failure_is_expensive_or_irreversible,
    enforcement_cost,
    seat0_escalation_path,
    safe_fallback
  });
}

/**
 * Worker admission fails closed only at these expensive or irreversible
 * boundaries. The metadata makes each intervention's cost and fallback
 * reviewable; strategy and implementation preferences are intentionally absent.
 */
export const WORKER_HARD_BOUNDARY_RULES = Object.freeze([
  hardBoundaryRule({
    id: "missing_authority_or_scope_expansion",
    prevented_failure: "unauthorized_action_or_scope_expansion",
    why_failure_is_expensive_or_irreversible: "ownership_or_project_state_can_change_without_valid_authority",
    enforcement_cost: "bounded_authority_and_scope_check",
    seat0_escalation_path: "obtain_external_authority_or_rescope",
    safe_fallback: "continue_only_existing_authorized_scope"
  }),
  hardBoundaryRule({
    id: "secret_data_tenancy_or_privilege_boundary",
    prevented_failure: "secret_disclosure_data_boundary_crossing_or_privilege_escalation",
    why_failure_is_expensive_or_irreversible: "confidentiality_tenancy_or_access_can_be_irrecoverably_compromised",
    enforcement_cost: "bounded_data_and_privilege_check",
    seat0_escalation_path: "resolve_owner_tenant_and_minimum_data_path",
    safe_fallback: "use_redacted_synthetic_or_local_only_data"
  }),
  hardBoundaryRule({
    id: "destructive_or_irreversible_effect",
    prevented_failure: "unapproved_destructive_or_irreversible_change",
    why_failure_is_expensive_or_irreversible: "state_or_history_may_not_be_recoverable",
    enforcement_cost: "bounded_reversibility_and_target_check",
    seat0_escalation_path: "obtain_explicit_external_authority_for_exact_effect",
    safe_fallback: "use_preview_dry_run_or_recoverable_operation"
  }),
  hardBoundaryRule({
    id: "missing_verified_git_lineage_or_worktree",
    prevented_failure: "mutation_on_unverified_lineage_or_shared_checkout",
    why_failure_is_expensive_or_irreversible: "work_can_corrupt_or_overwrite_unrelated_candidate_state",
    enforcement_cost: "receipt_bound_git_identity_check",
    seat0_escalation_path: "prepare_or_recover_verified_isolation",
    safe_fallback: "return_read_only_findings_without_mutation"
  }),
  hardBoundaryRule({
    id: "primary_integration_or_merge",
    prevented_failure: "worker_integration_or_primary_checkout_mutation",
    why_failure_is_expensive_or_irreversible: "candidate_ownership_and_conflict_resolution_would_be_bypassed",
    enforcement_cost: "bounded_role_and_target_check",
    seat0_escalation_path: "return_candidate_to_seat0_for_integration",
    safe_fallback: "commit_only_worker_owned_branch"
  }),
  hardBoundaryRule({
    id: "tampered_assignment_bundle_or_receipt",
    prevented_failure: "execution_under_tampered_scope_authority_or_identity",
    why_failure_is_expensive_or_irreversible: "integrity_loss_invalidates_the_worker_execution_contract",
    enforcement_cost: "deterministic_digest_and_binding_check",
    seat0_escalation_path: "replace_with_fresh_verified_assignment",
    safe_fallback: "preserve_state_and_return_integrity_failure"
  }),
  hardBoundaryRule({
    id: "authoritatively_known_costly_model_mismatch",
    prevented_failure: "known_inadmissible_or_materially_costly_model_use",
    why_failure_is_expensive_or_irreversible: "known_cost_or_capability_mismatch_consumes_nonrecoverable_budget_or_invalidates_work",
    enforcement_cost: "authoritative_runtime_attestation_check",
    seat0_escalation_path: "reroute_or_rescope_with_supported_model",
    safe_fallback: "continue_safe_work_when_actual_model_is_only_unverified"
  }),
  hardBoundaryRule({
    id: "governance_authority_execution_contract_or_evidence_mutation",
    prevented_failure: "worker_self_modification_of_governance_authority_or_execution_evidence",
    why_failure_is_expensive_or_irreversible: "the_worker_could_expand_its_own_power_or_corrupt_auditability",
    enforcement_cost: "bounded_owned_scope_and_integrity_check",
    seat0_escalation_path: "assign_separate_authorized_governance_change",
    safe_fallback: "return_proposed_change_without_mutating_control_evidence"
  })
]);

const WORKER_HARD_BOUNDARY_IDS = Object.freeze(WORKER_HARD_BOUNDARY_RULES.map((rule) => rule.id));
const WORKER_ADMISSION_STOP_CONDITIONS = Object.freeze([
  ...WORKER_HARD_BOUNDARY_IDS,
  "incomplete_required_validation"
]);
export const WORKER_OBSERVATIONAL_DIFFERENCES = Object.freeze([
  "strategy",
  "topology",
  "implementation",
  "coding",
  "style",
  "optimization"
]);

const EFFECTS_REQUIRING_PROJECT_AUTHORITY = new Set([
  "deployment",
  "external_communication",
  "publication",
  "purchase",
  "database_mutation",
  "destructive_operation",
  "git_history_rewrite",
  "release"
]);

const EFFECTS_REQUIRING_WORKER = new Set([
  "browser",
  "build",
  "contract_change",
  "dependency",
  "migration",
  "privacy",
  "security",
  "test"
]);

const SEAT0_OWNED_ACTIVITIES = new Set([
  "acceptance",
  "communication",
  "coordination",
  "decision",
  "integration"
]);

const SAFE_METADATA_FIELDS = new Set([
  "source_mutation_surface",
  "source_mutation_surfaces",
  "atomic_source_mutation_surface_count",
  "estimated_tokens",
  "accumulated_policy_tokens",
  "requested_reasoning_raw",
  "actual_reasoning_raw",
  "reasoning_attestation"
]);

const FORBIDDEN_FIELD = /(^|[_-])(prompts?|sources?|model[_-]?outputs?|reasoning|secrets?|passwords?|credentials?|tokens?|api[_-]?keys?|authorizations?|private[_-]?keys?)([_-]|$)/iu;

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactObjectKeys(value, allowedFields, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) fail(`${label} contains an unknown field: ${key}`);
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  return value.trim();
}

function safeIdentifier(value, label) {
  const normalized = requiredString(value, label);
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(normalized)) fail(`${label} is not a safe identifier`);
  return normalized;
}

function normalizeDuration(value, label = "estimated_duration_ms") {
  if (!Number.isInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
  return value;
}

function exactUnverifiedOrIdentifier(value, label) {
  if (value === UNVERIFIED) return UNVERIFIED;
  return safeIdentifier(value, label);
}

function exactUnverifiedOrVersion(value, label) {
  if (value === UNVERIFIED) return UNVERIFIED;
  const normalized = requiredString(value, label);
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/iu.test(normalized)) fail(`${label} must be a semantic version or Unverified`);
  return normalized;
}

function normalizeEffects(value = []) {
  if (!Array.isArray(value)) fail("effects must be an array");
  const effects = value.map((effect) => safeIdentifier(effect, "effect"));
  for (const effect of effects) {
    if (!CANONICAL_ORCHESTRATION_EFFECT_SET.has(effect)) {
      fail(`effect must use the canonical closed vocabulary: ${effect}`);
    }
  }
  return [...new Set(effects)].sort();
}

function assertNoSensitiveFields(value, location = "input") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${location}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const boundedReasoningMetadata = key === "reasoning" && location === "bundle.model_recommendation";
    const generatedWorkerEnvelope = key === "prompt_envelope" && /^bundle\.topology\.workers\[\d+\]$/u.test(location);
    if (FORBIDDEN_FIELD.test(key) && !SAFE_METADATA_FIELDS.has(key) && !boundedReasoningMetadata && !generatedWorkerEnvelope) {
      fail(`${location}.${key} is not permitted in orchestration data`);
    }
    assertNoSensitiveFields(child, `${location}.${key}`);
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON does not support non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("canonical JSON supports only plain JSON values");
}

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function bundleDigest(bundle) {
  if (!isPlainObject(bundle)) fail("bundle must be an object");
  const unsigned = { ...bundle };
  delete unsigned.bundle_digest;
  return sha256(canonicalJson(unsigned));
}

function opaqueExecutionIdentifier(value, label, prefix) {
  if (typeof value !== "string" || !new RegExp(`^${prefix}-[a-f0-9]{32}$`, "u").test(value)) {
    fail(`${label} must be an opaque ${prefix}-<32hex> identifier`);
  }
  return value;
}

function executionIdentity({ execution_id, correlation_id, causation_id, predecessor_digest, project_identity, classification }) {
  const identitySeed = canonicalJson({ project_identity, classification });
  const executionId = execution_id ?? `execution-${sha256(identitySeed).slice("sha256:".length, "sha256:".length + 32)}`;
  opaqueExecutionIdentifier(executionId, "execution_id", "execution");
  const expectedCorrelation = `correlation-${sha256(executionId).slice("sha256:".length, "sha256:".length + 32)}`;
  const expectedCausation = predecessor_digest
    ? `causation-${sha256(predecessor_digest).slice("sha256:".length, "sha256:".length + 32)}`
    : `causation-${sha256(`root:${executionId}`).slice("sha256:".length, "sha256:".length + 32)}`;
  if (correlation_id !== undefined && correlation_id !== expectedCorrelation) {
    fail("correlation_id must be derived from execution_id");
  }
  if (causation_id !== undefined && causation_id !== expectedCausation) {
    fail("causation_id must be derived from the predecessor evidence");
  }
  return Object.freeze({
    execution_id: executionId,
    correlation_id: expectedCorrelation,
    causation_id: expectedCausation
  });
}

function hasAuthorityEffect(effects) {
  return effects.some((effect) => EFFECTS_REQUIRING_PROJECT_AUTHORITY.has(effect));
}

function hasWorkerEffect(effects) {
  // Any declared effect is work for a worker unless the authority gate catches
  // it first. This prevents inventing a benign-looking effect name to evade
  // the atomic limit.
  return effects.length > 0;
}

function strictBoolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function normalizeSeat0Activity(value, legacyCoordination) {
  if (value === undefined || value === null) return legacyCoordination ? "coordination" : null;
  const activity = safeIdentifier(value, "seat0_activity");
  if (!SEAT0_OWNED_ACTIVITIES.has(activity)) fail("seat0_activity must be integration, coordination, decision, communication, or acceptance");
  if (legacyCoordination && activity !== "coordination") fail("seat0_coordination conflicts with seat0_activity");
  return activity;
}

function normalizeSourceMutationSurfaces({ source_mutation_surface, source_mutation_surfaces } = {}) {
  if (source_mutation_surface !== undefined && source_mutation_surfaces !== undefined) {
    fail("provide source_mutation_surface or source_mutation_surfaces, not both");
  }
  const surfaces = source_mutation_surface === undefined
    ? (source_mutation_surfaces ?? [])
    : [source_mutation_surface];
  if (!Array.isArray(surfaces)) fail("source_mutation_surfaces must be an array");
  return [...new Set(surfaces.map((surface) => normalizeScope(surface, "source_mutation_surface")))].sort();
}

/**
 * Classifies only the immediate unit of work. A future operation cannot make
 * an otherwise atomic action worker-worthy, and a claimed short duration
 * cannot evade effect or authority requirements.
 */
export function classifyImmediateIntent({
  immediate_intent,
  estimated_duration_ms,
  effects = [],
  project_authority_granted = false,
  seat0_coordination = false,
  seat0_activity,
  explicitly_atomic = false,
  low_risk = false,
  remedy_known = false,
  delegation_overhead_dominates = false,
  seat0_prohibited = false,
  worker_owned_slice = false,
  source_mutation_surface,
  source_mutation_surfaces
} = {}) {
  const intent = safeIdentifier(immediate_intent, "immediate_intent");
  const duration = normalizeDuration(estimated_duration_ms);
  const normalizedEffects = normalizeEffects(effects);
  const projectAuthorityGranted = strictBoolean(project_authority_granted, "project_authority_granted");
  const coordination = strictBoolean(seat0_coordination, "seat0_coordination");
  const activity = normalizeSeat0Activity(seat0_activity, coordination);
  const atomic = strictBoolean(explicitly_atomic, "explicitly_atomic");
  const riskIsLow = strictBoolean(low_risk, "low_risk");
  const remedyIsKnown = strictBoolean(remedy_known, "remedy_known");
  const delegationOverheadDominates = strictBoolean(delegation_overhead_dominates, "delegation_overhead_dominates");
  const seat0IsProhibited = strictBoolean(seat0_prohibited, "seat0_prohibited");
  const workerOwnsSlice = strictBoolean(worker_owned_slice, "worker_owned_slice");
  const surfaces = normalizeSourceMutationSurfaces({ source_mutation_surface, source_mutation_surfaces });
  const requiresAuthority = hasAuthorityEffect(normalizedEffects);
  const requiresWorker = normalizedEffects.some((effect) => EFFECTS_REQUIRING_WORKER.has(effect));
  const onlySourceMutation = normalizedEffects.length === 1 && normalizedEffects[0] === "source_mutation";
  const atomicCorrection = atomic && riskIsLow && remedyIsKnown && delegationOverheadDominates &&
    !seat0IsProhibited && !workerOwnsSlice && surfaces.length === 1 && onlySourceMutation;

  let classification;
  if (requiresAuthority && !projectAuthorityGranted) classification = "project_authority_required";
  else if (activity && normalizedEffects.length === 0 && surfaces.length === 0) classification = "seat0_owned";
  // Exactly five minutes is still atomic; any duration beyond it is not. A
  // source edit is Seat 0-eligible only with all evidence recorded above.
  else if (atomicCorrection && duration <= FIVE_MINUTES_MS && !requiresWorker) classification = "seat0_atomic_allowed";
  else classification = "worker_required";

  return Object.freeze({
    immediate_intent: intent,
    classification,
    estimated_duration_ms: duration,
    effects: normalizedEffects,
    seat0_activity: activity,
    source_mutation_surfaces: surfaces,
    five_minute_limit_ms: FIVE_MINUTES_MS,
    anti_evasion: Object.freeze({
      duration_over_limit_requires_worker: duration > FIVE_MINUTES_MS,
      effect_requires_worker: hasWorkerEffect(normalizedEffects),
      effect_requires_project_authority: requiresAuthority,
      mandatory_effect_requires_worker: requiresWorker,
      seat0_prohibition_requires_worker: seat0IsProhibited,
      unknown_remedy_requires_worker: !remedyIsKnown,
      worker_owned_slice_requires_worker: workerOwnsSlice,
      multiple_surfaces_requires_worker: surfaces.length > 1,
      atomic_source_mutation_surface_count: surfaces.length,
      low_risk_correction: riskIsLow,
      delegation_overhead_dominates: delegationOverheadDominates,
      future_operations_considered: false
    })
  });
}

export const classifyJitOrchestration = classifyImmediateIntent;

function normalizeLedger(contextLedger = {}) {
  const entries = Array.isArray(contextLedger)
    ? contextLedger
    : Object.entries(contextLedger).map(([id, value]) => ({ id, ...value }));
  const ledger = {};
  for (const entry of entries) {
    if (!isPlainObject(entry)) fail("context_ledger entries must be objects");
    const id = safeIdentifier(entry.id, "context_ledger id");
    const digest = requiredString(entry.digest, `context_ledger ${id} digest`);
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) fail(`context_ledger ${id} digest must be sha256`);
    const estimatedTokens = normalizeDuration(entry.estimated_tokens, `context_ledger ${id} estimated_tokens`);
    const priorVersions = entry.prior_versions === undefined ? [] : entry.prior_versions;
    if (!Array.isArray(priorVersions)) fail(`context_ledger ${id} prior_versions must be an array`);
    const seenDigests = new Set([digest]);
    const normalizedPriorVersions = priorVersions.map((prior, index) => {
      if (!isPlainObject(prior)) fail(`context_ledger ${id} prior_versions[${index}] must be an object`);
      const priorDigest = requiredString(prior.digest, `context_ledger ${id} prior digest`);
      if (!/^sha256:[a-f0-9]{64}$/u.test(priorDigest)) fail(`context_ledger ${id} prior digest must be sha256`);
      if (seenDigests.has(priorDigest)) fail(`context_ledger ${id} contains duplicate digest history`);
      seenDigests.add(priorDigest);
      return { digest: priorDigest, estimated_tokens: normalizeDuration(prior.estimated_tokens, `context_ledger ${id} prior estimated_tokens`) };
    }).sort((left, right) => left.digest.localeCompare(right.digest));
    ledger[id] = {
      digest,
      estimated_tokens: estimatedTokens,
      ...(normalizedPriorVersions.length ? { prior_versions: normalizedPriorVersions } : {})
    };
  }
  return ledger;
}

function ledgerContainsDigest(entry, digest) {
  return entry?.digest === digest || entry?.prior_versions?.some((prior) => prior.digest === digest);
}

function ledgerTokenTotal(ledger) {
  return Object.values(ledger).reduce((total, entry) => total + entry.estimated_tokens +
    (entry.prior_versions ?? []).reduce((priorTotal, prior) => priorTotal + prior.estimated_tokens, 0), 0);
}

function normalizeRule(rule) {
  if (!isPlainObject(rule)) fail("rules must contain objects");
  const id = safeIdentifier(rule.id, "rule id");
  const digest = requiredString(rule.digest, `rule ${id} digest`);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) fail(`rule ${id} digest must be sha256`);
  return {
    id,
    digest,
    estimated_tokens: normalizeDuration(rule.estimated_tokens, `rule ${id} estimated_tokens`),
    immediate_intents: rule.immediate_intents === undefined ? ["*"] : normalizeIntents(rule.immediate_intents),
    effects: rule.effects === undefined ? [] : normalizeEffects(rule.effects)
  };
}

function normalizeIntents(value) {
  if (!Array.isArray(value)) fail("immediate_intents must be an array");
  return [...new Set(value.map((intent) => intent === "*" ? "*" : safeIdentifier(intent, "immediate_intent")))].sort();
}

function ruleApplies(rule, intent, effects) {
  return (rule.immediate_intents.includes("*") || rule.immediate_intents.includes(intent)) &&
    rule.effects.every((effect) => effects.includes(effect));
}

/** Selects only rules required by the current intent/effects and never drops ledger entries. */
export function selectRuleDelta({ immediate_intent, effects = [], rules = [], context_ledger = {} } = {}) {
  const intent = safeIdentifier(immediate_intent, "immediate_intent");
  const normalizedEffects = normalizeEffects(effects);
  if (!Array.isArray(rules)) fail("rules must be an array");
  const ledger = normalizeLedger(context_ledger);
  const applicable = rules.map(normalizeRule).filter((rule) => ruleApplies(rule, intent, normalizedEffects));
  const ids = new Set();
  for (const rule of applicable) {
    if (ids.has(rule.id)) fail(`duplicate applicable rule id: ${rule.id}`);
    ids.add(rule.id);
  }
  const delta = applicable.filter((rule) => !ledgerContainsDigest(ledger[rule.id], rule.digest))
    .map(({ immediate_intents, effects: ruleEffects, ...rule }) => rule)
    .sort((left, right) => left.id.localeCompare(right.id));
  const nextLedger = { ...ledger };
  for (const rule of applicable) {
    const previous = nextLedger[rule.id];
    if (!previous || previous.digest === rule.digest) continue;
    const priorVersions = [
      ...(previous.prior_versions ?? []),
      { digest: previous.digest, estimated_tokens: previous.estimated_tokens }
    ].filter((version, index, versions) => versions.findIndex((candidate) => candidate.digest === version.digest) === index)
      .filter((version) => version.digest !== rule.digest)
      .sort((left, right) => left.digest.localeCompare(right.digest));
    nextLedger[rule.id] = {
      digest: rule.digest,
      estimated_tokens: rule.estimated_tokens,
      ...(priorVersions.length ? { prior_versions: priorVersions } : {})
    };
  }
  for (const rule of delta) {
    if (!nextLedger[rule.id]) nextLedger[rule.id] = { digest: rule.digest, estimated_tokens: rule.estimated_tokens };
  }
  return Object.freeze({
    immediate_intent: intent,
    required_rule_ids: applicable.map((rule) => rule.id).sort(),
    rule_delta: delta.map((rule, index) => Object.freeze({ order: index + 1, ...rule })),
    context_ledger: Object.fromEntries(Object.entries(nextLedger).sort(([left], [right]) => left.localeCompare(right))),
    accumulated_policy_tokens: ledgerTokenTotal(nextLedger)
  });
}

function normalizeScope(scope, label = "write_scope") {
  const value = requiredString(scope, label);
  if (value.includes("\\") || value === "." || value.startsWith("./") || value.endsWith("/") ||
    value.includes("//") || value.includes("/./") || value.startsWith("/") || value === ".." ||
    value.startsWith("../") || value.includes("/../")) {
    fail(`${label} must be a safe repository-relative path`);
  }
  return value;
}

function scopesOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function scopesConnected(left, right) {
  return left.some((a) => right.some((b) => scopesOverlap(a, b)));
}

function boundedScope(value, label) {
  const normalized = normalizeScope(value, label);
  if (normalized.length > MAX_METADATA_VALUE_LENGTH) fail(`${label} exceeds the bounded metadata limit`);
  return normalized;
}

function boundedIdentifier(value, label) {
  const normalized = safeIdentifier(value, label);
  if (normalized.length > MAX_METADATA_VALUE_LENGTH) fail(`${label} exceeds the bounded metadata limit`);
  return normalized;
}

function sharedResourcesConnected(left, right) {
  return left.some((resource) => right.includes(resource));
}

function itemsConflict(left, right) {
  return scopesConnected(left.write_scopes, right.write_scopes) ||
    sharedResourcesConnected(left.shared_resources, right.shared_resources);
}

function canonicalWorkItems(workItems) {
  if (!Array.isArray(workItems) || !workItems.length || workItems.length > MAX_WORK_ITEMS) {
    fail(`work_items must contain between 1 and ${MAX_WORK_ITEMS} items`);
  }
  const items = workItems.map((item) => {
    if (!isPlainObject(item)) fail("work_items must contain objects");
    assertExactObjectKeys(item, new Set(["id", "write_scopes", "depends_on", "expected_artifact", "shared_resources"]), "work item");
    const scopes = item.write_scopes ?? [];
    const dependencies = item.depends_on ?? [];
    const sharedResources = item.shared_resources ?? [];
    if (!Array.isArray(scopes) || !scopes.length) fail("each work item needs at least one write_scope");
    if (!Array.isArray(dependencies) || dependencies.length > MAX_ITEM_DEPENDENCIES) {
      fail(`depends_on must contain at most ${MAX_ITEM_DEPENDENCIES} dependency ids`);
    }
    if (!Array.isArray(sharedResources) || sharedResources.length > MAX_SHARED_RESOURCES) {
      fail(`shared_resources must contain at most ${MAX_SHARED_RESOURCES} non-file resources`);
    }
    if (item.expected_artifact !== undefined && item.expected_artifact !== null && typeof item.expected_artifact !== "string") {
      fail("expected_artifact must be a bounded repository-relative path");
    }
    return {
      id: boundedIdentifier(item.id, "work item id"),
      write_scopes: [...new Set(scopes.map((scope) => boundedScope(scope, "write_scope")))].sort(),
      depends_on: [...new Set(dependencies.map((dependency) => boundedIdentifier(dependency, "depends_on item id")))].sort(),
      expected_artifact: item.expected_artifact === undefined || item.expected_artifact === null ? null : boundedScope(item.expected_artifact, "expected_artifact"),
      shared_resources: [...new Set(sharedResources.map((resource) => boundedIdentifier(resource, "shared_resource")))].sort()
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const identifiers = new Set(items.map((item) => item.id));
  if (identifiers.size !== items.length) fail("work item ids must be unique");
  for (const item of items) {
    for (const dependency of item.depends_on) {
      if (dependency === item.id) fail("work item may not depend on itself");
      if (!identifiers.has(dependency)) fail(`work item dependency is unknown: ${dependency}`);
    }
  }
  return items;
}

function dependencyEdges(items) {
  return items.flatMap((item) => item.depends_on.map((from) => ({ from, to: item.id })))
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}

function topologicalStages(items, edges, conflictEdges = []) {
  const ids = items.map((item) => item.id);
  const incoming = new Map(ids.map((id) => [id, new Set()]));
  const outgoing = new Map(ids.map((id) => [id, new Set()]));
  for (const edge of [...edges, ...conflictEdges]) {
    if (!incoming.get(edge.to).has(edge.from)) {
      incoming.get(edge.to).add(edge.from);
      outgoing.get(edge.from).add(edge.to);
    }
  }
  const stages = [];
  const remaining = new Set(ids);
  while (remaining.size) {
    const ready = [...remaining].filter((id) => incoming.get(id).size === 0).sort();
    if (!ready.length) fail("work item dependencies contain a cycle");
    stages.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      for (const downstream of outgoing.get(id)) incoming.get(downstream).delete(id);
    }
  }
  return stages;
}

function conflictEdges(items, dependencyEdges = []) {
  const outgoing = new Map(items.map((item) => [item.id, []]));
  dependencyEdges.forEach((edge) => outgoing.get(edge.from).push(edge.to));
  const reaches = (from, target, visited = new Set()) => {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return outgoing.get(from).some((next) => reaches(next, target, visited));
  };
  const edges = [];
  for (let index = 0; index < items.length; index += 1) {
    for (let candidate = index + 1; candidate < items.length; candidate += 1) {
      if (itemsConflict(items[index], items[candidate])) {
        if (reaches(items[index].id, items[candidate].id) || reaches(items[candidate].id, items[index].id)) continue;
        edges.push({ from: items[index].id, to: items[candidate].id });
      }
    }
  }
  return edges;
}

function executionClass({ items, edges, decompositionComplete, coherentChain }) {
  if (!decompositionComplete) return "EXPLORATORY";
  if (coherentChain) return "SERIAL";
  const components = [];
  for (const item of items) {
    const connected = components.filter((component) => component.some((existing) => itemsConflict(existing, item)));
    if (!connected.length) components.push([item]);
    else {
      components.push([item, ...connected.flat()]);
      connected.forEach((component) => components.splice(components.indexOf(component), 1));
    }
  }
  if (components.length <= 1) return "SERIAL";
  return edges.length ? "PIPELINED" : "PARALLEL";
}

/**
 * Returns the maximum useful disjoint worker topology. Seat 0 is coordinator
 * only and is deliberately excluded from worker_count.
 */
export function buildWorkerTopology({ work_items = [], maximum_workers, decomposition_complete = false, coherent_chain = false } = {}) {
  const declaredCapacity = maximum_workers !== undefined;
  if (declaredCapacity && (!Number.isInteger(maximum_workers) || maximum_workers < 1 || maximum_workers === Number.MAX_SAFE_INTEGER)) {
    fail("maximum_workers must be a bounded positive integer");
  }
  if (typeof decomposition_complete !== "boolean" || typeof coherent_chain !== "boolean") {
    fail("decomposition_complete and coherent_chain must be booleans");
  }
  if (!decomposition_complete && coherent_chain) fail("coherent_chain conflicts with incomplete decomposition");
  const items = canonicalWorkItems(work_items);
  const edges = dependencyEdges(items);
  const conflictScheduleEdges = conflictEdges(items, edges);
  const className = executionClass({ items, edges, decompositionComplete: decomposition_complete, coherentChain: coherent_chain });
  const launchItemStages = className === "EXPLORATORY"
    ? [[], items.map((item) => item.id)]
    : className === "SERIAL"
      ? [items.map((item) => item.id)]
      : className === "PARALLEL"
        // Conflict-connected items are owned by one worker, so the complete
        // component is available in stage 1 without cross-worker overlap.
        ? [items.map((item) => item.id)]
        : topologicalStages(items, edges, conflictScheduleEdges);
  const components = [];
  for (const item of items) {
    const connected = components.filter((component) => component.items.some((existing) => itemsConflict(existing, item)));
    if (!connected.length) components.push({ items: [item] });
    else {
      const merged = { items: [item, ...connected.flatMap((component) => component.items)] };
      for (const component of connected) components.splice(components.indexOf(component), 1);
      components.push(merged);
    }
  }
  const disjoint = components
    .map((component) => ({
      item_ids: component.items.map((item) => item.id).sort(),
      write_scopes: [...new Set(component.items.flatMap((item) => item.write_scopes))].sort()
    }))
    .sort((left, right) => left.item_ids[0].localeCompare(right.item_ids[0]));
  const firstLaunchIds = new Set(launchItemStages[0]);
  const launchUnits = className === "EXPLORATORY"
    ? [{ worker_kind: "bounded_discovery", item_ids: [], write_scopes: [] }]
    : className === "SERIAL"
    ? [{ item_ids: items.map((item) => item.id), write_scopes: [...new Set(items.flatMap((item) => item.write_scopes))].sort() }]
    : className === "PIPELINED"
      // A scope/resource component can contain a later dependency stage. Only
      // the ready item is launchable; its conflicting siblings remain queued.
      ? items.filter((item) => firstLaunchIds.has(item.id)).map((item) => ({ item_ids: [item.id], write_scopes: item.write_scopes }))
      : disjoint.filter((unit) => unit.item_ids.every((id) => firstLaunchIds.has(id)));
  const capacity = declaredCapacity ? maximum_workers : launchUnits.length;
  const selected = launchUnits.slice(0, capacity);
  const queued = className === "PARALLEL" ? launchUnits.slice(capacity) :
    className === "SERIAL" ? [] : className === "EXPLORATORY" ? disjoint :
      items.filter((item) => !selected.some((unit) => unit.item_ids.includes(item.id))).map((item) => ({
        item_ids: [item.id], write_scopes: item.write_scopes
      }));
  return Object.freeze({
    coordinator: Object.freeze({ seat: 0, label: "Seat 0" }),
    capacity_limit: declaredCapacity ? maximum_workers : UNVERIFIED,
    capacity_evidence: declaredCapacity ? "declared_by_caller" : UNVERIFIED,
    worker_count: selected.length,
    seat0_included_in_worker_count: false,
    maximum_useful_disjoint_workers: className === "EXPLORATORY" ? 1 : className === "SERIAL" ? 1 : disjoint.length,
    workers: selected.map((unit, index) => Object.freeze({
      seat: index + 1,
      label: `Seat ${index + 1}`,
      worker_kind: unit.worker_kind ?? "implementation",
      ...unit
    })),
    decomposed_items: items.map((item) => Object.freeze({ ...item })),
    queued_item_ids: queued.flatMap((unit) => unit.item_ids).sort(),
    queued_write_scopes: [...new Set(queued.flatMap((unit) => unit.write_scopes))].sort(),
    execution_class: className,
    decomposition_complete,
    coherent_chain,
    dependency_edges: edges,
    launch_stages: launchItemStages.map((item_ids, index) => Object.freeze({ stage: index + 1, item_ids })),
    artifact_expectations: items.filter((item) => item.expected_artifact !== null)
      .map((item) => Object.freeze({ item_id: item.id, expected_artifact: item.expected_artifact })),
    integration_order: topologicalStages(items, edges, conflictScheduleEdges).flat(),
    shared_resource_declarations: items.filter((item) => item.shared_resources.length)
      .map((item) => Object.freeze({ item_id: item.id, shared_resources: item.shared_resources })),
    scheduler_fallback: "native_or_manual_worker_without_expanded_authority"
  });
}

function normalizeSparkEligibility(value) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) fail("spark_eligibility must be an object");
  assertExactObjectKeys(value, new Set(["work_kind", "requires_judgment", "availability"]), "spark_eligibility");
  const workKind = safeIdentifier(value.work_kind, "spark_eligibility work_kind");
  if (!SPARK_WORK_KINDS.has(workKind)) fail("spark_eligibility work_kind must be bounded_ai_transformation or mechanical_edit");
  const requiresJudgment = strictBoolean(value.requires_judgment, "spark_eligibility requires_judgment");
  const availability = safeIdentifier(value.availability, "spark_eligibility availability");
  if (!SPARK_AVAILABILITY.has(availability)) fail("spark_eligibility availability is invalid");
  return Object.freeze({ work_kind: workKind, requires_judgment: requiresJudgment, availability });
}

function deriveSparkGate(input, classification, topology) {
  const eligibility = normalizeSparkEligibility(input.spark_eligibility);
  const workerRequired = classification.classification === "worker_required";
  const excludedEffects = classification.effects.filter((effect) => !SPARK_ALLOWED_EFFECTS.has(effect));
  if (!eligibility) {
    return Object.freeze({
      work_kind: "unexposed",
      requires_judgment: true,
      availability: "unknown_or_unexposed",
      actual_availability: UNVERIFIED,
      worker_required: workerRequired,
      excluded_effects: Object.freeze(excludedEffects)
    });
  }
  if (!workerRequired) fail("Spark eligibility requires immediate worker-required work");
  if (!topology || !topology.workers.length || topology.workers.some((worker) => worker.worker_kind !== "implementation")) {
    fail("Spark eligibility requires an implementation worker topology");
  }
  if (eligibility.requires_judgment) fail("Spark eligibility rejects judgment-required work");
  if (excludedEffects.length) fail("Spark eligibility rejects excluded effects");
  return Object.freeze({
    ...eligibility,
    actual_availability: UNVERIFIED,
    worker_required: true,
    excluded_effects: Object.freeze(excludedEffects)
  });
}

function sparkSelectable(gate) {
  return gate?.work_kind !== "unexposed" &&
    gate.requires_judgment === false &&
    gate.worker_required === true &&
    Array.isArray(gate.excluded_effects) && gate.excluded_effects.length === 0 &&
    gate.availability === "selectable";
}

function sparkConservativeFallback(gate) {
  return gate?.work_kind !== "unexposed" &&
    gate.requires_judgment === false &&
    gate.worker_required === true &&
    Array.isArray(gate.excluded_effects) && gate.excluded_effects.length === 0 &&
    gate.availability === "unknown_or_unexposed";
}

export function recommendLowestReliableModel({ complexity = "routine", adversarial = false, spark_gate } = {}) {
  const normalized = requiredString(complexity, "complexity");
  const matrix = adversarial || normalized === "adversarial"
    ? { model: "gpt-5.6-sol", reasoning: "high" }
    : normalized === "complex" ? { model: "gpt-5.6-terra", reasoning: "high" }
      // Direct callers retain the legacy mechanical recommendation. Bundle
      // composition always supplies a derived gate and therefore fails closed.
      : normalized === "mechanical" ? (
        spark_gate === undefined || sparkSelectable(spark_gate)
          ? { model: "gpt-5.3-codex-spark", reasoning: "low" }
          : sparkConservativeFallback(spark_gate)
            ? { model: "gpt-5.6-terra", reasoning: "low" }
            : { model: "gpt-5.6-terra", reasoning: "high" }
      )
      : normalized === "routine" ? { model: "gpt-5.6-luna", reasoning: "low" }
        : fail("complexity must be mechanical, routine, complex, or adversarial");
  return Object.freeze({
    ...matrix,
    rationale: "lowest known recommendation for the declared reasoning class",
    actual_model: UNVERIFIED,
    actual_reasoning_raw: UNVERIFIED
  });
}

function nativeFallback(recommendation) {
  return {
    mode: "native_fallback",
    requested_model: recommendation.model,
    requested_reasoning_raw: recommendation.reasoning,
    actual_model: UNVERIFIED,
    actual_reasoning_raw: UNVERIFIED,
    attestation: "native_runtime_metadata_unavailable"
  };
}

function normalizeReleaseIdentity(identity = {}, schemaVersion = ORCHESTRATION_BUNDLE_SCHEMA_VERSION) {
  if (!isPlainObject(identity)) fail("release_identity must be an object");
  const composerVersion = identity.composer_version ?? ORCHESTRATION_COMPOSER_VERSION;
  const expectedComposerVersion = schemaVersion === 2 ? "1.0.0" : schemaVersion === 3 ? "1.1.0" : schemaVersion === 4 ? "1.2.0" : schemaVersion === 5 ? "1.3.0" : ORCHESTRATION_COMPOSER_VERSION;
  if (composerVersion !== expectedComposerVersion) {
    fail(`composer_version must be ${expectedComposerVersion} for schema_version ${schemaVersion}`);
  }
  const checkoutSystemVersion = exactUnverifiedOrVersion(
    identity.checkout_system_version ?? UNVERIFIED,
    "checkout_system_version"
  );
  const installedSystemVersion = exactUnverifiedOrVersion(
    identity.installed_system_version ?? UNVERIFIED,
    "installed_system_version"
  );
  const installedReleaseId = exactUnverifiedOrIdentifier(
    identity.installed_release_id ?? UNVERIFIED,
    "installed_release_id"
  );
  const checkoutEvidence = identity.checkout_system_version_evidence ?? UNVERIFIED;
  if (![UNVERIFIED, "package_json"].includes(checkoutEvidence)) {
    fail("checkout_system_version_evidence must be package_json or Unverified");
  }
  const releaseEvidence = identity.installed_release_evidence ?? UNVERIFIED;
  if (![UNVERIFIED, "immutable_release_json"].includes(releaseEvidence)) {
    fail("installed_release_evidence must be immutable_release_json or Unverified");
  }
  if ((checkoutSystemVersion === UNVERIFIED) !== (checkoutEvidence === UNVERIFIED)) {
    fail("checkout system version and evidence must both be verified or Unverified");
  }
  const hasInstalledIdentity = installedSystemVersion !== UNVERIFIED || installedReleaseId !== UNVERIFIED;
  if (hasInstalledIdentity === (releaseEvidence === UNVERIFIED)) {
    fail("installed release identity requires immutable release evidence or exact Unverified");
  }
  if ((identity.active_host_interception ?? UNVERIFIED) !== UNVERIFIED) {
    fail("active_host_interception must remain Unverified without host metadata");
  }
  return Object.freeze({
    composer_version: composerVersion,
    checkout_system_version: checkoutSystemVersion,
    checkout_system_version_evidence: checkoutEvidence,
    installed_system_version: installedSystemVersion,
    installed_release_id: installedReleaseId,
    installed_release_evidence: releaseEvidence,
    active_host_interception: UNVERIFIED
  });
}

function normalizeAbsoluteIdentityPath(value, label) {
  if (value === UNVERIFIED) return UNVERIFIED;
  const normalized = requiredString(value, label);
  if (!path.isAbsolute(normalized) || path.normalize(normalized) !== normalized) {
    fail(`${label} must be a normalized absolute path or Unverified`);
  }
  return normalized;
}

function normalizeProjectSubtree(value) {
  if (value === UNVERIFIED) return UNVERIFIED;
  if (value === ".") return ".";
  return normalizeScope(value, "project subtree");
}

function normalizeProjectIdentity(identity, immediateIntent) {
  if (identity === undefined) {
    return Object.freeze({
      project: UNVERIFIED,
      project_root: UNVERIFIED,
      repository_root: UNVERIFIED,
      subtree: UNVERIFIED,
      immediate_intent: immediateIntent
    });
  }
  if (!isPlainObject(identity)) fail("project_identity must be an object");
  const project = identity.project === UNVERIFIED ? UNVERIFIED : safeIdentifier(identity.project, "project");
  const projectRoot = normalizeAbsoluteIdentityPath(identity.project_root ?? UNVERIFIED, "project_root");
  const repositoryRoot = normalizeAbsoluteIdentityPath(identity.repository_root ?? UNVERIFIED, "repository_root");
  const subtree = normalizeProjectSubtree(identity.subtree ?? UNVERIFIED);
  if (safeIdentifier(identity.immediate_intent, "project identity immediate_intent") !== immediateIntent) {
    fail("project identity immediate_intent does not match bundle");
  }
  const pathsAreVerified = projectRoot !== UNVERIFIED || repositoryRoot !== UNVERIFIED || subtree !== UNVERIFIED;
  if (pathsAreVerified && (projectRoot === UNVERIFIED || repositoryRoot === UNVERIFIED || subtree === UNVERIFIED)) {
    fail("project path identity must be complete or Unverified");
  }
  if (projectRoot !== UNVERIFIED) {
    const relative = path.relative(repositoryRoot, projectRoot).replaceAll("\\", "/") || ".";
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative) || relative !== subtree) {
      fail("project subtree does not match repository_root and project_root");
    }
  }
  return Object.freeze({
    project,
    project_root: projectRoot,
    repository_root: repositoryRoot,
    subtree,
    immediate_intent: immediateIntent
  });
}

function decisionReasons(classification) {
  const anti = classification.anti_evasion;
  if (classification.classification === "project_authority_required") {
    return ["declared_effect_requires_project_authority"];
  }
  if (classification.classification === "seat0_owned") {
    return [`seat0_owns_${classification.seat0_activity}`];
  }
  if (classification.classification === "seat0_atomic_allowed") {
    return ["single_low_risk_known_source_correction_within_five_minutes", "delegation_overhead_dominates"];
  }
  const reasons = [];
  if (anti.duration_over_limit_requires_worker) reasons.push("duration_exceeds_five_minutes");
  if (anti.effect_requires_worker) reasons.push("declared_effect_requires_worker");
  if (anti.mandatory_effect_requires_worker) reasons.push("mandatory_effect_requires_worker");
  if (anti.seat0_prohibition_requires_worker) reasons.push("seat0_is_prohibited");
  if (anti.unknown_remedy_requires_worker) reasons.push("remedy_is_not_known");
  if (anti.worker_owned_slice_requires_worker) reasons.push("slice_is_worker_owned");
  if (anti.multiple_surfaces_requires_worker) reasons.push("multiple_source_mutation_surfaces");
  if (!anti.low_risk_correction) reasons.push("low_risk_correction_not_established");
  if (!anti.delegation_overhead_dominates) reasons.push("delegation_overhead_does_not_dominate");
  if (!reasons.length) reasons.push("atomic_source_correction_contract_not_satisfied");
  return [...new Set(reasons)];
}

function seat0Decision(classification, identity = null) {
  const material = classification.classification !== "seat0_owned" ||
    ["acceptance", "decision", "integration"].includes(classification.seat0_activity);
  return Object.freeze({
    seat: 0,
    decision: classification.classification,
    reasons: Object.freeze(decisionReasons(classification)),
    material,
    decision_scope: "immediate_intent_and_declared_candidate_effects_only",
    decision_authority: "seat0_subject_only_to_external_authority_constraints",
    provenance_write_failure: "warning_and_coverage_gap_only",
    evidence_controls_execution: false,
    ...(identity ?? {})
  });
}

function assignWorkerModels(topology, recommendation, identity = null) {
  if (!topology) return null;
  return Object.freeze({
    ...topology,
    workers: topology.workers.map((worker) => {
      const discovery = worker.worker_kind === "bounded_discovery";
      return Object.freeze({
      ...worker,
      assignment_ids: discovery ? ["bounded-discovery"] : worker.item_ids,
      requested_model: recommendation.model,
      requested_reasoning_raw: recommendation.reasoning,
      actual_model: UNVERIFIED,
      actual_reasoning_raw: UNVERIFIED,
      model_attestation: "configured_not_runtime_attested",
      reasoning_attestation: "configured_not_runtime_attested",
      prompt_envelope: Object.freeze({
        schema_version: 1,
        worker_kind: worker.worker_kind,
        scope: Object.freeze({ item_ids: worker.item_ids, write_scopes: worker.write_scopes }),
        authority: "external_user_or_project_authority_only",
        non_authority: "does_not_grant_project_authority",
        non_goals: Object.freeze(discovery
          ? ["implementation", "release", "deployment", "publication", "project_authority_change"]
          : ["release", "deployment", "publication", "project_authority_change"]),
        acceptance: "coordinator_verifies_against_candidate",
        stop_conditions: WORKER_ADMISSION_STOP_CONDITIONS,
        validation: discovery ? "return_bounded_decomposition_facts_only" : "run_assigned_validation_and_report_actual_result",
        isolation_effects: discovery ? "read_only_discovery_no_project_mutation" : "receipt_bound_git_worktree_before_mutation",
        evidence: "return_bounded_evidence_only",
        return: "return_to_seat_0_using_required_fields",
        requested_model: recommendation.model,
        requested_reasoning_raw: recommendation.reasoning,
        fallback: "native_fallback_without_expanded_authority",
        ...(identity ?? {})
      })
    });
    })
  });
}

function topologyLifecycleStages(topology) {
  return Object.freeze([
    "decompose",
    "derive_deterministic_topology",
    topology.execution_class === "EXPLORATORY" ? "planned_bounded_discovery_before_implementation" :
      `planned_${topology.execution_class.toLowerCase()}_launch_stage_1`,
    "seat0_integration",
    "planned_authoritative_final_validation"
  ]);
}

function buildContracts(classification, recommendation, topology) {
  return Object.freeze({
    authority: Object.freeze({
      origin: "external_user_or_project_authority_only",
      bundle_grants_project_authority: false,
      digest_proves: "consistency_not_project_authority"
    }),
    isolation: Object.freeze({
      required_for_worker_mutation: classification.classification === "worker_required",
      mode: "receipt_bound_git_worktree_before_launch",
      evidence: UNVERIFIED
    }),
    validation: Object.freeze({
      coordinator_seat: 0,
      worker_results_are_advisory_until_verified: true,
      required_outcome: "verified_against_candidate",
      evidence: UNVERIFIED
    }),
    ...(classification.classification === "worker_required" && topology ? {
      lifecycle: Object.freeze({
        stages: topologyLifecycleStages(topology),
        capacity_bound_work_is_queued: true,
        mutating_worker_isolation: "isolated_branch_and_receipt_bound_worktree_per_worker",
        parallel_phase: `planned_${topology.execution_class.toLowerCase()}_launch`,
        integration_seat: 0,
        final_validation: "planned_seat_0_authoritative_against_integrated_candidate",
        execution_evidence: UNVERIFIED,
        execution_class: topology.execution_class,
        launch_stages: topology.launch_stages,
        scheduler_scope: "observational_launch_order_metadata_only_no_execution_authority",
        scheduler_failure_fallback: "native_or_manual_worker_without_expanded_authority"
      })
    } : {}),
    return: Object.freeze({
      recipient_seat: 0,
      required_fields: Object.freeze([
        "repository",
        "worktree",
        "base_commit",
        "final_head",
        "changed_files",
        "validation",
        "unresolved_findings"
      ])
    }),
    fallback: Object.freeze(nativeFallback(recommendation))
  });
}

/** Builds a content-addressed, persistence-safe JIT orchestration bundle. */
export function buildOrchestrationBundle(input = {}) {
  assertNoSensitiveFields(input);
  if (Object.hasOwn(input, "project_authority_granted")) {
    fail("project_authority_granted is not permitted in a persisted orchestration bundle");
  }
  const classification = classifyImmediateIntent(input);
  const releaseIdentity = normalizeReleaseIdentity(input.release_identity);
  const projectIdentity = normalizeProjectIdentity(input.project_identity, classification.immediate_intent);
  const predecessorDigest = input.predecessor_digest ?? null;
  if (predecessorDigest !== null && !/^sha256:[a-f0-9]{64}$/u.test(predecessorDigest)) fail("predecessor_digest must be a sha256 digest or null");
  const identity = executionIdentity({
    execution_id: input.execution_id,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    predecessor_digest: predecessorDigest,
    project_identity: projectIdentity,
    classification
  });
  const ruleSelection = selectRuleDelta({
    immediate_intent: classification.immediate_intent,
    effects: classification.effects,
    rules: input.rules ?? [],
    context_ledger: input.context_ledger ?? {}
  });
  const baseTopology = input.work_items?.length ? buildWorkerTopology({
    work_items: input.work_items,
    ...(Object.hasOwn(input, "maximum_workers") ? { maximum_workers: input.maximum_workers } : {}),
    ...(Object.hasOwn(input, "decomposition_complete") ? { decomposition_complete: input.decomposition_complete } : {}),
    ...(Object.hasOwn(input, "coherent_chain") ? { coherent_chain: input.coherent_chain } : {})
  }) : null;
  if (baseTopology && classification.classification !== "worker_required") {
    fail("work_items are permitted only for immediate worker-required work");
  }
  const sparkGate = deriveSparkGate(input, classification, baseTopology);
  const baseRecommendation = recommendLowestReliableModel({
    complexity: input.complexity ?? "routine",
    adversarial: input.adversarial ?? false,
    spark_gate: sparkGate
  });
  const recommendation = Object.freeze({ ...baseRecommendation, spark_gate: sparkGate });
  const topology = assignWorkerModels(baseTopology, recommendation, identity);
  const decision = seat0Decision(classification, identity);
  const contracts = buildContracts(classification, recommendation, topology);
  const bundle = {
    schema_version: ORCHESTRATION_BUNDLE_SCHEMA_VERSION,
    bundle_type: "jit_orchestration",
    release_identity: releaseIdentity,
    project_identity: projectIdentity,
    predecessor_digest: predecessorDigest,
    ...identity,
    immediate_intent: classification.immediate_intent,
    classification,
    seat0_decision: decision,
    rule_selection: ruleSelection,
    ...(topology ? { topology } : {}),
    model_recommendation: recommendation,
    contracts,
    native_fallback: contracts.fallback
  };
  return Object.freeze({ ...bundle, bundle_digest: bundleDigest(bundle) });
}

function equalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validateClassificationRecord(classification, immediateIntent) {
  if (!isPlainObject(classification)) fail("bundle classification must be an object");
  assertExactObjectKeys(classification, CLASSIFICATION_FIELDS, "bundle classification");
  if (safeIdentifier(classification.immediate_intent, "bundle classification immediate_intent") !== immediateIntent) {
    fail("bundle classification immediate_intent does not match bundle");
  }
  if (!CLASSIFICATIONS.has(classification.classification)) fail("bundle classification is invalid");
  const duration = normalizeDuration(classification.estimated_duration_ms, "bundle classification estimated_duration_ms");
  const effects = normalizeEffects(classification.effects);
  if (!equalJson(effects, classification.effects)) fail("bundle classification effects must be sorted and unique");
  const activity = classification.seat0_activity;
  if (activity !== null && (!SEAT0_OWNED_ACTIVITIES.has(activity) || typeof activity !== "string")) {
    fail("bundle classification seat0_activity is invalid");
  }
  const surfaces = normalizeSourceMutationSurfaces({ source_mutation_surfaces: classification.source_mutation_surfaces });
  if (!equalJson(surfaces, classification.source_mutation_surfaces)) fail("bundle classification source_mutation_surfaces must be sorted and unique");
  if (classification.five_minute_limit_ms !== FIVE_MINUTES_MS) fail("bundle classification five-minute limit is invalid");
  if (!isPlainObject(classification.anti_evasion)) fail("bundle classification anti_evasion must be an object");
  const anti = classification.anti_evasion;
  assertExactObjectKeys(anti, ANTI_EVASION_FIELDS, "bundle classification anti_evasion");
  const expectedBooleans = {
    duration_over_limit_requires_worker: duration > FIVE_MINUTES_MS,
    effect_requires_worker: hasWorkerEffect(effects),
    effect_requires_project_authority: hasAuthorityEffect(effects),
    mandatory_effect_requires_worker: effects.some((effect) => EFFECTS_REQUIRING_WORKER.has(effect)),
    multiple_surfaces_requires_worker: surfaces.length > 1,
    future_operations_considered: false
  };
  for (const [key, expected] of Object.entries(expectedBooleans)) {
    if (anti[key] !== expected) fail(`bundle classification anti_evasion.${key} is invalid`);
  }
  for (const key of ["seat0_prohibition_requires_worker", "unknown_remedy_requires_worker", "worker_owned_slice_requires_worker", "low_risk_correction", "delegation_overhead_dominates"]) {
    if (typeof anti[key] !== "boolean") fail(`bundle classification anti_evasion.${key} must be a boolean`);
  }
  if (anti.atomic_source_mutation_surface_count !== surfaces.length) fail("bundle classification atomic source mutation count is invalid");
  if (classification.classification === "project_authority_required" && !hasAuthorityEffect(effects)) {
    fail("project authority classification requires an authority effect");
  }
  if (hasAuthorityEffect(effects) && classification.classification !== "project_authority_required") {
    fail("persisted authority effects must remain project_authority_required");
  }
  if (classification.classification === "seat0_owned" && (!activity || effects.length || surfaces.length)) {
    fail("Seat 0-owned work must be a non-implementation activity");
  }
  if (classification.classification === "seat0_atomic_allowed") {
    if (activity || duration > FIVE_MINUTES_MS || !equalJson(effects, ["source_mutation"]) || surfaces.length !== 1 ||
      anti.seat0_prohibition_requires_worker || anti.unknown_remedy_requires_worker || anti.worker_owned_slice_requires_worker ||
      !anti.low_risk_correction || !anti.delegation_overhead_dominates || anti.mandatory_effect_requires_worker) {
      fail("Seat 0 atomic classification lacks required correction evidence");
    }
  }
}

function validateRecomputedClassification(classification) {
  const anti = classification.anti_evasion;
  const recomputed = classifyImmediateIntent({
    immediate_intent: classification.immediate_intent,
    estimated_duration_ms: classification.estimated_duration_ms,
    effects: classification.effects,
    // Bundles never carry or grant project authority. A direct user/project
    // authorization remains external to this persistence and integrity layer.
    project_authority_granted: false,
    seat0_activity: classification.seat0_activity ?? undefined,
    // This fact does not affect any non-atomic outcome when another condition
    // requires a worker. Atomic outcomes, however, prove it was explicitly
    // asserted, so preserve that distinction during recomputation.
    explicitly_atomic: classification.classification === "seat0_atomic_allowed",
    low_risk: anti.low_risk_correction,
    remedy_known: !anti.unknown_remedy_requires_worker,
    delegation_overhead_dominates: anti.delegation_overhead_dominates,
    seat0_prohibited: anti.seat0_prohibition_requires_worker,
    worker_owned_slice: anti.worker_owned_slice_requires_worker,
    source_mutation_surfaces: classification.source_mutation_surfaces
  });
  if (!equalJson(recomputed, classification)) {
    fail("bundle classification does not match persisted authority and classifier facts");
  }
}

function validateRuleSelection(selection, immediateIntent) {
  if (!isPlainObject(selection)) fail("bundle rule_selection must be an object");
  assertExactObjectKeys(selection, RULE_SELECTION_FIELDS, "bundle rule_selection");
  if (safeIdentifier(selection.immediate_intent, "bundle rule_selection immediate_intent") !== immediateIntent) {
    fail("bundle rule_selection immediate_intent does not match bundle");
  }
  if (!Array.isArray(selection.required_rule_ids) || !Array.isArray(selection.rule_delta)) fail("bundle rule_selection lists are invalid");
  const requiredRuleIds = [...new Set(selection.required_rule_ids.map((id) => safeIdentifier(id, "bundle required rule id")))].sort();
  if (!equalJson(requiredRuleIds, selection.required_rule_ids)) fail("bundle required_rule_ids must be sorted and unique");
  const ledger = normalizeLedger(selection.context_ledger);
  if (!equalJson(ledger, selection.context_ledger)) fail("bundle context_ledger must be canonical");
  if (selection.accumulated_policy_tokens !== ledgerTokenTotal(ledger)) fail("bundle accumulated policy tokens are invalid");
  const deltaIds = [];
  selection.rule_delta.forEach((rule, index) => {
    if (!isPlainObject(rule) || rule.order !== index + 1) fail("bundle rule_delta must have contiguous one-based order");
    assertExactObjectKeys(rule, RULE_DELTA_FIELDS, "bundle rule_delta entry");
    const normalized = normalizeRule(rule);
    deltaIds.push(normalized.id);
    if (!requiredRuleIds.includes(normalized.id)) fail("bundle rule_delta contains a rule that is not required");
    if (ledger[normalized.id]?.digest !== normalized.digest) fail("bundle rule_delta is not the current monotonic ledger version");
  });
  if (!equalJson([...new Set(deltaIds)].sort(), deltaIds)) fail("bundle rule_delta must be ordered by unique rule id");
}

function validateTopology(topology, recommendation, schemaVersion, identity = null) {
  if (!isPlainObject(topology)) fail("bundle topology must be an object");
  assertExactObjectKeys(topology.coordinator, TOPOLOGY_COORDINATOR_FIELDS, "bundle topology coordinator");
  if (!isPlainObject(topology.coordinator) || topology.coordinator.seat !== 0 || topology.coordinator.label !== "Seat 0") {
    fail("bundle topology must identify Seat 0 as coordinator");
  }
  const v2TopologyFields = new Set([...V3_TOPOLOGY_FIELDS].filter((field) => !["capacity_limit", "capacity_evidence", "decomposed_items", "queued_item_ids", "queued_write_scopes"].includes(field)));
  if (schemaVersion === 2) assertExactObjectKeys(topology, v2TopologyFields, "bundle topology");
  else if (schemaVersion === 3) assertExactObjectKeys(topology, V3_TOPOLOGY_FIELDS, "bundle topology");
  else assertExactObjectKeys(topology, TOPOLOGY_FIELDS, "bundle topology");
  const exploratoryDiscovery = schemaVersion >= 4 && topology.execution_class === "EXPLORATORY";
  if (!Number.isInteger(topology.worker_count) || topology.worker_count < 0 ||
    !Number.isInteger(topology.maximum_useful_disjoint_workers) || topology.maximum_useful_disjoint_workers < topology.worker_count ||
    topology.seat0_included_in_worker_count !== false || !Array.isArray(topology.workers) || topology.worker_count !== topology.workers.length) {
    fail("bundle topology incorrectly counts Seat 0");
  }
  if ((schemaVersion < 4 && topology.worker_count < 1) ||
    (schemaVersion >= 4 && topology.worker_count < 1) ||
    (exploratoryDiscovery && (topology.worker_count !== 1 || topology.maximum_useful_disjoint_workers !== 1))) {
    fail("bundle topology worker count does not match its execution class");
  }
  if (schemaVersion >= 3) {
    const hasDeclaredCapacity = Number.isInteger(topology.capacity_limit) && topology.capacity_limit >= 1 &&
      topology.capacity_limit !== Number.MAX_SAFE_INTEGER && topology.capacity_evidence === "declared_by_caller";
    const hasUnverifiedCapacity = topology.capacity_limit === UNVERIFIED && topology.capacity_evidence === UNVERIFIED;
    if ((!hasDeclaredCapacity && !hasUnverifiedCapacity) || !Array.isArray(topology.decomposed_items) ||
      !Array.isArray(topology.queued_item_ids) || !Array.isArray(topology.queued_write_scopes)) {
      fail("bundle topology capacity must be declared by caller or Unverified");
    }
  }
  const seenWorkerScopes = [];
  topology.workers.forEach((worker, index) => {
    const seat = index + 1;
    assertExactObjectKeys(worker, schemaVersion >= 4 ? V4_TOPOLOGY_WORKER_FIELDS : TOPOLOGY_WORKER_FIELDS, "bundle topology worker");
    const discovery = schemaVersion >= 4 && worker.worker_kind === "bounded_discovery";
    if (!isPlainObject(worker) || worker.seat !== seat || worker.label !== `Seat ${seat}` ||
      !Array.isArray(worker.item_ids) || (!discovery && !worker.item_ids.length) ||
      !Array.isArray(worker.write_scopes) || (!discovery && !worker.write_scopes.length)) {
      fail("bundle topology workers must be contiguous numbered Seats 1..N");
    }
    if (schemaVersion >= 4 && !["implementation", "bounded_discovery"].includes(worker.worker_kind)) {
      fail("bundle topology worker kind is invalid");
    }
    if (discovery && (!exploratoryDiscovery || seat !== 1 || worker.item_ids.length || worker.write_scopes.length)) {
      fail("bounded discovery must be the sole non-implementation Seat 1 assignment");
    }
    if (!discovery && exploratoryDiscovery) fail("EXPLORATORY topology may launch only bounded discovery");
    const itemIds = [...new Set(worker.item_ids.map((id) => safeIdentifier(id, "bundle topology worker item id")))].sort();
    if (!equalJson(itemIds, worker.item_ids)) fail("bundle topology worker item_ids must be sorted and unique");
    const expectedAssignmentIds = discovery ? ["bounded-discovery"] : worker.item_ids;
    if (!Array.isArray(worker.assignment_ids) || !equalJson(worker.assignment_ids, expectedAssignmentIds)) {
      fail("bundle topology worker assignment_ids must match the worker kind");
    }
    worker.assignment_ids.forEach((id) => safeIdentifier(id, "bundle topology worker assignment id"));
    const writeScopes = [...new Set(worker.write_scopes.map((scope) => normalizeScope(scope, "bundle topology worker write_scope")))].sort();
    if (!equalJson(writeScopes, worker.write_scopes)) fail("bundle topology worker write_scopes must be sorted and unique");
    if (seenWorkerScopes.some((scopes) => scopesConnected(scopes, writeScopes))) {
      fail("bundle topology worker write_scopes must be disjoint");
    }
    seenWorkerScopes.push(writeScopes);
    if (worker.requested_model !== recommendation.model ||
      worker.requested_reasoning_raw !== recommendation.reasoning) {
      fail("bundle topology worker request does not match the model recommendation");
    }
    if (worker.actual_model !== UNVERIFIED || worker.actual_reasoning_raw !== UNVERIFIED) {
      fail("bundle topology actual model and reasoning require authoritative runtime evidence");
    }
    if (worker.model_attestation !== "configured_not_runtime_attested" ||
      worker.reasoning_attestation !== "configured_not_runtime_attested") {
      fail("bundle topology worker attestation is invalid");
    }
    validateWorkerPromptEnvelope(worker.prompt_envelope, worker, recommendation, schemaVersion);
    if (schemaVersion >= 6 && (!identity ||
      worker.prompt_envelope.execution_id !== identity.execution_id ||
      worker.prompt_envelope.correlation_id !== identity.correlation_id ||
      worker.prompt_envelope.causation_id !== identity.causation_id)) {
      fail("bundle worker prompt execution identity is invalid");
    }
  });
  if (schemaVersion >= 3) {
    const queuedItemIds = [...new Set(topology.queued_item_ids.map((id) => safeIdentifier(id, "bundle queued item id")))].sort();
    const queuedScopes = [...new Set(topology.queued_write_scopes.map((scope) => normalizeScope(scope, "bundle queued write_scope")))].sort();
    const queuedOverlapIsUnsafe = schemaVersion < 4 || topology.execution_class !== "PIPELINED";
    if (!equalJson(queuedItemIds, topology.queued_item_ids) || !equalJson(queuedScopes, topology.queued_write_scopes) ||
      (queuedOverlapIsUnsafe && seenWorkerScopes.some((scopes) => scopesConnected(scopes, queuedScopes)))) {
      fail("bundle queued work must be canonical and disjoint from reserved workers");
    }
    const inventory = topology.decomposed_items.map((item) => {
      if (!isPlainObject(item)) fail("bundle decomposed inventory must contain objects");
      assertExactObjectKeys(item, schemaVersion >= 4 ? TOPOLOGY_ITEM_FIELDS : LEGACY_TOPOLOGY_ITEM_FIELDS, "bundle decomposed inventory item");
      if (!Array.isArray(item.write_scopes) || !item.write_scopes.length) fail("bundle decomposed inventory item needs write scopes");
      const normalized = {
        id: safeIdentifier(item.id, "bundle decomposed inventory item id"),
        write_scopes: [...new Set(item.write_scopes.map((scope) => normalizeScope(scope, "bundle decomposed inventory write_scope")))].sort()
      };
      if (schemaVersion >= 4) {
        if (!Array.isArray(item.depends_on) || !Array.isArray(item.shared_resources) ||
          item.depends_on.length > MAX_ITEM_DEPENDENCIES || item.shared_resources.length > MAX_SHARED_RESOURCES ||
          (item.expected_artifact !== null && typeof item.expected_artifact !== "string")) {
          fail("bundle decomposed inventory dependency metadata is invalid");
        }
        normalized.depends_on = [...new Set(item.depends_on.map((id) => boundedIdentifier(id, "bundle decomposed dependency id")))].sort();
        normalized.expected_artifact = item.expected_artifact === null ? null : boundedScope(item.expected_artifact, "bundle expected artifact");
        normalized.shared_resources = [...new Set(item.shared_resources.map((resource) => boundedIdentifier(resource, "bundle shared resource")))].sort();
      }
      return normalized;
    }).sort((left, right) => left.id.localeCompare(right.id));
    if (inventory.length === 0 || new Set(inventory.map((item) => item.id)).size !== inventory.length || !equalJson(inventory, topology.decomposed_items)) {
      fail("bundle decomposed inventory must be a sorted unique canonical inventory");
    }
    const expected = buildWorkerTopology({
      work_items: inventory,
      ...(topology.capacity_limit === UNVERIFIED ? {} : { maximum_workers: topology.capacity_limit }),
      ...(schemaVersion >= 4 ? {
        decomposition_complete: topology.decomposition_complete,
        coherent_chain: topology.coherent_chain
      } : { decomposition_complete: true })
    });
    const expectedWorkers = expected.workers.map(({ item_ids, write_scopes, worker_kind }) => ({
      item_ids, write_scopes, ...(schemaVersion >= 4 ? { worker_kind } : {})
    }));
    const actualWorkers = topology.workers.map(({ item_ids, write_scopes, worker_kind }) => ({
      item_ids, write_scopes, ...(schemaVersion >= 4 ? { worker_kind } : {})
    }));
    if (topology.maximum_useful_disjoint_workers !== expected.maximum_useful_disjoint_workers ||
      topology.worker_count !== expected.worker_count || !equalJson(actualWorkers, expectedWorkers) ||
      !equalJson(topology.queued_item_ids, expected.queued_item_ids) || !equalJson(topology.queued_write_scopes, expected.queued_write_scopes)) {
      fail("bundle workers and queue must be the exact disjoint partition of the decomposed inventory");
    }
    if (schemaVersion >= 4) {
      if (!EXECUTION_CLASSES.has(topology.execution_class) || typeof topology.decomposition_complete !== "boolean" ||
        typeof topology.coherent_chain !== "boolean" || topology.scheduler_fallback !== "native_or_manual_worker_without_expanded_authority" ||
        !equalJson(topology.dependency_edges, expected.dependency_edges) ||
        !equalJson(topology.launch_stages, expected.launch_stages) ||
        !equalJson(topology.artifact_expectations, expected.artifact_expectations) ||
        !equalJson(topology.integration_order, expected.integration_order) ||
        !equalJson(topology.shared_resource_declarations, expected.shared_resource_declarations) ||
        topology.execution_class !== expected.execution_class) {
        fail("bundle deterministic dependency topology is invalid");
      }
    }
  }
}

function validateWorkerPromptEnvelope(envelope, worker, recommendation, schemaVersion) {
  if (!isPlainObject(envelope)) fail("bundle worker prompt envelope must be an object");
  assertExactObjectKeys(envelope, schemaVersion >= 6 ? V6_WORKER_PROMPT_ENVELOPE_FIELDS : schemaVersion >= 4 ? V4_WORKER_PROMPT_ENVELOPE_FIELDS : WORKER_PROMPT_ENVELOPE_FIELDS, "bundle worker prompt envelope");
  const discovery = schemaVersion >= 4 && worker.worker_kind === "bounded_discovery";
  const expectedNonGoals = discovery
    ? ["implementation", "release", "deployment", "publication", "project_authority_change"]
    : ["release", "deployment", "publication", "project_authority_change"];
  if (envelope.schema_version !== 1 || !isPlainObject(envelope.scope) ||
    (schemaVersion >= 4 && envelope.worker_kind !== worker.worker_kind) ||
    !equalJson(envelope.scope.item_ids, worker.item_ids) || !equalJson(envelope.scope.write_scopes, worker.write_scopes) ||
    envelope.authority !== "external_user_or_project_authority_only" ||
    envelope.non_authority !== "does_not_grant_project_authority" ||
    !equalJson(envelope.non_goals, expectedNonGoals) ||
    envelope.acceptance !== "coordinator_verifies_against_candidate" ||
    !equalJson(envelope.stop_conditions, WORKER_ADMISSION_STOP_CONDITIONS) ||
    envelope.validation !== (discovery ? "return_bounded_decomposition_facts_only" : "run_assigned_validation_and_report_actual_result") ||
    envelope.isolation_effects !== (discovery ? "read_only_discovery_no_project_mutation" : "receipt_bound_git_worktree_before_mutation") ||
    envelope.evidence !== "return_bounded_evidence_only" ||
    envelope.return !== "return_to_seat_0_using_required_fields" ||
    envelope.requested_model !== recommendation.model || envelope.requested_reasoning_raw !== recommendation.reasoning ||
    envelope.fallback !== "native_fallback_without_expanded_authority") {
    fail("bundle worker prompt envelope is invalid");
  }
  if (schemaVersion >= 6) {
    opaqueExecutionIdentifier(envelope.execution_id, "bundle worker prompt execution_id", "execution");
    opaqueExecutionIdentifier(envelope.correlation_id, "bundle worker prompt correlation_id", "correlation");
    opaqueExecutionIdentifier(envelope.causation_id, "bundle worker prompt causation_id", "causation");
  }
}

function validateSeat0Decision(decision, classification, schemaVersion, identity = null) {
  if (!isPlainObject(decision) || decision.seat !== 0 || decision.decision !== classification.classification ||
    !Array.isArray(decision.reasons) || !decision.reasons.length) {
    fail("bundle Seat 0 decision is invalid");
  }
  const decisionFields = schemaVersion >= 6 ? V6_SEAT0_DECISION_FIELDS : schemaVersion >= 5 ? SEAT0_DECISION_FIELDS : LEGACY_SEAT0_DECISION_FIELDS;
  assertExactObjectKeys(decision, decisionFields, "bundle Seat 0 decision");
  decision.reasons.forEach((reason) => safeIdentifier(reason, "bundle Seat 0 reason"));
  if (!equalJson(decision.reasons, decisionReasons(classification))) {
    fail("bundle Seat 0 reasons do not match the classifier");
  }
  if (schemaVersion >= 5) {
    const expected = seat0Decision(classification, schemaVersion >= 6 ? identity : null);
    if (decision.material !== expected.material ||
      decision.decision_scope !== expected.decision_scope ||
      decision.decision_authority !== expected.decision_authority ||
      decision.provenance_write_failure !== expected.provenance_write_failure ||
      decision.evidence_controls_execution !== false ||
      (schemaVersion >= 6 && (!identity || decision.execution_id !== identity.execution_id ||
        decision.correlation_id !== identity.correlation_id || decision.causation_id !== identity.causation_id))) {
      fail("bundle Seat 0 decision provenance contract is invalid");
    }
  }
}

function validateSparkGate(gate, classification, topology) {
  if (!isPlainObject(gate)) fail("bundle Spark gate must be an object");
  assertExactObjectKeys(gate, SPARK_GATE_FIELDS, "bundle Spark gate");
  const persistedEligibility = gate.work_kind === "unexposed" ? undefined : {
    work_kind: gate.work_kind,
    requires_judgment: gate.requires_judgment,
    availability: gate.availability
  };
  const expected = deriveSparkGate({ ...(persistedEligibility ? { spark_eligibility: persistedEligibility } : {}) }, classification, topology);
  if (!equalJson(gate, expected)) fail("bundle Spark gate is not composer-derived");
  return expected;
}

function validateModelRecommendation(recommendation, schemaVersion, classification, topology) {
  if (!isPlainObject(recommendation)) fail("bundle model_recommendation must be an object");
  assertExactObjectKeys(recommendation, schemaVersion >= 5 ? V5_MODEL_RECOMMENDATION_FIELDS : MODEL_RECOMMENDATION_FIELDS, "bundle model_recommendation");
  const model = safeIdentifier(recommendation.model, "bundle recommended model");
  const reasoning = safeIdentifier(recommendation.reasoning, "bundle recommended reasoning");
  const supported = (model === "gpt-5.6-luna" && reasoning === "low") ||
    (model === "gpt-5.3-codex-spark" && reasoning === "low") ||
    (model === "gpt-5.6-terra" && reasoning === "low") ||
    (model === "gpt-5.6-terra" && reasoning === "high") ||
    (model === "gpt-5.6-sol" && reasoning === "high");
  if (!supported || recommendation.rationale !== "lowest known recommendation for the declared reasoning class") {
    fail("bundle model recommendation is not a supported composer decision");
  }
  if (recommendation.actual_model !== UNVERIFIED || recommendation.actual_reasoning_raw !== UNVERIFIED) {
    fail("bundle model recommendation actual evidence must be Unverified");
  }
  if (schemaVersion >= 5) {
    const gate = validateSparkGate(recommendation.spark_gate, classification, topology);
    if (recommendation.model === "gpt-5.3-codex-spark" && !sparkSelectable(gate)) {
      fail("bundle Spark request requires a composer-derived eligible gate");
    }
    if (recommendation.model === "gpt-5.6-terra" && recommendation.reasoning === "low" &&
      !sparkConservativeFallback(gate)) {
      fail("bundle Terra-low fallback requires proven Spark eligibility and unknown availability");
    }
  }
}

function validateFallback(fallback, recommendation) {
  assertExactObjectKeys(fallback, FALLBACK_FIELDS, "bundle fallback contract");
  if (!isPlainObject(fallback) || fallback.mode !== "native_fallback" ||
    fallback.requested_model !== recommendation.model ||
    fallback.requested_reasoning_raw !== recommendation.reasoning ||
    fallback.actual_model !== UNVERIFIED ||
    fallback.actual_reasoning_raw !== UNVERIFIED ||
    fallback.attestation !== "native_runtime_metadata_unavailable") {
    fail("bundle fallback contract is invalid");
  }
}

function validateContracts(contracts, classification, recommendation, schemaVersion, topology) {
  if (!isPlainObject(contracts) || !isPlainObject(contracts.authority) ||
    !isPlainObject(contracts.isolation) ||
    !isPlainObject(contracts.validation) || !isPlainObject(contracts.return) ||
    !isPlainObject(contracts.fallback)) {
    fail("bundle orchestration contracts are invalid");
  }
  const lifecycleRequired = schemaVersion >= 3 && classification.classification === "worker_required" && topology;
  const expectedContractFields = lifecycleRequired ? CONTRACT_FIELDS : new Set([...CONTRACT_FIELDS].filter((field) => field !== "lifecycle"));
  assertExactObjectKeys(contracts, expectedContractFields, "bundle orchestration contracts");
  const authority = contracts.authority;
  assertExactObjectKeys(authority, AUTHORITY_CONTRACT_FIELDS, "bundle authority contract");
  if (authority.origin !== "external_user_or_project_authority_only" ||
    authority.bundle_grants_project_authority !== false ||
    authority.digest_proves !== "consistency_not_project_authority") {
    fail("bundle authority contract is invalid");
  }
  const isolation = contracts.isolation;
  assertExactObjectKeys(isolation, ISOLATION_FIELDS, "bundle isolation contract");
  if (isolation.required_for_worker_mutation !== (classification.classification === "worker_required") ||
    isolation.mode !== "receipt_bound_git_worktree_before_launch" ||
    isolation.evidence !== UNVERIFIED) {
    fail("bundle isolation contract is invalid");
  }
  const validation = contracts.validation;
  assertExactObjectKeys(validation, VALIDATION_FIELDS, "bundle validation contract");
  if (validation.coordinator_seat !== 0 || validation.worker_results_are_advisory_until_verified !== true ||
    validation.required_outcome !== "verified_against_candidate" || validation.evidence !== UNVERIFIED) {
    fail("bundle validation contract is invalid");
  }
  if (lifecycleRequired) {
    const lifecycle = contracts.lifecycle;
    if (!isPlainObject(lifecycle)) fail("bundle lifecycle contract is invalid");
    assertExactObjectKeys(lifecycle, schemaVersion >= 4 ? LIFECYCLE_FIELDS : LEGACY_LIFECYCLE_FIELDS, "bundle lifecycle contract");
    const expectedStages = schemaVersion >= 4 ? topologyLifecycleStages(topology) : LEGACY_LIFECYCLE_STAGES;
    const expectedPhase = schemaVersion >= 4 ? `planned_${topology.execution_class.toLowerCase()}_launch` : "planned_parallel_work_test_review";
    if (!equalJson(lifecycle.stages, expectedStages) || lifecycle.capacity_bound_work_is_queued !== true ||
      lifecycle.mutating_worker_isolation !== "isolated_branch_and_receipt_bound_worktree_per_worker" ||
      lifecycle.parallel_phase !== expectedPhase || lifecycle.integration_seat !== 0 ||
      lifecycle.final_validation !== "planned_seat_0_authoritative_against_integrated_candidate" ||
      lifecycle.execution_evidence !== UNVERIFIED ||
      (schemaVersion >= 4 && (lifecycle.execution_class !== topology.execution_class ||
        !equalJson(lifecycle.launch_stages, topology.launch_stages) ||
        lifecycle.scheduler_scope !== "observational_launch_order_metadata_only_no_execution_authority" ||
        lifecycle.scheduler_failure_fallback !== "native_or_manual_worker_without_expanded_authority"))) {
      fail("bundle lifecycle contract is invalid");
    }
  }
  const returnContract = contracts.return;
  assertExactObjectKeys(returnContract, RETURN_CONTRACT_FIELDS, "bundle return contract");
  const expectedFields = [
    "repository",
    "worktree",
    "base_commit",
    "final_head",
    "changed_files",
    "validation",
    "unresolved_findings"
  ];
  if (returnContract.recipient_seat !== 0 || !equalJson(returnContract.required_fields, expectedFields)) {
    fail("bundle return contract is invalid");
  }
  validateFallback(contracts.fallback, recommendation);
}

export function validateOrchestrationBundle(bundle) {
  assertNoSensitiveFields(bundle, "bundle");
  if (!isPlainObject(bundle) || ![2, 3, 4, 5, ORCHESTRATION_BUNDLE_SCHEMA_VERSION].includes(bundle.schema_version) || bundle.bundle_type !== "jit_orchestration") {
    fail("unsupported orchestration bundle");
  }
  assertExactObjectKeys(bundle, bundle.schema_version >= 6 ? BUNDLE_FIELDS : new Set([...BUNDLE_FIELDS].filter((field) => !["execution_id", "correlation_id", "causation_id"].includes(field))), "bundle");
  const immediateIntent = safeIdentifier(bundle.immediate_intent, "bundle immediate_intent");
  const releaseIdentity = normalizeReleaseIdentity(bundle.release_identity, bundle.schema_version);
  if (!equalJson(releaseIdentity, bundle.release_identity)) fail("bundle release_identity must be canonical");
  const projectIdentity = normalizeProjectIdentity(bundle.project_identity, immediateIntent);
  if (!equalJson(projectIdentity, bundle.project_identity)) fail("bundle project_identity must be canonical");
  const predecessorDigest = bundle.predecessor_digest;
  if (predecessorDigest !== null && (typeof predecessorDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(predecessorDigest))) {
    fail("bundle predecessor_digest is invalid");
  }
  const identity = bundle.schema_version >= 6 ? executionIdentity({
    execution_id: bundle.execution_id,
    correlation_id: bundle.correlation_id,
    causation_id: bundle.causation_id,
    predecessor_digest: predecessorDigest,
    project_identity: projectIdentity,
    classification: bundle.classification
  }) : null;
  validateClassificationRecord(bundle.classification, immediateIntent);
  validateSeat0Decision(bundle.seat0_decision, bundle.classification, bundle.schema_version, identity);
  validateRecomputedClassification(bundle.classification);
  if (bundle.bundle_digest !== bundleDigest(bundle)) fail("bundle digest is invalid");
  validateRuleSelection(bundle.rule_selection, immediateIntent);
  if (bundle.topology && bundle.schema_version === 3 && bundle.classification.classification !== "worker_required") {
    fail("only immediate worker-required work may persist a worker topology");
  }
  if (bundle.topology) validateTopology(bundle.topology, bundle.model_recommendation, bundle.schema_version, identity);
  validateModelRecommendation(bundle.model_recommendation, bundle.schema_version, bundle.classification, bundle.topology);
  validateContracts(bundle.contracts, bundle.classification, bundle.model_recommendation, bundle.schema_version, bundle.topology);
  validateFallback(bundle.native_fallback, bundle.model_recommendation);
  if (!equalJson(bundle.native_fallback, bundle.contracts.fallback)) fail("bundle fallback records must match");
  return true;
}

export const verifyOrchestrationBundle = validateOrchestrationBundle;
