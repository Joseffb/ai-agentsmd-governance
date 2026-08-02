import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionEvidenceReport } from "../lib/execution-evidence-report.mjs";

const observed = { project: "alpha", source: "runtime", evidence_class: "observed", evidence_authority: "runtime_metadata", coverage_status: "complete", execution_id: "exec-1", occurred_at: "2026-07-31T00:00:00.000Z" };

test("execution report consumes normalized canonical credit and acceptance evidence", () => {
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "queued", type: "execution.queued" },
    { ...observed, event_id: "running", type: "execution.running", occurred_at: "2026-07-31T00:01:00.000Z" },
    { ...observed, event_id: "first-output", type: "execution.first_output", occurred_at: "2026-07-31T00:10:00.000Z" },
    { ...observed, event_id: "validation-completed", type: "execution.validation_completed", occurred_at: "2026-07-31T00:20:00.000Z" },
    { ...observed, event_id: "credit-start", type: "billing.credit_benchmark_started", billing_benchmark_id: "credit-100", credit_amount_micros: 100_000_000, billing_currency: "USD" },
    { ...observed, event_id: "project-link", type: "benchmark.project_linked", billing_benchmark_id: "credit-100", billing_project_ref: "alpha-program" },
    { ...observed, event_id: "tokens", type: "token.usage", total_tokens: 5000 },
    { ...observed, event_id: "touch", type: "operator.touch", workstream_id: "stream-1", duration_ms: 900_000, completeness: "complete" },
    { ...observed, event_id: "wait", type: "operator.wait", workstream_id: "stream-1", duration_ms: 300_000, completeness: "complete" },
    { ...observed, event_id: "conventional", type: "estimate.conventional", workstream_id: "stream-1", p50_hours: 8, p80_hours: 12, scope_class: "accepted_product", time_basis: "active_human_estimate", evidence_class: "proposed", qualification: "primary" },
    { ...observed, event_id: "accepted", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1", artifact_refs: ["artifact-1"], validation_refs: ["validation-1"], first_pass: true, rework_event_ids: [] },
    { ...observed, event_id: "decision", type: "decision.material", decision_id: "decision-1", decision_scope: "execution", decision_type: "orchestration_classification", requested_action: "implementation", normal_path: "worker_required", decision_authority: "execution_brief", authority_refs: ["authority-1"], evidence_refs: ["evidence-1"], rule_refs: ["rule-1"], reason_summary: "classifier:worker_required", alternative_codes: [], risk_summary: "declared_effects:1", expected_effect: "observational_execution_evidence_only", actor: "seat_0", decision_status: "recorded", decision_revision: "r1", decision_basis_ref: "basis-1", decision_artifact_ref: "artifact-1", result_event_ids: [], correlation_id: "corr-1", causation_id: "cause-1" },
    { ...observed, event_id: "decision-result", type: "decision.result_linked", decision_id: "decision-1", result_event_ids: ["completed"] },
    { ...observed, event_id: "completed", type: "execution.completed", occurred_at: "2026-07-31T04:00:00.000Z" },
    { ...observed, event_id: "credit-end", type: "billing.credit_benchmark_exhausted", billing_benchmark_id: "credit-100", credit_amount_micros: 100_000_000, billing_currency: "USD" }
  ] });
  assert.equal(report.credit_benchmark.credit_amount, 100);
  assert.equal(report.credit_benchmark.tokens_per_credit, 50);
  assert.equal(report.credit_benchmark.accepted_work_per_credit, 0.01);
  assert.equal(report.material_decisions[0].decision_scope, "execution");
  assert.equal(report.material_decisions[0].correlation_id, "corr-1");
  assert.deepEqual(report.material_decisions[0].result_event_ids, ["completed"]);
  assert.deepEqual(report.lifecycle.lifecycle, ["Queued", "Running", "Complete"]);
  assert.equal(report.lifecycle.milestones.first_output_at, "2026-07-31T00:10:00.000Z");
  assert.equal(report.lifecycle.milestones.validation_completed_at, "2026-07-31T00:20:00.000Z");
  assert.equal(report.acceptance.effective_accepted_work_count, 1);
  assert.equal(report.engineered_output.primary_numerator, "accepted_validated_scope");
  assert.deepEqual(report.engineered_output.accepted_scope_ids, {
    value: ["scope-1"],
    evidence_class: "Observed"
  });
  assert.deepEqual(report.engineered_output.acceptance_status_counts.value, {
    accepted: 1,
    rejected: 0,
    revised: 0,
    superseded: 0
  });
  assert.equal(report.engineered_output.first_output_latency_ms.value, 600_000);
  assert.equal(report.engineered_output.first_pass_count.value, 1);
  assert.equal(report.engineered_output.rework_event_count.value, 0);
  assert.equal(report.engineered_output.operator_touch_ms.value, 900_000);
  assert.equal(report.engineered_output.operator_wait_ms.value, 300_000);
  assert.deepEqual(Object.keys(report.event_envelopes[0]), [
    "event_family", "event_type", "project_id", "authority_level", "typed_payload"
  ]);
  assert.match(report.oecb_headline.snapshot_id, /^oecb-[a-f0-9]{16}$/);
  assert.match(report.oecb_headline.evidence_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.oecb_headline.accepted_validated_scope.evidence_class, "Observed");
  assert.equal(report.oecb_headline.conventional_effort_hours.evidence_class, "Proposed");
  assert.equal(report.oecb_headline.derived_compression.evidence_class, "Derived");
  assert.equal(report.oecb_headline.governance_influence, "none");
  assert.ok(report.oecb_headline.headline.length <= 240);
});

test("report does not infer execution links or count superseded acceptance", () => {
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "accepted", type: "accepted_work.recorded", accepted_work_id: "work-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1" },
    { ...observed, event_id: "revised", type: "accepted_work.recorded", accepted_work_id: "work-1", acceptance_status: "revised", revision: "r2", accepted_by: "reviewer-1", artifact_validation_ref: "validation-2", supersedes_event_id: "accepted" },
    { project: "alpha", source: "runtime", event_id: "legacy", type: "task.started", task_id: "exec-1", occurred_at: "2026-07-31T00:02:00.000Z" }
  ] });
  assert.equal(report.acceptance.effective_accepted_work_count, 0);
  assert.equal(report.coverage.event_count, 2);
  assert.equal(report.credit_benchmark.coverage, "incomplete_or_unavailable");
});

test("accepted validated scope is primary and remains visible without credit or tokens", () => {
  const events = [
    { ...observed, event_id: "queued", type: "execution.queued" },
    { ...observed, event_id: "accepted", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1", artifact_refs: ["artifact-1"], validation_refs: ["validation-1"], first_pass: false, rework_event_ids: ["rework-1"] }
  ];
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events });
  const repeated = buildExecutionEvidenceReport({ execution: "exec-1", events });
  assert.equal(report.acceptance.effective_accepted_work_count, 1);
  assert.equal(report.engineered_output.effective_accepted_work_count.value, 1);
  assert.deepEqual(report.engineered_output.accepted_scope_ids.value, ["scope-1"]);
  assert.equal(report.engineered_output.first_pass_count.value, 0);
  assert.equal(report.engineered_output.rework_event_count.value, 1);
  assert.equal(report.credit_benchmark.accepted_work, null);
  assert.equal(report.resource_use.tokens, null);
  assert.equal(report.oecb_headline.accepted_validated_scope.value, 1);
  assert.equal(report.oecb_headline.observed_tokens.evidence_class, "Unknown");
  assert.equal(report.oecb_headline.conventional_effort_hours.value, null);
  assert.equal(report.oecb_headline.derived_compression.value, null);
  assert.equal(report.oecb_headline.snapshot_id, repeated.oecb_headline.snapshot_id);
});

test("retried accepted-work evidence is counted once per accepted work revision", () => {
  const events = [
    { ...observed, event_id: "accepted-retry-b", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1", artifact_refs: ["artifact-1"], validation_refs: ["validation-1"], first_pass: true, rework_event_ids: [] },
    { ...observed, event_id: "accepted-retry-a", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1", artifact_refs: ["artifact-1"], validation_refs: ["validation-1"], first_pass: true, rework_event_ids: [] }
  ];
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events });
  const reversed = buildExecutionEvidenceReport({ execution: "exec-1", events: [...events].reverse() });

  assert.equal(report.acceptance.effective_accepted_work_count, 1);
  assert.equal(report.engineered_output.effective_accepted_work_count.value, 1);
  assert.equal(report.acceptance.coverage.complete, true);
  assert.equal(report.acceptance.coverage.conflicting_accepted_work_revision_count, 0);
  assert.deepEqual(report.engineered_output, reversed.engineered_output);
});

test("supersession applies to the accepted work revision rather than one retry event", () => {
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "accepted-retry-b", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1", artifact_refs: ["artifact-1"], validation_refs: ["validation-1"], first_pass: true, rework_event_ids: [] },
    { ...observed, event_id: "accepted-retry-a", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1", artifact_refs: ["artifact-1"], validation_refs: ["validation-1"], first_pass: true, rework_event_ids: [] },
    { ...observed, event_id: "accepted-r2", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-2", acceptance_status: "accepted", revision: "r2", accepted_by: "reviewer-1", artifact_validation_ref: "validation-2", artifact_refs: ["artifact-2"], validation_refs: ["validation-2"], first_pass: false, rework_event_ids: ["rework-1"], supersedes_event_id: "accepted-retry-b" }
  ] });

  assert.equal(report.acceptance.effective_accepted_work_count, 1);
  assert.deepEqual(report.engineered_output.accepted_scope_ids.value, ["scope-2"]);
  assert.equal(report.engineered_output.first_pass_count.value, 0);
  assert.equal(report.engineered_output.rework_event_count.value, 1);
});

test("conflicting accepted-work retries reduce coverage instead of selecting output evidence", () => {
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "credit-start", type: "billing.credit_benchmark_started", billing_benchmark_id: "credit-100", credit_amount_micros: 100_000_000, billing_currency: "USD" },
    { ...observed, event_id: "project-link", type: "benchmark.project_linked", billing_benchmark_id: "credit-100", billing_project_ref: "alpha-program" },
    { ...observed, event_id: "tokens", type: "token.usage", total_tokens: 5000 },
    { ...observed, event_id: "accepted-a", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-a", artifact_refs: ["artifact-1"], validation_refs: ["validation-a"], first_pass: true, rework_event_ids: [] },
    { ...observed, event_id: "accepted-b", type: "accepted_work.recorded", accepted_work_id: "work-1", accepted_scope_id: "scope-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-b", artifact_refs: ["artifact-1"], validation_refs: ["validation-b"], first_pass: true, rework_event_ids: [] },
    { ...observed, event_id: "credit-end", type: "billing.credit_benchmark_exhausted", billing_benchmark_id: "credit-100", credit_amount_micros: 100_000_000, billing_currency: "USD" }
  ] });

  assert.equal(report.acceptance.effective_accepted_work_count, null);
  assert.equal(report.engineered_output.effective_accepted_work_count.value, null);
  assert.equal(report.acceptance.coverage.complete, false);
  assert.equal(report.acceptance.coverage.conflicting_accepted_work_revision_count, 1);
  assert.equal(report.credit_benchmark.accepted_work, null);
  assert.equal(report.credit_benchmark.accepted_work_per_credit, null);
  assert.equal(report.credit_benchmark.coverage, "incomplete_or_unavailable");
});

test("supersession requires the same accepted work or an explicit execution correlation", () => {
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "accepted", type: "accepted_work.recorded", accepted_work_id: "work-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1" },
    { ...observed, event_id: "invalid-revision", type: "accepted_work.recorded", accepted_work_id: "work-2", acceptance_status: "revised", revision: "r2", accepted_by: "reviewer-1", artifact_validation_ref: "validation-2", supersedes_event_id: "accepted" },
    { ...observed, event_id: "decision-current", type: "decision.material", decision_id: "decision-1", decision_scope: "delivery", decision_authority: "operator", decision_status: "superseded", decision_revision: "r2", decision_basis_ref: "basis-2", supersedes_event_id: "decision-other" },
    { ...observed, execution_id: "exec-2", event_id: "decision-other", type: "decision.material", decision_id: "decision-1", decision_scope: "delivery", decision_authority: "operator", decision_status: "recorded", decision_revision: "r1", decision_basis_ref: "basis-1" }
  ] });
  assert.equal(report.acceptance.effective_accepted_work_count, 1);
  assert.equal(report.acceptance.events[1].supersedes_event_id, null);
  assert.equal(report.material_decisions[0].supersession_valid, false);

  const correlated = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "decision-current", type: "decision.material", decision_id: "decision-1", decision_scope: "delivery", decision_authority: "operator", decision_status: "superseded", decision_revision: "r2", decision_basis_ref: "basis-2", supersedes_event_id: "decision-other" },
    { ...observed, event_id: "correlation", type: "correlation.linked", correlation_id: "corr-1", linked_execution_id: "exec-2", link_type: "continuation_of" },
    { ...observed, execution_id: "exec-2", event_id: "decision-other", type: "decision.material", decision_id: "decision-1", decision_scope: "delivery", decision_authority: "operator", decision_status: "recorded", decision_revision: "r1", decision_basis_ref: "basis-1" }
  ] });
  assert.equal(correlated.material_decisions[0].supersession_valid, true);
  assert.equal(correlated.material_decisions[0].supersedes_event_id, "decision-other");
});
