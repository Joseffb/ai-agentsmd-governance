import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionEvidenceReport } from "../lib/execution-evidence-report.mjs";

const observed = { project: "alpha", source: "runtime", evidence_class: "observed", evidence_authority: "runtime_metadata", coverage_status: "complete", execution_id: "exec-1", occurred_at: "2026-07-31T00:00:00.000Z" };

test("execution report consumes normalized canonical credit and acceptance evidence", () => {
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "queued", type: "execution.queued" },
    { ...observed, event_id: "running", type: "execution.running", occurred_at: "2026-07-31T00:01:00.000Z" },
    { ...observed, event_id: "credit-start", type: "billing.credit_benchmark_started", billing_benchmark_id: "credit-100", credit_amount_micros: 100_000_000, billing_currency: "USD" },
    { ...observed, event_id: "project-link", type: "benchmark.project_linked", billing_benchmark_id: "credit-100", billing_project_ref: "alpha-program" },
    { ...observed, event_id: "tokens", type: "token.usage", total_tokens: 5000 },
    { ...observed, event_id: "accepted", type: "accepted_work.recorded", accepted_work_id: "work-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1" },
    { ...observed, event_id: "decision", type: "decision.material", decision_id: "decision-1", decision_scope: "delivery", decision_authority: "operator", decision_status: "recorded", decision_revision: "r1", decision_basis_ref: "basis-1", decision_artifact_ref: "artifact-1", correlation_id: "corr-1", causation_id: "cause-1" },
    { ...observed, event_id: "credit-end", type: "billing.credit_benchmark_exhausted", billing_benchmark_id: "credit-100", credit_amount_micros: 100_000_000, billing_currency: "USD" }
  ] });
  assert.equal(report.credit_benchmark.credit_amount, 100);
  assert.equal(report.credit_benchmark.tokens_per_credit, 50);
  assert.equal(report.credit_benchmark.accepted_work_per_credit, 0.01);
  assert.equal(report.material_decisions[0].decision_scope, "delivery");
  assert.equal(report.material_decisions[0].correlation_id, "corr-1");
  assert.deepEqual(report.lifecycle.lifecycle, ["Queued", "Running"]);
});

test("report does not infer execution links or count superseded acceptance", () => {
  const report = buildExecutionEvidenceReport({ execution: "exec-1", events: [
    { ...observed, event_id: "accepted", type: "accepted_work.recorded", accepted_work_id: "work-1", acceptance_status: "accepted", revision: "r1", accepted_by: "reviewer-1", artifact_validation_ref: "validation-1" },
    { ...observed, event_id: "revised", type: "accepted_work.recorded", accepted_work_id: "work-1", acceptance_status: "revised", revision: "r2", accepted_by: "reviewer-1", artifact_validation_ref: "validation-2", supersedes_event_id: "accepted" },
    { project: "alpha", source: "runtime", event_id: "legacy", type: "task.started", task_id: "exec-1", occurred_at: "2026-07-31T00:02:00.000Z" }
  ] });
  assert.equal(report.acceptance.effective_accepted_work_count, null);
  assert.equal(report.coverage.event_count, 2);
  assert.equal(report.credit_benchmark.coverage, "incomplete_or_unavailable");
});
