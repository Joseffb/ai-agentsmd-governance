import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_ORCHESTRATION_EFFECTS,
  FIVE_MINUTES_MS,
  ORCHESTRATION_BUNDLE_SCHEMA_VERSION,
  ORCHESTRATION_COMPOSER_VERSION,
  buildOrchestrationBundle,
  buildWorkerTopology,
  bundleDigest,
  canonicalJson,
  classifyImmediateIntent,
  recommendLowestReliableModel,
  selectRuleDelta,
  validateOrchestrationBundle
} from "../lib/orchestration.mjs";
import {
  CANONICAL_ORCHESTRATION_EFFECTS as PLUGIN_CANONICAL_ORCHESTRATION_EFFECTS
} from "../plugins/jit-orchestration-governor/scripts/jit-orchestration-governor.mjs";

const DIGEST_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("published schema exposes explicit v2-v5 compatibility and the Spark gate contract", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repository, "governance", "schemas", "orchestration-bundle.schema.json"), "utf8"));
  assert.equal(ORCHESTRATION_BUNDLE_SCHEMA_VERSION, 5);
  assert.equal(ORCHESTRATION_COMPOSER_VERSION, "1.3.0");
  assert.deepEqual(schema.properties.schema_version.enum, [2, 3, 4, ORCHESTRATION_BUNDLE_SCHEMA_VERSION]);
  assert.deepEqual(schema.oneOf, [{ $ref: "#/$defs/v2Bundle" }, { $ref: "#/$defs/v3Bundle" }, { $ref: "#/$defs/v4Bundle" }, { $ref: "#/$defs/v5Bundle" }]);
  assert.equal(schema.$defs.v2Bundle.properties.release_identity.properties.composer_version.const, "1.0.0");
  assert.equal(schema.$defs.v3Bundle.allOf[0].properties.release_identity.properties.composer_version.const, "1.1.0");
  assert.equal(schema.$defs.v4Bundle.allOf[0].properties.release_identity.properties.composer_version.const, "1.2.0");
  assert.equal(schema.$defs.v5Bundle.properties.release_identity.properties.composer_version.const, ORCHESTRATION_COMPOSER_VERSION);
  for (const field of [
    "release_identity",
    "project_identity",
    "seat0_decision",
    "rule_selection",
    "contracts",
    "predecessor_digest",
    "bundle_digest"
  ]) {
    assert.equal(schema.required.includes(field), true, field);
  }
  assert.deepEqual(schema.properties.contracts.required, ["authority", "isolation", "validation", "return", "fallback"]);
  assert.deepEqual(schema.properties.classification.properties.effects.items.enum, CANONICAL_ORCHESTRATION_EFFECTS);
  assert.deepEqual(PLUGIN_CANONICAL_ORCHESTRATION_EFFECTS, CANONICAL_ORCHESTRATION_EFFECTS);
  assert.equal(schema.properties.contracts.properties.authority.properties.bundle_grants_project_authority.const, false);
  assert.equal(schema.properties.contracts.properties.authority.properties.digest_proves.const, "consistency_not_project_authority");
  assert.equal(schema.properties.topology.properties.workers.items.properties.actual_model.const, "Unverified");
  assert.equal(schema.properties.topology.properties.workers.items.required.includes("prompt_envelope"), true);
  assert.equal(schema.$defs.v4Bundle.allOf[1].then.properties.topology.required.includes("execution_class"), true);
  assert.equal(schema.$defs.v4Bundle.allOf[1].then.properties.topology.required.includes("launch_stages"), true);
  assert.equal(schema.properties.topology.properties.decomposed_items.items.properties.depends_on.maxItems > 0, true);
  assert.equal(schema.properties.topology.properties.decomposed_items.items.properties.expected_artifact.minLength > 0, true);
  assert.equal(schema.properties.topology.properties.decomposed_items.items.properties.shared_resources.maxItems > 0, true);
  assert.equal(schema.properties.contracts.properties.lifecycle.properties.final_validation.const, "planned_seat_0_authoritative_against_integrated_candidate");
  assert.equal(schema.$defs.workerPromptEnvelope.properties.non_authority.const, "does_not_grant_project_authority");
  assert.equal(schema.properties.model_recommendation.properties.spark_gate.$ref, "#/$defs/sparkGate");
  assert.equal(schema.$defs.v5Bundle.properties.model_recommendation.required.includes("spark_gate"), true);
  assert.equal(schema.$defs.sparkGate.properties.actual_availability.const, "Unverified");
  assert.equal(schema.additionalProperties, false);
});

test("Seat 0 permits only one fully evidenced low-risk source correction at the five-minute boundary", () => {
  const atomicCorrection = {
    immediate_intent: "triage",
    estimated_duration_ms: FIVE_MINUTES_MS,
    explicitly_atomic: true,
    low_risk: true,
    remedy_known: true,
    delegation_overhead_dominates: true,
    effects: ["source_mutation"],
    source_mutation_surfaces: ["lib/fix.mjs"]
  };
  assert.equal(classifyImmediateIntent(atomicCorrection).classification, "seat0_atomic_allowed");
  assert.equal(classifyImmediateIntent({ ...atomicCorrection, estimated_duration_ms: FIVE_MINUTES_MS + 1 }).classification, "worker_required");
  assert.equal(classifyImmediateIntent({ ...atomicCorrection, seat0_prohibited: true }).classification, "worker_required");
  assert.equal(classifyImmediateIntent({ ...atomicCorrection, remedy_known: false }).classification, "worker_required");
  assert.equal(classifyImmediateIntent({ ...atomicCorrection, worker_owned_slice: true }).classification, "worker_required");
  assert.equal(classifyImmediateIntent({ ...atomicCorrection, source_mutation_surfaces: ["lib/a.mjs", "lib/b.mjs"] }).classification, "worker_required");
  for (const effect of ["contract_change", "security", "privacy", "dependency", "migration", "build", "test", "browser"]) {
    assert.equal(classifyImmediateIntent({ ...atomicCorrection, effects: [effect] }).classification, "worker_required", effect);
  }
  for (const effect of ["deployment", "database_mutation", "release"]) {
    assert.equal(classifyImmediateIntent({ ...atomicCorrection, effects: [effect] }).classification, "project_authority_required", effect);
  }
});

test("the closed effect vocabulary rejects unknown aliases and case variants", () => {
  for (const effect of ["db", "database", "deploy", "contract", "Publication"]) {
    assert.throws(
      () => classifyImmediateIntent({ immediate_intent: "implementation", estimated_duration_ms: 1, effects: [effect] }),
      /canonical closed vocabulary/,
      effect
    );
    assert.throws(
      () => buildOrchestrationBundle({ immediate_intent: "implementation", estimated_duration_ms: 1, effects: [effect] }),
      /canonical closed vocabulary/,
      effect
    );
  }
  for (const effect of CANONICAL_ORCHESTRATION_EFFECTS) {
    assert.doesNotThrow(
      () => classifyImmediateIntent({ immediate_intent: "implementation", estimated_duration_ms: 1, effects: [effect] }),
      effect
    );
  }
});

test("project authority is granted only by boolean true", () => {
  const authorityEffect = {
    immediate_intent: "deploy",
    estimated_duration_ms: 1,
    effects: ["deployment"]
  };
  assert.equal(classifyImmediateIntent(authorityEffect).classification, "project_authority_required");
  assert.equal(classifyImmediateIntent({ ...authorityEffect, project_authority_granted: true }).classification, "worker_required");
  for (const invalidGrant of ["true", "false", 1, 0, null]) {
    assert.throws(
      () => classifyImmediateIntent({ ...authorityEffect, project_authority_granted: invalidGrant }),
      /project_authority_granted must be a boolean/
    );
  }
});

test("Seat 0-owned non-implementation activities remain representable", () => {
  for (const activity of ["integration", "coordination", "decision", "communication", "acceptance"]) {
    assert.equal(classifyImmediateIntent({ immediate_intent: activity, estimated_duration_ms: 0, seat0_activity: activity }).classification, "seat0_owned");
  }
  assert.equal(classifyImmediateIntent({ immediate_intent: "integrate", estimated_duration_ms: 1, seat0_activity: "integration", effects: ["source_mutation"], source_mutation_surfaces: ["lib/fix.mjs"] }).classification, "worker_required");
  assert.equal(classifyImmediateIntent({ immediate_intent: "release", estimated_duration_ms: 1, effects: ["release"] }).classification, "project_authority_required");
  assert.equal(classifyImmediateIntent({ immediate_intent: "coordinate", estimated_duration_ms: 0, seat0_coordination: true }).classification, "seat0_owned");
});

test("rule deltas are immediate-only and the ledger grows monotonically", () => {
  const result = selectRuleDelta({
    immediate_intent: "implementation",
    effects: ["filesystem_mutation"],
    context_ledger: { retained: { digest: DIGEST_A, estimated_tokens: 7 } },
    rules: [
      { id: "base", digest: DIGEST_A, estimated_tokens: 2 },
      { id: "write", digest: DIGEST_B, estimated_tokens: 3, immediate_intents: ["implementation"], effects: ["filesystem_mutation"] },
      { id: "deploy", digest: DIGEST_A, estimated_tokens: 11, immediate_intents: ["deployment"] }
    ]
  });
  assert.deepEqual(result.required_rule_ids, ["base", "write"]);
  assert.deepEqual(result.rule_delta.map((rule) => rule.id), ["base", "write"]);
  assert.deepEqual(result.rule_delta.map((rule) => rule.order), [1, 2]);
  assert.deepEqual(Object.keys(result.context_ledger), ["base", "retained", "write"]);
  assert.equal(result.accumulated_policy_tokens, 12);
});

test("rule replacement retains prior content in the monotonic ledger", () => {
  const result = selectRuleDelta({
    immediate_intent: "implementation",
    context_ledger: { base: { digest: DIGEST_A, estimated_tokens: 7 } },
    rules: [{ id: "base", digest: DIGEST_B, estimated_tokens: 3 }]
  });
  assert.deepEqual(result.rule_delta.map((rule) => rule.id), ["base"]);
  assert.deepEqual(result.context_ledger.base, {
    digest: DIGEST_B,
    estimated_tokens: 3,
    prior_versions: [{ digest: DIGEST_A, estimated_tokens: 7 }]
  });
  assert.equal(result.accumulated_policy_tokens, 10);
});

test("topology maximizes disjoint worker units and excludes Seat 0", () => {
  const topology = buildWorkerTopology({
    decomposition_complete: true,
    coherent_chain: false,
    work_items: [
      { id: "schema", write_scopes: ["governance/schemas/a.json"] },
      { id: "library", write_scopes: ["lib/orchestration.mjs"] },
      { id: "library-test", write_scopes: ["lib/orchestration.mjs/fixture"] }
    ]
  });
  assert.equal(topology.maximum_useful_disjoint_workers, 2);
  assert.equal(topology.worker_count, 2);
  assert.equal(topology.capacity_limit, "Unverified");
  assert.equal(topology.capacity_evidence, "Unverified");
  assert.throws(
    () => buildWorkerTopology({ maximum_workers: Number.MAX_SAFE_INTEGER, work_items: [{ id: "alpha", write_scopes: ["lib/alpha.mjs"] }] }),
    /bounded positive integer/
  );
  assert.deepEqual(topology.queued_item_ids, []);
  assert.equal(topology.seat0_included_in_worker_count, false);
  assert.deepEqual(topology.coordinator, { seat: 0, label: "Seat 0" });
  assert.deepEqual(topology.workers.map(({ seat, label }) => ({ seat, label })), [
    { seat: 1, label: "Seat 1" },
    { seat: 2, label: "Seat 2" }
  ]);
  assert.deepEqual(topology.workers.find((worker) => worker.item_ids.includes("library")).item_ids, ["library", "library-test"]);
});

test("capacity reserves only disjoint worker lanes and queues excess work without overlap", () => {
  const topology = buildWorkerTopology({
    maximum_workers: 2,
    decomposition_complete: true,
    coherent_chain: false,
    work_items: [
      { id: "alpha", write_scopes: ["lib/alpha.mjs"] },
      { id: "beta", write_scopes: ["lib/beta.mjs"] },
      { id: "gamma", write_scopes: ["lib/gamma.mjs"] }
    ]
  });
  assert.equal(topology.maximum_useful_disjoint_workers, 3);
  assert.equal(topology.capacity_limit, 2);
  assert.equal(topology.worker_count, 2);
  assert.deepEqual(topology.workers.map((worker) => worker.item_ids), [["alpha"], ["beta"]]);
  assert.deepEqual(topology.queued_item_ids, ["gamma"]);
  assert.deepEqual(topology.queued_write_scopes, ["lib/gamma.mjs"]);
  assert.equal(topology.capacity_evidence, "declared_by_caller");
});

test("omitted capacity is explicitly Unverified and scope aliases cannot create disjoint lanes", () => {
  const topology = buildWorkerTopology({
    work_items: [{ id: "alpha", write_scopes: ["lib/alpha.mjs"] }]
  });
  assert.equal(topology.capacity_limit, "Unverified");
  assert.equal(topology.capacity_evidence, "Unverified");
  for (const scope of ["./lib/alpha.mjs", "lib//alpha.mjs", "lib/./alpha.mjs", "lib/alpha.mjs/"]) {
    assert.throws(
      () => buildWorkerTopology({ work_items: [{ id: "alpha", write_scopes: [scope] }] }),
      /safe repository-relative path/,
      scope
    );
  }
});

test("dependency-aware topology derives deterministic parallel, pipelined, serial, and exploratory execution classes", () => {
  const common = { decomposition_complete: true, coherent_chain: false };
  const parallel = buildWorkerTopology({
    ...common,
    work_items: [
      { id: "alpha", write_scopes: ["lib/alpha.mjs"], expected_artifact: "alpha.patch" },
      { id: "beta", write_scopes: ["lib/beta.mjs"], expected_artifact: "beta.patch" }
    ]
  });
  assert.equal(parallel.execution_class, "PARALLEL");
  assert.deepEqual(parallel.launch_stages.map((stage) => stage.item_ids), [["alpha", "beta"]]);

  const pipelined = buildWorkerTopology({
    ...common,
    work_items: [
      { id: "prepare", write_scopes: ["lib/prepare.mjs"], expected_artifact: "prepare.patch" },
      { id: "implement", write_scopes: ["lib/implement.mjs"], depends_on: ["prepare"], expected_artifact: "implement.patch" },
      { id: "verify", write_scopes: ["test/verify.mjs"], depends_on: ["implement"], expected_artifact: "verify.txt" }
    ]
  });
  assert.equal(pipelined.execution_class, "PIPELINED");
  assert.deepEqual(pipelined.launch_stages.map((stage) => stage.item_ids), [["prepare"], ["implement"], ["verify"]]);
  assert.deepEqual(pipelined.integration_order, ["prepare", "implement", "verify"]);

  const serial = buildWorkerTopology({
    decomposition_complete: true,
    coherent_chain: true,
    work_items: [
      { id: "one", write_scopes: ["lib/one.mjs"], expected_artifact: "one.patch" },
      { id: "two", write_scopes: ["lib/two.mjs"], depends_on: ["one"], expected_artifact: "two.patch" }
    ]
  });
  assert.equal(serial.execution_class, "SERIAL");
  assert.equal(serial.worker_count, 1);
  assert.deepEqual(serial.launch_stages.map((stage) => stage.item_ids), [["one", "two"]]);

  const oneEffectiveUnit = buildWorkerTopology({
    ...common,
    work_items: [{ id: "only", write_scopes: ["lib/only.mjs"], expected_artifact: "only.patch" }]
  });
  assert.equal(oneEffectiveUnit.execution_class, "SERIAL");
  assert.equal(oneEffectiveUnit.worker_count, 1);

  const exploratory = buildWorkerTopology({
    decomposition_complete: false,
    coherent_chain: false,
    work_items: [{ id: "unknown", write_scopes: ["lib/unknown.mjs"], expected_artifact: "unknown.patch" }]
  });
  assert.equal(exploratory.execution_class, "EXPLORATORY");
  assert.equal(exploratory.worker_count, 1);
  assert.equal(exploratory.maximum_useful_disjoint_workers, 1);
  assert.deepEqual(exploratory.queued_item_ids, ["unknown"]);
  assert.deepEqual(exploratory.queued_write_scopes, ["lib/unknown.mjs"]);
  assert.deepEqual(exploratory.workers, [{
    seat: 1,
    label: "Seat 1",
    worker_kind: "bounded_discovery",
    item_ids: [],
    write_scopes: []
  }]);
  assert.deepEqual(exploratory.launch_stages.map((stage) => stage.item_ids), [[], ["unknown"]]);

  const exploratoryBundle = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"],
    decomposition_complete: false,
    coherent_chain: false,
    work_items: [{ id: "unknown", write_scopes: ["lib/unknown.mjs"], expected_artifact: "unknown.patch" }]
  });
  const discoveryWorker = exploratoryBundle.topology.workers[0];
  assert.equal(discoveryWorker.worker_kind, "bounded_discovery");
  assert.deepEqual(discoveryWorker.assignment_ids, ["bounded-discovery"]);
  assert.deepEqual(discoveryWorker.item_ids, []);
  assert.deepEqual(discoveryWorker.write_scopes, []);
  assert.equal(discoveryWorker.prompt_envelope.worker_kind, "bounded_discovery");
  assert.deepEqual(discoveryWorker.prompt_envelope.scope, { item_ids: [], write_scopes: [] });
  assert.equal(discoveryWorker.prompt_envelope.non_goals.includes("implementation"), true);
  assert.equal(discoveryWorker.prompt_envelope.validation, "return_bounded_decomposition_facts_only");
  assert.equal(discoveryWorker.prompt_envelope.isolation_effects, "read_only_discovery_no_project_mutation");
  assert.equal(validateOrchestrationBundle(exploratoryBundle), true);
});

test("dependency metadata rejects unsafe graphs and prevents resource-conflicting concurrent launches", () => {
  const complete = { decomposition_complete: true, coherent_chain: false };
  for (const work_items of [
    [
      { id: "alpha", write_scopes: ["lib/a.mjs"], depends_on: ["beta"], expected_artifact: "a.patch" },
      { id: "beta", write_scopes: ["lib/b.mjs"], depends_on: ["alpha"], expected_artifact: "b.patch" }
    ],
    [{ id: "alpha", write_scopes: ["lib/a.mjs"], depends_on: ["missing"], expected_artifact: "a.patch" }],
    [{ id: "alpha", write_scopes: ["lib/a.mjs"], depends_on: ["alpha"], expected_artifact: "a.patch" }]
  ]) {
    assert.throws(() => buildWorkerTopology({ ...complete, work_items }), /depend|cycle|graph/i);
  }
  const declaredCoherentChain = buildWorkerTopology({ ...complete, coherent_chain: true, work_items: [
    { id: "alpha", write_scopes: ["lib/a.mjs"], expected_artifact: "a.patch" },
    { id: "beta", write_scopes: ["lib/b.mjs"], expected_artifact: "b.patch" }
  ] });
  assert.equal(declaredCoherentChain.execution_class, "SERIAL");
  assert.equal(declaredCoherentChain.worker_count, 1);
  assert.deepEqual(declaredCoherentChain.launch_stages.map((stage) => stage.item_ids), [["alpha", "beta"]]);

  const overlap = buildWorkerTopology({ ...complete, work_items: [
    { id: "alpha", write_scopes: ["lib/shared.mjs"], expected_artifact: "a.patch" },
    { id: "beta", write_scopes: ["lib/shared.mjs"], expected_artifact: "b.patch" }
  ] });
  assert.notEqual(overlap.execution_class, "PARALLEL");

  const sharedResource = buildWorkerTopology({ ...complete, work_items: [
    { id: "alpha", write_scopes: ["lib/a.mjs"], shared_resources: ["contract:public-api"], expected_artifact: "a.patch" },
    { id: "beta", write_scopes: ["lib/b.mjs"], shared_resources: ["contract:public-api"], expected_artifact: "b.patch" }
  ] });
  assert.equal(sharedResource.execution_class, "SERIAL");
  assert.equal(sharedResource.worker_count, 1);
  assert.equal(sharedResource.maximum_useful_disjoint_workers, 1);
});

test("topology plan ordering is digest-bound, metrics-free, and tamper-rejected", () => {
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation", estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"], decomposition_complete: true, coherent_chain: false,
    work_items: [
      { id: "first", write_scopes: ["lib/first.mjs"], expected_artifact: "first.patch" },
      { id: "second", write_scopes: ["lib/second.mjs"], depends_on: ["first"], expected_artifact: "second.patch" }
    ]
  });
  assert.equal(bundle.topology.execution_class, "PIPELINED");
  const metricsIgnored = buildOrchestrationBundle({
    immediate_intent: "implementation", estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"], decomposition_complete: true, coherent_chain: false,
    metrics: { historically_fast: true, preferred_parallelism: 99 },
    work_items: [{ id: "one", write_scopes: ["lib/one.mjs"], expected_artifact: "one.patch" }]
  });
  const sameWithoutMetrics = buildOrchestrationBundle({
    immediate_intent: "implementation", estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"], decomposition_complete: true, coherent_chain: false,
    work_items: [{ id: "one", write_scopes: ["lib/one.mjs"], expected_artifact: "one.patch" }]
  });
  assert.equal(metricsIgnored.bundle_digest, sameWithoutMetrics.bundle_digest);
  assert.equal(Object.hasOwn(metricsIgnored, "metrics"), false);
  const tampered = structuredClone(bundle);
  tampered.topology.launch_stages.reverse();
  tampered.topology.integration_order.reverse();
  tampered.bundle_digest = bundleDigest(tampered);
  assert.throws(() => validateOrchestrationBundle(tampered), /digest|topolog|order/i);
});

test("non-worker bundles do not emit future parallel lifecycle stages", () => {
  const seatOwned = buildOrchestrationBundle({
    immediate_intent: "coordination", estimated_duration_ms: 0, seat0_activity: "coordination"
  });
  const authorityRequired = buildOrchestrationBundle({
    immediate_intent: "deploy", estimated_duration_ms: 1, effects: ["deployment"]
  });
  for (const bundle of [seatOwned, authorityRequired]) {
    assert.equal(Object.hasOwn(bundle.contracts, "lifecycle"), false);
    assert.equal(Object.hasOwn(bundle, "topology"), false);
    assert.equal(bundle.contracts.validation.evidence, "Unverified");
    assert.equal(validateOrchestrationBundle(bundle), true);
  }
  assert.throws(
    () => buildOrchestrationBundle({
      immediate_intent: "coordination", estimated_duration_ms: 0, seat0_activity: "coordination",
      work_items: [{ id: "future", write_scopes: ["lib/future.mjs"] }]
    }),
    /only for immediate worker-required work/
  );
});

test("decomposed inventory is the exact worker-plus-queue partition", () => {
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation", estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"], decomposition_complete: true, coherent_chain: false, maximum_workers: 1,
    work_items: [
      { id: "alpha", write_scopes: ["lib/alpha.mjs"] },
      { id: "beta", write_scopes: ["lib/beta.mjs"] }
    ]
  });
  assert.deepEqual(bundle.topology.decomposed_items.map((item) => item.id), ["alpha", "beta"]);
  for (const tamper of [
    (candidate) => { candidate.topology.queued_item_ids = ["alpha"]; },
    (candidate) => { candidate.topology.queued_write_scopes = ["lib/alpha.mjs"]; },
    (candidate) => { candidate.topology.decomposed_items[1].id = "alpha"; },
    (candidate) => { candidate.topology.workers[0].item_ids = ["beta"]; candidate.topology.workers[0].assignment_ids = ["beta"]; }
  ]) {
    const tampered = structuredClone(bundle);
    tamper(tampered);
    tampered.bundle_digest = bundleDigest(tampered);
    assert.throws(() => validateOrchestrationBundle(tampered), /canonical|exact disjoint partition|must be sorted|prompt envelope/);
  }
});

test("bundle records the explicit RC-3 identity, decision, worker, and execution contracts", () => {
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["filesystem_mutation"],
    predecessor_digest: DIGEST_A,
    rules: [{ id: "base", digest: DIGEST_B, estimated_tokens: 2 }],
    decomposition_complete: true,
    coherent_chain: false,
    work_items: [
      { id: "library", write_scopes: ["lib/orchestration.mjs"] },
      { id: "schema", write_scopes: ["governance/schemas/orchestration-bundle.schema.json"] }
    ],
    release_identity: {
      composer_version: ORCHESTRATION_COMPOSER_VERSION,
      checkout_system_version: "2.2.2",
      checkout_system_version_evidence: "package_json",
      installed_system_version: "2.2.1",
      installed_release_id: "v1-aaaaaaaaaaaaaaaa",
      installed_release_evidence: "immutable_release_json",
      active_host_interception: "Unverified"
    },
    project_identity: {
      project: "fixture",
      project_root: "/tmp/repository/apps/fixture",
      repository_root: "/tmp/repository",
      subtree: "apps/fixture",
      immediate_intent: "implementation"
    },
    complexity: "complex"
  });
  assert.equal(bundle.schema_version, ORCHESTRATION_BUNDLE_SCHEMA_VERSION);
  assert.equal(bundle.release_identity.composer_version, ORCHESTRATION_COMPOSER_VERSION);
  assert.equal(bundle.release_identity.checkout_system_version, "2.2.2");
  assert.equal(bundle.release_identity.installed_release_id, "v1-aaaaaaaaaaaaaaaa");
  assert.equal(bundle.release_identity.active_host_interception, "Unverified");
  assert.deepEqual(bundle.project_identity, {
    project: "fixture",
    project_root: "/tmp/repository/apps/fixture",
    repository_root: "/tmp/repository",
    subtree: "apps/fixture",
    immediate_intent: "implementation"
  });
  assert.equal(bundle.classification.classification, "worker_required");
  assert.equal(bundle.seat0_decision.seat, 0);
  assert.equal(bundle.seat0_decision.decision, "worker_required");
  assert.equal(bundle.seat0_decision.reasons.includes("duration_exceeds_five_minutes"), true);
  assert.equal(bundle.predecessor_digest, DIGEST_A);
  assert.equal(bundle.native_fallback.actual_model, "Unverified");
  assert.equal(bundle.model_recommendation.model, "gpt-5.6-terra");
  assert.equal(bundle.topology.worker_count, 2);
  assert.equal(bundle.topology.capacity_limit, "Unverified");
  assert.equal(bundle.topology.capacity_evidence, "Unverified");
  assert.deepEqual(bundle.topology.queued_item_ids, []);
  for (const [index, worker] of bundle.topology.workers.entries()) {
    assert.equal(worker.seat, index + 1);
    assert.deepEqual(worker.assignment_ids, worker.item_ids);
    assert.equal(worker.requested_model, "gpt-5.6-terra");
    assert.equal(worker.requested_reasoning_raw, "high");
    assert.equal(worker.actual_model, "Unverified");
    assert.equal(worker.actual_reasoning_raw, "Unverified");
    assert.deepEqual(worker.prompt_envelope.scope, { item_ids: worker.item_ids, write_scopes: worker.write_scopes });
    assert.equal(worker.prompt_envelope.non_authority, "does_not_grant_project_authority");
    assert.equal(worker.prompt_envelope.requested_model, "gpt-5.6-terra");
    assert.equal(worker.prompt_envelope.requested_reasoning_raw, "high");
  }
  assert.equal(bundle.contracts.isolation.mode, "receipt_bound_git_worktree_before_launch");
  assert.deepEqual(bundle.contracts.authority, {
    origin: "external_user_or_project_authority_only",
    bundle_grants_project_authority: false,
    digest_proves: "consistency_not_project_authority"
  });
  assert.equal(bundle.contracts.validation.coordinator_seat, 0);
  assert.deepEqual(bundle.contracts.lifecycle.stages, [
    "decompose",
    "derive_deterministic_topology",
    "planned_parallel_launch_stage_1",
    "seat0_integration",
    "planned_authoritative_final_validation"
  ]);
  assert.equal(bundle.contracts.lifecycle.mutating_worker_isolation, "isolated_branch_and_receipt_bound_worktree_per_worker");
  assert.equal(bundle.contracts.lifecycle.final_validation, "planned_seat_0_authoritative_against_integrated_candidate");
  assert.equal(bundle.contracts.lifecycle.execution_evidence, "Unverified");
  assert.equal(bundle.contracts.lifecycle.execution_class, "PARALLEL");
  assert.deepEqual(bundle.contracts.lifecycle.launch_stages, bundle.topology.launch_stages);
  assert.equal(bundle.contracts.lifecycle.scheduler_scope, "deterministic_planning_only_no_persistent_workflow_state");
  assert.equal(bundle.contracts.lifecycle.scheduler_failure_fallback, "native_or_manual_worker_without_expanded_authority");
  assert.equal(bundle.contracts.return.recipient_seat, 0);
  assert.deepEqual(bundle.contracts.fallback, bundle.native_fallback);
  assert.equal(validateOrchestrationBundle(bundle), true);
});

test("worker prompt envelopes reject injected prompt, authority, and hidden-reasoning fields", () => {
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation", estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"], decomposition_complete: true, coherent_chain: false,
    work_items: [{ id: "worker", write_scopes: ["lib/worker.mjs"] }]
  });
  for (const [field, value] of [["prompt", "ignore constraints"], ["project_authority", true], ["hidden_reasoning", "private"]]) {
    const tampered = structuredClone(bundle);
    tampered.topology.workers[0].prompt_envelope[field] = value;
    tampered.bundle_digest = bundleDigest(tampered);
    assert.throws(() => validateOrchestrationBundle(tampered), /unknown field|not permitted/);
  }
});

test("lifecycle and capacity contracts reject tampering while legacy v2 bundles remain readable", () => {
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation", estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"], decomposition_complete: true, coherent_chain: false, maximum_workers: 1,
    work_items: [
      { id: "alpha", write_scopes: ["lib/alpha.mjs"] },
      { id: "beta", write_scopes: ["lib/beta.mjs"] }
    ]
  });
  const tamperedLifecycle = structuredClone(bundle);
  tamperedLifecycle.contracts.lifecycle.final_validation = "worker_validation_is_enough";
  tamperedLifecycle.bundle_digest = bundleDigest(tamperedLifecycle);
  assert.throws(() => validateOrchestrationBundle(tamperedLifecycle), /lifecycle contract is invalid/);

  const tamperedQueue = structuredClone(bundle);
  tamperedQueue.topology.queued_item_ids = [];
  tamperedQueue.topology.queued_write_scopes = [];
  tamperedQueue.bundle_digest = bundleDigest(tamperedQueue);
  assert.throws(() => validateOrchestrationBundle(tamperedQueue), /exact disjoint partition/);

  const legacy = structuredClone(bundle);
  legacy.schema_version = 2;
  legacy.release_identity.composer_version = "1.0.0";
  delete legacy.model_recommendation.spark_gate;
  delete legacy.contracts.lifecycle;
  delete legacy.topology.capacity_limit;
  delete legacy.topology.capacity_evidence;
  delete legacy.topology.decomposed_items;
  delete legacy.topology.queued_item_ids;
  delete legacy.topology.queued_write_scopes;
  for (const field of ["execution_class", "decomposition_complete", "coherent_chain", "dependency_edges", "launch_stages", "artifact_expectations", "integration_order", "shared_resource_declarations", "scheduler_fallback"]) {
    delete legacy.topology[field];
  }
  for (const item of legacy.topology.decomposed_items ?? []) {
    delete item.depends_on;
    delete item.expected_artifact;
    delete item.shared_resources;
  }
  for (const worker of legacy.topology.workers) {
    delete worker.worker_kind;
    delete worker.prompt_envelope.worker_kind;
  }
  legacy.bundle_digest = bundleDigest(legacy);
  assert.equal(validateOrchestrationBundle(legacy), true);

  const v3 = structuredClone(bundle);
  v3.schema_version = 3;
  v3.release_identity.composer_version = "1.1.0";
  delete v3.model_recommendation.spark_gate;
  for (const field of ["execution_class", "launch_stages", "scheduler_scope", "scheduler_failure_fallback"]) delete v3.contracts.lifecycle[field];
  v3.contracts.lifecycle.stages = [
    "decompose",
    "reserve_disjoint_lanes_within_capacity",
    "isolate_mutating_workers",
    "planned_parallel_work_test_review",
    "seat0_integration",
    "planned_authoritative_final_validation"
  ];
  v3.contracts.lifecycle.parallel_phase = "planned_parallel_work_test_review";
  for (const field of ["execution_class", "decomposition_complete", "coherent_chain", "dependency_edges", "launch_stages", "artifact_expectations", "integration_order", "shared_resource_declarations", "scheduler_fallback"]) delete v3.topology[field];
  for (const item of v3.topology.decomposed_items) {
    delete item.depends_on;
    delete item.expected_artifact;
    delete item.shared_resources;
  }
  for (const worker of v3.topology.workers) {
    delete worker.worker_kind;
    delete worker.prompt_envelope.worker_kind;
  }
  v3.bundle_digest = bundleDigest(v3);
  assert.equal(validateOrchestrationBundle(v3), true);

  for (const [schemaVersion, composerVersion, source] of [[2, ORCHESTRATION_COMPOSER_VERSION, legacy], [3, "1.0.0", v3], [4, "1.1.0", bundle]]) {
    const mismatched = structuredClone(source);
    mismatched.schema_version = schemaVersion;
    mismatched.release_identity.composer_version = composerVersion;
    mismatched.bundle_digest = bundleDigest(mismatched);
    assert.throws(() => validateOrchestrationBundle(mismatched), /composer_version must be/);
  }
});

test("bundle integrity and privacy reject tampering, prompts, content, output, credentials, and hidden reasoning", () => {
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["filesystem_mutation"]
  });
  const tampered = structuredClone(bundle);
  tampered.seat0_decision.reasons = ["invented_reason"];
  tampered.bundle_digest = bundleDigest(tampered);
  assert.throws(() => validateOrchestrationBundle(tampered), /reasons do not match/);
  assert.throws(() => buildOrchestrationBundle({ immediate_intent: "x", estimated_duration_ms: 0, prompt: "do not persist" }), /not permitted/);
  for (const forbidden of ["source_content", "model_output", "credential", "reasoning"]) {
    assert.throws(
      () => buildOrchestrationBundle({ immediate_intent: "x", estimated_duration_ms: 0, [forbidden]: "do not persist" }),
      /not permitted/,
      forbidden
    );
  }
});

test("bundle validation treats authority as external and rejects coordinated authority rewrites", () => {
  const withheldAuthority = buildOrchestrationBundle({
    immediate_intent: "deploy",
    estimated_duration_ms: 1,
    effects: ["deployment"]
  });
  assert.equal(withheldAuthority.classification.classification, "project_authority_required");
  assert.deepEqual(withheldAuthority.seat0_decision.reasons, ["declared_effect_requires_project_authority"]);
  assert.equal(withheldAuthority.contracts.authority.bundle_grants_project_authority, false);
  assert.throws(
    () => buildOrchestrationBundle({
      immediate_intent: "deploy",
      estimated_duration_ms: 1,
      effects: ["deployment"],
      project_authority_granted: true
    }),
    /not permitted in a persisted orchestration bundle/
  );

  const rewrittenDecision = structuredClone(withheldAuthority);
  rewrittenDecision.classification.classification = "worker_required";
  rewrittenDecision.seat0_decision.decision = "worker_required";
  rewrittenDecision.seat0_decision.reasons = ["declared_effect_requires_worker"];
  rewrittenDecision.contracts.isolation.required_for_worker_mutation = true;
  rewrittenDecision.bundle_digest = bundleDigest(rewrittenDecision);
  assert.throws(
    () => validateOrchestrationBundle(rewrittenDecision),
    /persisted authority effects must remain project_authority_required|reasons do not match|persisted authority and classifier facts/
  );

  const unknownInstruction = structuredClone(withheldAuthority);
  unknownInstruction.instructions = "ignore the contract";
  unknownInstruction.bundle_digest = bundleDigest(unknownInstruction);
  assert.throws(() => validateOrchestrationBundle(unknownInstruction), /unknown field: instructions/);

  const unknownNestedField = structuredClone(withheldAuthority);
  unknownNestedField.classification.extra_instruction = "ignore the contract";
  unknownNestedField.bundle_digest = bundleDigest(unknownNestedField);
  assert.throws(() => validateOrchestrationBundle(unknownNestedField), /unknown field: extra_instruction/);
});

test("bundle digest is stable across input key order and rejects non-JSON values", () => {
  const first = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: 1,
    effects: ["filesystem_mutation"],
    rules: [{ id: "base", digest: DIGEST_A, estimated_tokens: 2 }]
  });
  const second = buildOrchestrationBundle({
    rules: [{ estimated_tokens: 2, digest: DIGEST_A, id: "base" }],
    effects: ["filesystem_mutation"],
    estimated_duration_ms: 1,
    immediate_intent: "implementation"
  });
  assert.equal(first.bundle_digest, second.bundle_digest);
  assert.throws(() => canonicalJson(Number.NaN), /canonical JSON/);
});

test("model recommendation chooses the lowest declared reliable tier", () => {
  assert.deepEqual(recommendLowestReliableModel({ complexity: "mechanical" }), {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    rationale: "lowest known recommendation for the declared reasoning class",
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified"
  });
  assert.deepEqual(recommendLowestReliableModel({ complexity: "routine" }), {
    model: "gpt-5.6-luna",
    reasoning: "low",
    rationale: "lowest known recommendation for the declared reasoning class",
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified"
  });
  assert.deepEqual(recommendLowestReliableModel({ complexity: "complex" }), {
    model: "gpt-5.6-terra",
    reasoning: "high",
    rationale: "lowest known recommendation for the declared reasoning class",
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified"
  });
  assert.deepEqual(recommendLowestReliableModel({ complexity: "adversarial" }), {
    model: "gpt-5.6-sol",
    reasoning: "high",
    rationale: "lowest known recommendation for the declared reasoning class",
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified"
  });
  assert.deepEqual(recommendLowestReliableModel({ complexity: "mechanical", adversarial: true }), {
    model: "gpt-5.6-sol",
    reasoning: "high",
    rationale: "lowest known recommendation for the declared reasoning class",
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified"
  });
  for (const nearMatch of ["Mechanical", "mechanical-low", "spark"]) {
    assert.throws(
      () => recommendLowestReliableModel({ complexity: nearMatch }),
      /complexity must be mechanical, routine, complex, or adversarial/,
      nearMatch
    );
  }
});

test("mechanical bundles propagate Spark requests through worker envelopes without fabricating runtime evidence", () => {
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation"],
    complexity: "mechanical",
    spark_eligibility: {
      work_kind: "mechanical_edit",
      requires_judgment: false,
      availability: "selectable"
    },
    decomposition_complete: true,
    coherent_chain: false,
    work_items: [{ id: "mechanical-worker", write_scopes: ["lib/mechanical.mjs"] }]
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(bundle.model_recommendation).filter(([key]) => key !== "spark_gate")),
    recommendLowestReliableModel({ complexity: "mechanical" })
  );
  assert.equal(bundle.native_fallback.requested_model, "gpt-5.3-codex-spark");
  assert.equal(bundle.native_fallback.requested_reasoning_raw, "low");
  assert.equal(bundle.native_fallback.actual_model, "Unverified");
  assert.equal(bundle.native_fallback.actual_reasoning_raw, "Unverified");
  assert.deepEqual(bundle.model_recommendation.spark_gate, {
    work_kind: "mechanical_edit",
    requires_judgment: false,
    availability: "selectable",
    actual_availability: "Unverified",
    worker_required: true,
    excluded_effects: []
  });
  for (const worker of bundle.topology.workers) {
    assert.equal(worker.requested_model, "gpt-5.3-codex-spark");
    assert.equal(worker.requested_reasoning_raw, "low");
    assert.equal(worker.prompt_envelope.requested_model, "gpt-5.3-codex-spark");
    assert.equal(worker.prompt_envelope.requested_reasoning_raw, "low");
    assert.equal(worker.actual_model, "Unverified");
    assert.equal(worker.actual_reasoning_raw, "Unverified");
  }
  assert.equal(validateOrchestrationBundle(bundle), true);

  for (const [path, value] of [
    [["model_recommendation", "actual_model"], "gpt-5.3-codex-spark"],
    [["model_recommendation", "actual_reasoning_raw"], "low"],
    [["topology", "workers", 0, "actual_model"], "gpt-5.3-codex-spark"],
    [["topology", "workers", 0, "actual_reasoning_raw"], "low"],
    [["native_fallback", "actual_model"], "gpt-5.3-codex-spark"],
    [["native_fallback", "actual_reasoning_raw"], "low"]
  ]) {
    const tampered = structuredClone(bundle);
    let target = tampered;
    for (const segment of path.slice(0, -1)) target = target[segment];
    target[path.at(-1)] = value;
    tampered.bundle_digest = bundleDigest(tampered);
    assert.throws(() => validateOrchestrationBundle(tampered), /actual.*Unverified|actual model and reasoning require authoritative runtime evidence|fallback contract is invalid/i);
  }
});

test("Spark selection and Terra-low fallback require proven eligibility", () => {
  const base = {
    immediate_intent: "implementation",
    estimated_duration_ms: FIVE_MINUTES_MS + 1,
    effects: ["source_mutation", "test"],
    complexity: "mechanical",
    decomposition_complete: true,
    coherent_chain: false,
    work_items: [{ id: "mechanical-worker", write_scopes: ["lib/mechanical.mjs"] }],
    spark_eligibility: { work_kind: "bounded_ai_transformation", requires_judgment: false, availability: "selectable" }
  };
  const selectable = buildOrchestrationBundle(base);
  assert.equal(selectable.model_recommendation.model, "gpt-5.3-codex-spark");
  assert.equal(selectable.model_recommendation.reasoning, "low");
  for (const availability of ["authoritatively_unavailable", "separate_pool_exhausted"]) {
    const bundle = buildOrchestrationBundle({ ...base, spark_eligibility: { ...base.spark_eligibility, availability } });
    assert.equal(bundle.model_recommendation.model, "gpt-5.6-terra", availability);
    assert.equal(bundle.model_recommendation.reasoning, "high", availability);
    assert.equal(bundle.model_recommendation.spark_gate.actual_availability, "Unverified", availability);
    assert.equal(validateOrchestrationBundle(bundle), true, availability);
  }
  const unknown = buildOrchestrationBundle({
    ...base,
    spark_eligibility: { ...base.spark_eligibility, availability: "unknown_or_unexposed" }
  });
  assert.equal(unknown.model_recommendation.model, "gpt-5.6-terra");
  assert.equal(unknown.model_recommendation.reasoning, "low");
  assert.equal(validateOrchestrationBundle(unknown), true);

  const absent = buildOrchestrationBundle({ ...base, spark_eligibility: undefined });
  assert.equal(absent.model_recommendation.model, "gpt-5.6-terra");
  assert.equal(absent.model_recommendation.reasoning, "high");
  assert.deepEqual(absent.model_recommendation.spark_gate, {
    work_kind: "unexposed",
    requires_judgment: true,
    availability: "unknown_or_unexposed",
    actual_availability: "Unverified",
    worker_required: true,
    excluded_effects: []
  });
  for (const effect of ["security", "privacy", "contract_change", "migration"]) {
    const excluded = buildOrchestrationBundle({
      ...base,
      effects: ["source_mutation", effect],
      spark_eligibility: undefined
    });
    assert.equal(excluded.model_recommendation.model, "gpt-5.6-terra", effect);
    assert.equal(excluded.model_recommendation.reasoning, "high", effect);
    assert.equal(excluded.model_recommendation.spark_gate.requires_judgment, true, effect);
    assert.deepEqual(excluded.model_recommendation.spark_gate.excluded_effects, [effect], effect);
    assert.equal(validateOrchestrationBundle(excluded), true, effect);
  }
  assert.throws(() => buildOrchestrationBundle({ ...base, spark_eligibility: { ...base.spark_eligibility, requires_judgment: true } }), /rejects judgment-required/);
  assert.throws(() => buildOrchestrationBundle({ ...base, effects: ["build"], spark_eligibility: base.spark_eligibility }), /rejects excluded effects/);
  assert.throws(() => buildOrchestrationBundle({ ...base, estimated_duration_ms: 1, effects: ["source_mutation"], explicitly_atomic: true, low_risk: true, remedy_known: true, delegation_overhead_dominates: true, source_mutation_surfaces: ["lib/mechanical.mjs"] }), /worker-required/);
  assert.throws(() => buildOrchestrationBundle({ ...base, work_items: undefined }), /requires an implementation worker topology/);

  const tampered = structuredClone(selectable);
  tampered.model_recommendation.spark_gate.availability = "unknown_or_unexposed";
  tampered.bundle_digest = bundleDigest(tampered);
  assert.throws(() => validateOrchestrationBundle(tampered), /Spark request requires a composer-derived eligible gate/);
});
