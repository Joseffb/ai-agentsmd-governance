// Canonical, private execution evidence vocabulary.  This module intentionally
// models observations only: callers may project evidence into a lifecycle, but
// the projection neither authorizes work nor controls scheduling or policy.

export const EXECUTION_COMMON_FIELDS = Object.freeze([
  "execution_id", "correlation_id", "causation_id"
]);

export const EXECUTION_LIFECYCLE = Object.freeze([
  "Queued", "Allocated", "Running", "Waiting", "Validation", "Accepted", "Rejected", "Complete"
]);

export const EXECUTION_EVIDENCE_EVENT_SPECS = Object.freeze({
  "execution.queued": { required: ["execution_id"] },
  "execution.allocated": { required: ["execution_id"] },
  "execution.running": { required: ["execution_id"] },
  "execution.waiting": { required: ["execution_id"] },
  "execution.validation": { required: ["execution_id"] },
  "execution.accepted": { required: ["execution_id"] },
  "execution.rejected": { required: ["execution_id"] },
  "execution.completed": { required: ["execution_id"] },
  "accepted_work.recorded": {
    fields: ["accepted_work_id", "acceptance_status", "revision", "accepted_by", "artifact_validation_ref", "supersedes_event_id"],
    required: ["execution_id", "accepted_work_id", "acceptance_status", "revision", "accepted_by", "artifact_validation_ref"],
    enums: { acceptance_status: ["accepted", "revised", "superseded", "rejected"] }
  },
  "correlation.linked": {
    fields: ["linked_execution_id", "link_type"],
    required: ["execution_id", "correlation_id", "linked_execution_id", "link_type"],
    enums: { link_type: ["parent_child", "retry_of", "continuation_of", "external_reference"] }
  },
  "correlation.legacy_unlinked": {
    fields: ["legacy_reference"],
    required: ["legacy_reference"]
  },
  "decision.material": {
    fields: ["decision_id", "decision_scope", "decision_authority", "decision_status", "decision_revision", "decision_basis_ref", "decision_artifact_ref", "supersedes_event_id"],
    required: ["execution_id", "decision_id", "decision_scope", "decision_authority", "decision_status", "decision_revision", "decision_basis_ref"],
    enums: { decision_status: ["recorded", "superseded", "withdrawn"] }
  },
  "billing.credit_benchmark_started": {
    fields: ["billing_benchmark_id", "credit_amount_micros", "billing_currency"],
    required: ["execution_id", "billing_benchmark_id", "credit_amount_micros", "billing_currency"],
    currency: true
  },
  "billing.credit_benchmark_exhausted": {
    fields: ["billing_benchmark_id", "credit_amount_micros", "billing_currency"],
    required: ["execution_id", "billing_benchmark_id", "credit_amount_micros", "billing_currency"],
    currency: true
  },
  "benchmark.project_linked": {
    fields: ["billing_benchmark_id", "billing_project_ref"],
    required: ["execution_id", "billing_benchmark_id", "billing_project_ref"]
  },
  // Legacy names remain readable but are not emitted or used by the canonical
  // execution report.
  "billing.benchmark": {
    fields: ["billing_benchmark_id", "billing_unit", "billing_quantity", "billing_rate_micros", "billing_currency"],
    required: ["billing_benchmark_id", "billing_unit", "billing_quantity", "billing_currency"],
    enums: { billing_unit: ["token", "request", "seat_hour", "machine_hour", "fixed"] },
    currency: true
  },
  "billing.project_linked": {
    fields: ["billing_benchmark_id", "billing_project_ref"],
    required: ["billing_benchmark_id", "billing_project_ref"]
  }
});

const STATUS_BY_TYPE = new Map([
  ["execution.queued", "Queued"],
  ["execution.allocated", "Allocated"],
  ["execution.running", "Running"],
  ["execution.waiting", "Waiting"],
  ["execution.validation", "Validation"],
  ["execution.accepted", "Accepted"],
  ["execution.rejected", "Rejected"],
  ["execution.completed", "Complete"]
]);
const STATUS_INDEX = new Map(EXECUTION_LIFECYCLE.map((status, index) => [status, index]));

export function executionStatusForEvent(type) {
  return STATUS_BY_TYPE.get(type) ?? null;
}

/**
 * Produces an observational lifecycle. Missing, out-of-order, and malformed
 * records lower coverage; they are never repaired by inference and never
 * affect an authorization, routing, or scheduling decision.
 */
export function projectExecutionLifecycles(events = []) {
  const grouped = new Map();
  for (const event of events) {
    const status = executionStatusForEvent(event?.type);
    if (!status) continue;
    const executionId = typeof event.execution_id === "string" ? event.execution_id : null;
    if (!executionId) continue;
    const list = grouped.get(executionId) ?? [];
    list.push(event);
    grouped.set(executionId, list);
  }

  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([execution_id, records]) => {
    const ordered = [...records].sort((left, right) => (
      String(left.occurred_at).localeCompare(String(right.occurred_at)) ||
      String(left.recorded_at).localeCompare(String(right.recorded_at)) ||
      String(left.event_id).localeCompare(String(right.event_id))
    ));
    const observed = [];
    const timestamps = {};
    let invalid = 0;
    let acceptedOrRejected = null;
    let lastIndex = -1;

    for (const event of ordered) {
      const status = executionStatusForEvent(event.type);
      const index = STATUS_INDEX.get(status);
      const timestamp = typeof event.occurred_at === "string" && Number.isFinite(Date.parse(event.occurred_at))
        ? new Date(event.occurred_at).toISOString()
        : null;
      if (!timestamp || (acceptedOrRejected && status !== acceptedOrRejected && status !== "Complete") || index < lastIndex) {
        invalid += 1;
        continue;
      }
      if (!observed.includes(status)) {
        observed.push(status);
        timestamps[status] = timestamp;
      }
      if (status === "Accepted" || status === "Rejected") acceptedOrRejected = status;
      lastIndex = Math.max(lastIndex, index);
    }

    const complete = observed.includes("Complete");
    const coverage_status = complete && invalid === 0 ? "complete" : observed.length > 0 ? "partial" : "unknown";
    return {
      execution_id,
      lifecycle: observed,
      timestamps,
      terminal_status: acceptedOrRejected,
      complete_at: timestamps.Complete ?? null,
      coverage_status,
      invalid_observation_count: invalid
    };
  });
}
