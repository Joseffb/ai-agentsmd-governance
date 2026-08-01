import { normalizeEngineeringEvent, readEngineeringEvents } from "./engineering-metrics.mjs";
import { projectExecutionLifecycles } from "./execution-evidence.mjs";

const ACCEPTANCE_TYPE = "accepted_work.recorded";
const CREDIT_STARTED = "billing.credit_benchmark_started";
const CREDIT_EXHAUSTED = "billing.credit_benchmark_exhausted";
const PROJECT_LINKED = "benchmark.project_linked";

function fail(message) { throw new Error(message); }
function boundedIdentifier(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail(`${name} must be a bounded portable identifier`);
  return value;
}
function observedComplete(event) { return event.evidence_class === "observed" && event.coverage_status === "complete"; }
function coverage(events) {
  return { observed_event_count: events.length, complete_observed_event_count: events.filter(observedComplete).length, complete: events.length > 0 && events.every(observedComplete) };
}
function envelope(event) {
  return Object.fromEntries(["event_id", "occurred_at", "recorded_at", "project", "source", "evidence_class", "evidence_authority", "coverage_status", "execution_id", "correlation_id", "causation_id"].map((key) => [key, event[key] ?? null]));
}
function sumObserved(events, field) {
  return events.length && events.every((event) => observedComplete(event) && Number.isFinite(event[field]))
    ? events.reduce((total, event) => total + event[field], 0)
    : null;
}

export function buildExecutionEvidenceReport(options = {}) {
  const execution = boundedIdentifier(options.execution, "execution");
  const read = options.events
    ? { events: options.events.map((event) => normalizeEngineeringEvent(event)), ledger: null, valid_lines: null, invalid_lines: null, partial_tail_lines: null }
    : readEngineeringEvents({ ledger: options.ledger });
  // Legacy task/work/thread identity is intentionally not an execution link.
  const events = read.events.filter((event) => event.execution_id === execution);
  const lifecycle = projectExecutionLifecycles(events).find((item) => item.execution_id === execution) ?? null;
  const tokenEvents = events.filter((event) => event.type === "token.usage");
  const acceptanceEvents = events.filter((event) => event.type === ACCEPTANCE_TYPE);
  const supersededIds = new Set(acceptanceEvents.map((event) => event.supersedes_event_id).filter(Boolean));
  const effectiveAccepted = acceptanceEvents.filter((event) => event.acceptance_status === "accepted" && !supersededIds.has(event.event_id));
  const decisions = events.filter((event) => event.type === "decision.material").map((event) => ({
    ...envelope(event), decision_id: event.decision_id, decision_scope: event.decision_scope,
    decision_authority: event.decision_authority, decision_status: event.decision_status,
    decision_revision: event.decision_revision, decision_basis_ref: event.decision_basis_ref,
    decision_artifact_ref: event.decision_artifact_ref ?? null, supersedes_event_id: event.supersedes_event_id ?? null
  }));
  const starts = events.filter((event) => event.type === CREDIT_STARTED);
  const exhausted = events.filter((event) => event.type === CREDIT_EXHAUSTED);
  const links = events.filter((event) => event.type === PROJECT_LINKED);
  const start = starts.at(-1) ?? null;
  const end = exhausted.at(-1) ?? null;
  const creditComplete = Boolean(start && end && links.length) && observedComplete(start) && observedComplete(end) && links.every(observedComplete) &&
    start.billing_benchmark_id === end.billing_benchmark_id && start.billing_currency === end.billing_currency && start.credit_amount_micros === end.credit_amount_micros;
  const tokens = sumObserved(tokenEvents, "total_tokens");
  const acceptanceComplete = effectiveAccepted.length > 0 && effectiveAccepted.every(observedComplete);
  const benchmarkComplete = creditComplete && tokens !== null && acceptanceComplete;
  const credit = benchmarkComplete ? start.credit_amount_micros / 1_000_000 : null;

  return {
    schema_version: 1, report_type: "canonical_execution_evidence", operator_requested: true, execution,
    ledger: { configured: Boolean(read.ledger), valid_lines: read.valid_lines, invalid_lines: read.invalid_lines, partial_tail_lines: read.partial_tail_lines },
    lifecycle,
    acceptance: {
      effective_accepted_work_count: benchmarkComplete ? effectiveAccepted.length : null,
      events: acceptanceEvents.map((event) => ({ ...envelope(event), accepted_work_id: event.accepted_work_id, acceptance_status: event.acceptance_status, revision: event.revision, accepted_by: event.accepted_by, artifact_validation_ref: event.artifact_validation_ref, supersedes_event_id: event.supersedes_event_id ?? null })),
      coverage: coverage(acceptanceEvents)
    },
    material_decisions: decisions,
    resource_use: { tokens, cached_input_tokens: sumObserved(tokenEvents, "cached_input_tokens"), reasoning_output_tokens: sumObserved(tokenEvents, "reasoning_output_tokens") },
    credit_benchmark: {
      credit_amount: credit, currency: benchmarkComplete ? start.billing_currency : null,
      started: start ? envelope(start) : null, exhausted: end ? envelope(end) : null,
      project_links: links.map(envelope), observed_tokens: benchmarkComplete ? tokens : null,
      accepted_work: benchmarkComplete ? effectiveAccepted.length : null,
      tokens_per_credit: credit && tokens !== null ? tokens / credit : null,
      accepted_work_per_credit: credit ? effectiveAccepted.length / credit : null,
      coverage: benchmarkComplete ? "complete_observed_credit_token_and_accepted_work" : "incomplete_or_unavailable",
      quota_substitution: "prohibited"
    },
    coverage: { event_count: events.length, token: coverage(tokenEvents), acceptance: coverage(acceptanceEvents), credit_started: coverage(starts), credit_exhausted: coverage(exhausted), project_linked: coverage(links), authoritative_evidence: "never_inferred_when_unavailable" },
    semantics: { evidence_ledger: "one_private_append_only_evidence_ledger", architecture: "Kernel -> Receipts -> Events -> Metrics", governance_influence: "none", reality_contract: "governance_records_reality_does_not_manufacture_it" }
  };
}
