import crypto from "node:crypto";
import path from "node:path";

export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const ORCHESTRATION_BUNDLE_SCHEMA_VERSION = 2;
export const ORCHESTRATION_COMPOSER_VERSION = "1.0.0";
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

const SEAT0_DECISION_FIELDS = new Set(["seat", "decision", "reasons"]);
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
  "worker_count",
  "seat0_included_in_worker_count",
  "maximum_useful_disjoint_workers",
  "workers"
]);
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
const WORKER_PROMPT_ENVELOPE_FIELDS = new Set([
  "schema_version", "scope", "authority", "non_authority", "non_goals",
  "acceptance", "stop_conditions", "validation", "isolation_effects",
  "evidence", "return", "requested_model", "requested_reasoning_raw", "fallback"
]);
const MODEL_RECOMMENDATION_FIELDS = new Set([
  "model",
  "reasoning",
  "rationale",
  "actual_model",
  "actual_reasoning_raw"
]);
const CONTRACT_FIELDS = new Set(["authority", "isolation", "validation", "return", "fallback"]);
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
  const value = requiredString(scope, label).replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (value === "." || value.startsWith("/") || value === ".." || value.startsWith("../") || value.includes("/../")) {
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

/**
 * Returns the maximum useful disjoint worker topology. Seat 0 is coordinator
 * only and is deliberately excluded from worker_count.
 */
export function buildWorkerTopology({ work_items = [], maximum_workers = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(work_items) || !work_items.length) fail("work_items must be a non-empty array");
  if (!Number.isInteger(maximum_workers) || maximum_workers < 1) fail("maximum_workers must be a positive integer");
  const items = work_items.map((item) => {
    if (!isPlainObject(item)) fail("work_items must contain objects");
    const scopes = item.write_scopes ?? [];
    if (!Array.isArray(scopes) || !scopes.length) fail("each work item needs at least one write_scope");
    return { id: safeIdentifier(item.id, "work item id"), write_scopes: [...new Set(scopes.map(normalizeScope))].sort() };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) fail("work item ids must be unique");
  const components = [];
  for (const item of items) {
    const connected = components.filter((component) => component.items.some((existing) => scopesConnected(existing.write_scopes, item.write_scopes)));
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
  const selected = disjoint.slice(0, maximum_workers);
  // When the worker cap binds, remaining disconnected units are intentionally
  // kept together only as an execution queue; no overlapping workers result.
  if (disjoint.length > maximum_workers) {
    selected[maximum_workers - 1] = {
      item_ids: disjoint.slice(maximum_workers - 1).flatMap((unit) => unit.item_ids).sort(),
      write_scopes: disjoint.slice(maximum_workers - 1).flatMap((unit) => unit.write_scopes).sort()
    };
  }
  return Object.freeze({
    coordinator: Object.freeze({ seat: 0, label: "Seat 0" }),
    worker_count: selected.length,
    seat0_included_in_worker_count: false,
    maximum_useful_disjoint_workers: disjoint.length,
    workers: selected.map((unit, index) => Object.freeze({ seat: index + 1, label: `Seat ${index + 1}`, ...unit }))
  });
}

export function recommendLowestReliableModel({ complexity = "routine", adversarial = false } = {}) {
  const normalized = requiredString(complexity, "complexity");
  const matrix = adversarial || normalized === "adversarial"
    ? { model: "gpt-5.6-sol", reasoning: "high" }
    : normalized === "complex" ? { model: "gpt-5.6-terra", reasoning: "high" }
      : normalized === "routine" ? { model: "gpt-5.6-luna", reasoning: "low" }
        : fail("complexity must be routine, complex, or adversarial");
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

function normalizeReleaseIdentity(identity = {}) {
  if (!isPlainObject(identity)) fail("release_identity must be an object");
  const composerVersion = identity.composer_version ?? ORCHESTRATION_COMPOSER_VERSION;
  if (composerVersion !== ORCHESTRATION_COMPOSER_VERSION) {
    fail(`composer_version must be ${ORCHESTRATION_COMPOSER_VERSION}`);
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

function seat0Decision(classification) {
  return Object.freeze({
    seat: 0,
    decision: classification.classification,
    reasons: Object.freeze(decisionReasons(classification))
  });
}

function assignWorkerModels(topology, recommendation) {
  if (!topology) return null;
  return Object.freeze({
    ...topology,
    workers: topology.workers.map((worker) => Object.freeze({
      ...worker,
      assignment_ids: worker.item_ids,
      requested_model: recommendation.model,
      requested_reasoning_raw: recommendation.reasoning,
      actual_model: UNVERIFIED,
      actual_reasoning_raw: UNVERIFIED,
      model_attestation: "configured_not_runtime_attested",
      reasoning_attestation: "configured_not_runtime_attested",
      prompt_envelope: Object.freeze({
        schema_version: 1,
        scope: Object.freeze({ item_ids: worker.item_ids, write_scopes: worker.write_scopes }),
        authority: "external_user_or_project_authority_only",
        non_authority: "does_not_grant_project_authority",
        non_goals: Object.freeze(["release", "deployment", "publication", "project_authority_change"]),
        acceptance: "coordinator_verifies_against_candidate",
        stop_conditions: Object.freeze(["scope_or_authority_conflict", "isolation_receipt_missing", "unexpected_owned_state"]),
        validation: "run_assigned_validation_and_report_actual_result",
        isolation_effects: "receipt_bound_git_worktree_before_mutation",
        evidence: "return_bounded_evidence_only",
        return: "return_to_seat_0_using_required_fields",
        requested_model: recommendation.model,
        requested_reasoning_raw: recommendation.reasoning,
        fallback: "native_fallback_without_expanded_authority"
      })
    }))
  });
}

function buildContracts(classification, recommendation) {
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
  const ruleSelection = selectRuleDelta({
    immediate_intent: classification.immediate_intent,
    effects: classification.effects,
    rules: input.rules ?? [],
    context_ledger: input.context_ledger ?? {}
  });
  const baseTopology = input.work_items?.length ? buildWorkerTopology({
    work_items: input.work_items,
    maximum_workers: input.maximum_workers ?? Number.MAX_SAFE_INTEGER
  }) : null;
  const recommendation = recommendLowestReliableModel({
    complexity: input.complexity ?? "routine",
    adversarial: input.adversarial ?? false
  });
  const topology = assignWorkerModels(baseTopology, recommendation);
  const decision = seat0Decision(classification);
  const contracts = buildContracts(classification, recommendation);
  const predecessorDigest = input.predecessor_digest ?? null;
  if (predecessorDigest !== null && !/^sha256:[a-f0-9]{64}$/u.test(predecessorDigest)) fail("predecessor_digest must be a sha256 digest or null");
  const bundle = {
    schema_version: ORCHESTRATION_BUNDLE_SCHEMA_VERSION,
    bundle_type: "jit_orchestration",
    release_identity: releaseIdentity,
    project_identity: projectIdentity,
    predecessor_digest: predecessorDigest,
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

function validateTopology(topology, recommendation) {
  if (!isPlainObject(topology)) fail("bundle topology must be an object");
  assertExactObjectKeys(topology, TOPOLOGY_FIELDS, "bundle topology");
  assertExactObjectKeys(topology.coordinator, TOPOLOGY_COORDINATOR_FIELDS, "bundle topology coordinator");
  if (!isPlainObject(topology.coordinator) || topology.coordinator.seat !== 0 || topology.coordinator.label !== "Seat 0") {
    fail("bundle topology must identify Seat 0 as coordinator");
  }
  if (!Number.isInteger(topology.worker_count) || topology.worker_count < 1 ||
    !Number.isInteger(topology.maximum_useful_disjoint_workers) || topology.maximum_useful_disjoint_workers < topology.worker_count ||
    topology.seat0_included_in_worker_count !== false || !Array.isArray(topology.workers) || topology.worker_count !== topology.workers.length) {
    fail("bundle topology incorrectly counts Seat 0");
  }
  const seenWorkerScopes = [];
  topology.workers.forEach((worker, index) => {
    const seat = index + 1;
    assertExactObjectKeys(worker, TOPOLOGY_WORKER_FIELDS, "bundle topology worker");
    if (!isPlainObject(worker) || worker.seat !== seat || worker.label !== `Seat ${seat}` ||
      !Array.isArray(worker.item_ids) || !worker.item_ids.length || !Array.isArray(worker.write_scopes) || !worker.write_scopes.length) {
      fail("bundle topology workers must be contiguous numbered Seats 1..N");
    }
    const itemIds = [...new Set(worker.item_ids.map((id) => safeIdentifier(id, "bundle topology worker item id")))].sort();
    if (!equalJson(itemIds, worker.item_ids)) fail("bundle topology worker item_ids must be sorted and unique");
    if (!Array.isArray(worker.assignment_ids) || !equalJson(worker.assignment_ids, worker.item_ids)) {
      fail("bundle topology worker assignment_ids must match item_ids");
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
    validateWorkerPromptEnvelope(worker.prompt_envelope, worker, recommendation);
  });
}

function validateWorkerPromptEnvelope(envelope, worker, recommendation) {
  if (!isPlainObject(envelope)) fail("bundle worker prompt envelope must be an object");
  assertExactObjectKeys(envelope, WORKER_PROMPT_ENVELOPE_FIELDS, "bundle worker prompt envelope");
  if (envelope.schema_version !== 1 || !isPlainObject(envelope.scope) ||
    !equalJson(envelope.scope.item_ids, worker.item_ids) || !equalJson(envelope.scope.write_scopes, worker.write_scopes) ||
    envelope.authority !== "external_user_or_project_authority_only" ||
    envelope.non_authority !== "does_not_grant_project_authority" ||
    !equalJson(envelope.non_goals, ["release", "deployment", "publication", "project_authority_change"]) ||
    envelope.acceptance !== "coordinator_verifies_against_candidate" ||
    !equalJson(envelope.stop_conditions, ["scope_or_authority_conflict", "isolation_receipt_missing", "unexpected_owned_state"]) ||
    envelope.validation !== "run_assigned_validation_and_report_actual_result" ||
    envelope.isolation_effects !== "receipt_bound_git_worktree_before_mutation" ||
    envelope.evidence !== "return_bounded_evidence_only" ||
    envelope.return !== "return_to_seat_0_using_required_fields" ||
    envelope.requested_model !== recommendation.model || envelope.requested_reasoning_raw !== recommendation.reasoning ||
    envelope.fallback !== "native_fallback_without_expanded_authority") {
    fail("bundle worker prompt envelope is invalid");
  }
}

function validateSeat0Decision(decision, classification) {
  if (!isPlainObject(decision) || decision.seat !== 0 || decision.decision !== classification.classification ||
    !Array.isArray(decision.reasons) || !decision.reasons.length) {
    fail("bundle Seat 0 decision is invalid");
  }
  assertExactObjectKeys(decision, SEAT0_DECISION_FIELDS, "bundle Seat 0 decision");
  decision.reasons.forEach((reason) => safeIdentifier(reason, "bundle Seat 0 reason"));
  if (!equalJson(decision.reasons, decisionReasons(classification))) {
    fail("bundle Seat 0 reasons do not match the classifier");
  }
}

function validateModelRecommendation(recommendation) {
  if (!isPlainObject(recommendation)) fail("bundle model_recommendation must be an object");
  assertExactObjectKeys(recommendation, MODEL_RECOMMENDATION_FIELDS, "bundle model_recommendation");
  const model = safeIdentifier(recommendation.model, "bundle recommended model");
  const reasoning = safeIdentifier(recommendation.reasoning, "bundle recommended reasoning");
  const supported = (model === "gpt-5.6-luna" && reasoning === "low") ||
    (model === "gpt-5.6-terra" && reasoning === "high") ||
    (model === "gpt-5.6-sol" && reasoning === "high");
  if (!supported || recommendation.rationale !== "lowest known recommendation for the declared reasoning class") {
    fail("bundle model recommendation is not a supported composer decision");
  }
  if (recommendation.actual_model !== UNVERIFIED || recommendation.actual_reasoning_raw !== UNVERIFIED) {
    fail("bundle model recommendation actual evidence must be Unverified");
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

function validateContracts(contracts, classification, recommendation) {
  if (!isPlainObject(contracts) || !isPlainObject(contracts.authority) ||
    !isPlainObject(contracts.isolation) ||
    !isPlainObject(contracts.validation) || !isPlainObject(contracts.return) ||
    !isPlainObject(contracts.fallback)) {
    fail("bundle orchestration contracts are invalid");
  }
  assertExactObjectKeys(contracts, CONTRACT_FIELDS, "bundle orchestration contracts");
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
  if (!isPlainObject(bundle) || bundle.schema_version !== ORCHESTRATION_BUNDLE_SCHEMA_VERSION || bundle.bundle_type !== "jit_orchestration") {
    fail("unsupported orchestration bundle");
  }
  assertExactObjectKeys(bundle, BUNDLE_FIELDS, "bundle");
  const immediateIntent = safeIdentifier(bundle.immediate_intent, "bundle immediate_intent");
  const releaseIdentity = normalizeReleaseIdentity(bundle.release_identity);
  if (!equalJson(releaseIdentity, bundle.release_identity)) fail("bundle release_identity must be canonical");
  const projectIdentity = normalizeProjectIdentity(bundle.project_identity, immediateIntent);
  if (!equalJson(projectIdentity, bundle.project_identity)) fail("bundle project_identity must be canonical");
  const predecessorDigest = bundle.predecessor_digest;
  if (predecessorDigest !== null && (typeof predecessorDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(predecessorDigest))) {
    fail("bundle predecessor_digest is invalid");
  }
  validateClassificationRecord(bundle.classification, immediateIntent);
  validateSeat0Decision(bundle.seat0_decision, bundle.classification);
  validateRecomputedClassification(bundle.classification);
  if (bundle.bundle_digest !== bundleDigest(bundle)) fail("bundle digest is invalid");
  validateRuleSelection(bundle.rule_selection, immediateIntent);
  validateModelRecommendation(bundle.model_recommendation);
  if (bundle.topology) validateTopology(bundle.topology, bundle.model_recommendation);
  validateContracts(bundle.contracts, bundle.classification, bundle.model_recommendation);
  validateFallback(bundle.native_fallback, bundle.model_recommendation);
  if (!equalJson(bundle.native_fallback, bundle.contracts.fallback)) fail("bundle fallback records must match");
  return true;
}

export const verifyOrchestrationBundle = validateOrchestrationBundle;
