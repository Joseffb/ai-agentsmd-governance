import crypto from "node:crypto";
import { normalizeEngineeringEvent, readEngineeringEvents } from "./engineering-metrics.mjs";
import {
  projectCanonicalEventEnvelope,
  projectExecutionLifecycles
} from "./execution-evidence.mjs";

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

function executionsExplicitlyLinked(events, left, right) {
  if (left === right) return true;
  return events.some((event) => event.type === "correlation.linked" && (
    (event.execution_id === left && event.linked_execution_id === right) ||
    (event.execution_id === right && event.linked_execution_id === left)
  ));
}

function linkedEvent(allEvents, sourceEvent, targetEventId, predicate = () => true) {
  const target = allEvents.find((event) => event.event_id === targetEventId);
  return (
    target &&
    sourceEvent.execution_id &&
    target.execution_id &&
    executionsExplicitlyLinked(allEvents, sourceEvent.execution_id, target.execution_id) &&
    predicate(target)
  ) ? target : null;
}

function evidenceLabel(value) {
  return {
    observed: "Observed",
    derived: "Derived",
    proposed: "Proposed",
    user_report: "Proposed"
  }[value] ?? "Unknown";
}

function labeled(value, evidence_class) {
  return { value, evidence_class };
}

function stableEvidenceDigest(events) {
  const canonical = events
    .map(({ recorded_at, ...event }) => event)
    .sort((left, right) => String(left.event_id).localeCompare(String(right.event_id)));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function acceptedWorkRevisionKey(event) {
  return `${event.accepted_work_id}\u0000${event.revision}`;
}

function comparableAcceptanceEvidence(event) {
  // Transport/provenance fields distinguish append-only observations, not the
  // acceptance fact. Array order is likewise not a distinct accepted result.
  return JSON.stringify({
    accepted_work_id: event.accepted_work_id,
    accepted_scope_id: event.accepted_scope_id ?? null,
    acceptance_status: event.acceptance_status,
    revision: event.revision,
    accepted_by: event.accepted_by,
    artifact_validation_ref: event.artifact_validation_ref,
    artifact_refs: [...(event.artifact_refs ?? [])].sort(),
    validation_refs: [...(event.validation_refs ?? [])].sort(),
    first_pass: event.first_pass ?? null,
    rework_event_ids: [...(event.rework_event_ids ?? [])].sort(),
    supersedes_event_id: event.supersedes_event_id ?? null
  });
}

function projectEffectiveAcceptances(acceptanceEvents, allEvents) {
  const groups = new Map();
  for (const event of acceptanceEvents) {
    const key = acceptedWorkRevisionKey(event);
    const group = groups.get(key) ?? { key, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }

  const conflictingKeys = new Set();
  for (const group of groups.values()) {
    const variants = new Set(group.events.map(comparableAcceptanceEvidence));
    group.conflicted = variants.size > 1;
    if (group.conflicted) conflictingKeys.add(group.key);
    group.selected = [...group.events].sort((left, right) =>
      String(left.event_id).localeCompare(String(right.event_id))
    )[0];
  }

  const supersededKeys = new Set();
  for (const group of groups.values()) {
    for (const event of group.events) {
      if (!event.supersedes_event_id) continue;
      const target = linkedEvent(
        allEvents,
        event,
        event.supersedes_event_id,
        (candidate) => candidate.type === ACCEPTANCE_TYPE &&
          candidate.accepted_work_id === event.accepted_work_id
      );
      if (target) supersededKeys.add(acceptedWorkRevisionKey(target));
    }
  }

  return {
    effective: [...groups.values()]
      .filter((group) => !group.conflicted && group.selected.acceptance_status === "accepted" && !supersededKeys.has(group.key))
      .map((group) => group.selected),
    conflictingKeys
  };
}

function boundedHeadline({ acceptedScopes, wallClockHours, conventional, compression }) {
  const accepted = acceptedScopes === null ? "Unknown accepted validated scope" : `${acceptedScopes} accepted validated scope${acceptedScopes === 1 ? "" : "s"}`;
  const wall = wallClockHours === null ? "Unknown observed wall clock" : `${wallClockHours.toFixed(2)} observed wall-clock hours`;
  const effort = conventional === null ? "conventional effort Unknown" : `conventional effort ${conventional[0]}-${conventional[1]} proposed hours`;
  const ratio = compression === null ? "compression Unknown" : `derived compression ${compression[0].toFixed(2)}-${compression[1].toFixed(2)}x`;
  return `${accepted}; ${wall}; ${effort}; ${ratio}.`.slice(0, 240);
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
  const acceptedProjection = projectEffectiveAcceptances(acceptanceEvents, read.events);
  const effectiveAccepted = acceptedProjection.effective;
  const resultLinks = events.filter((event) => event.type === "decision.result_linked");
  const decisions = events.filter((event) => event.type === "decision.material").map((event) => {
    const resultEventIds = [...new Set([
      ...(event.result_event_ids ?? []),
      ...resultLinks.filter((link) => link.decision_id === event.decision_id).flatMap((link) => link.result_event_ids)
    ])].filter((eventId) => linkedEvent(read.events, event, eventId)).sort();
    const validSupersession = event.supersedes_event_id &&
      linkedEvent(
        read.events,
        event,
        event.supersedes_event_id,
        (target) => target.type === "decision.material" &&
          target.decision_id === event.decision_id
      );
    return {
      ...envelope(event),
      decision_id: event.decision_id,
      decision_scope: event.decision_scope,
      decision_type: event.decision_type ?? null,
      requested_action: event.requested_action ?? null,
      normal_path: event.normal_path ?? null,
      decision_authority: event.decision_authority,
      authority_refs: event.authority_refs ?? [],
      evidence_refs: event.evidence_refs ?? [],
      rule_refs: event.rule_refs ?? [],
      reason_summary: event.reason_summary ?? null,
      alternative_codes: event.alternative_codes ?? [],
      risk_summary: event.risk_summary ?? null,
      expected_effect: event.expected_effect ?? null,
      actor: event.actor ?? null,
      decision_status: event.decision_status,
      decision_revision: event.decision_revision,
      decision_basis_ref: event.decision_basis_ref,
      decision_artifact_ref: event.decision_artifact_ref ?? null,
      result_event_ids: resultEventIds,
      supersedes_event_id: validSupersession ? event.supersedes_event_id : null,
      supersession_valid: event.supersedes_event_id ? Boolean(validSupersession) : null
    };
  });
  const starts = events.filter((event) => event.type === CREDIT_STARTED);
  const exhausted = events.filter((event) => event.type === CREDIT_EXHAUSTED);
  const links = events.filter((event) => event.type === PROJECT_LINKED);
  const start = starts.at(-1) ?? null;
  const end = exhausted.at(-1) ?? null;
  const creditComplete = Boolean(start && end && links.length) && observedComplete(start) && observedComplete(end) && links.every(observedComplete) &&
    start.billing_benchmark_id === end.billing_benchmark_id && start.billing_currency === end.billing_currency && start.credit_amount_micros === end.credit_amount_micros;
  const tokens = sumObserved(tokenEvents, "total_tokens");
  const acceptanceComplete = acceptanceEvents.length > 0 && acceptanceEvents.every(observedComplete) && acceptedProjection.conflictingKeys.size === 0;
  const benchmarkComplete = creditComplete && tokens !== null && acceptanceComplete;
  const credit = benchmarkComplete ? start.credit_amount_micros / 1_000_000 : null;
  const acceptedScopeIds = [...new Set(effectiveAccepted.map((event) => event.accepted_scope_id).filter(Boolean))].sort();
  const artifactRefs = [...new Set(effectiveAccepted.flatMap((event) => event.artifact_refs ?? []))].sort();
  const validationRefs = [...new Set(effectiveAccepted.flatMap((event) => (
    event.validation_refs ?? (event.artifact_validation_ref ? [event.artifact_validation_ref] : [])
  )))].sort();
  const enrichedAcceptanceComplete = acceptanceComplete && effectiveAccepted.every((event) => (
    event.accepted_scope_id && event.artifact_refs?.length && event.validation_refs?.length &&
    typeof event.first_pass === "boolean" && Array.isArray(event.rework_event_ids)
  ));
  const acceptanceStatusCounts = acceptanceComplete
    ? Object.fromEntries(["accepted", "rejected", "revised", "superseded"].map((status) => [
      status,
      acceptanceEvents.filter((event) => event.acceptance_status === status).length
    ]))
    : null;
  const firstOutputAt = lifecycle?.milestones?.first_output_at ?? null;
  const executionStartedAt = lifecycle?.timestamps?.Queued ??
    lifecycle?.timestamps?.Allocated ??
    lifecycle?.timestamps?.Running ??
    null;
  const firstOutputLatencyMs = firstOutputAt && executionStartedAt
    ? Math.max(0, Date.parse(firstOutputAt) - Date.parse(executionStartedAt))
    : null;
  const operatorTouchEvents = events.filter((event) => event.type === "operator.touch");
  const operatorWaitEvents = events.filter((event) => event.type === "operator.wait");
  const operatorTouchMs = sumObserved(operatorTouchEvents, "duration_ms");
  const operatorWaitMs = sumObserved(operatorWaitEvents, "duration_ms");
  const wallClockMs = lifecycle?.timestamps?.Queued && lifecycle?.complete_at
    ? Math.max(0, Date.parse(lifecycle.complete_at) - Date.parse(lifecycle.timestamps.Queued))
    : null;
  const conventionalEvent = events.find((event) => event.type === "estimate.conventional" &&
    Number.isFinite(event.p50_hours) && Number.isFinite(event.p80_hours)) ?? null;
  const conventionalRange = conventionalEvent
    ? [conventionalEvent.p50_hours, conventionalEvent.p80_hours]
    : null;
  const wallClockHours = wallClockMs === null ? null : wallClockMs / (60 * 60 * 1000);
  const compressionRange = conventionalRange && wallClockHours > 0
    ? [conventionalRange[0] / wallClockHours, conventionalRange[1] / wallClockHours]
    : null;
  const evidenceDigest = stableEvidenceDigest(events);
  const project = events[0]?.project ?? null;

  return {
    schema_version: 1, report_type: "canonical_execution_evidence", operator_requested: true, execution,
    ledger: { configured: Boolean(read.ledger), valid_lines: read.valid_lines, invalid_lines: read.invalid_lines, partial_tail_lines: read.partial_tail_lines },
    lifecycle,
    event_envelopes: events.map(projectCanonicalEventEnvelope),
    engineered_output: {
      primary_numerator: "accepted_validated_scope",
      effective_accepted_work_count: labeled(
        acceptanceComplete ? effectiveAccepted.length : null,
        acceptanceComplete ? "Observed" : "Unknown"
      ),
      accepted_scope_ids: labeled(
        enrichedAcceptanceComplete ? acceptedScopeIds : null,
        enrichedAcceptanceComplete ? "Observed" : "Unknown"
      ),
      artifact_refs: labeled(
        enrichedAcceptanceComplete ? artifactRefs : null,
        enrichedAcceptanceComplete ? "Observed" : "Unknown"
      ),
      validation_refs: labeled(
        enrichedAcceptanceComplete ? validationRefs : null,
        enrichedAcceptanceComplete ? "Observed" : "Unknown"
      ),
      acceptance_status_counts: labeled(
        acceptanceStatusCounts,
        acceptanceComplete ? "Observed" : "Unknown"
      ),
      first_output_at: labeled(firstOutputAt, firstOutputAt ? "Observed" : "Unknown"),
      first_output_latency_ms: labeled(
        firstOutputLatencyMs,
        firstOutputLatencyMs === null ? "Unknown" : "Derived"
      ),
      first_pass_count: labeled(
        enrichedAcceptanceComplete
          ? effectiveAccepted.filter((event) => event.first_pass).length
          : null,
        enrichedAcceptanceComplete ? "Observed" : "Unknown"
      ),
      rework_event_count: labeled(
        enrichedAcceptanceComplete
          ? effectiveAccepted.reduce((count, event) => count + event.rework_event_ids.length, 0)
          : null,
        enrichedAcceptanceComplete ? "Observed" : "Unknown"
      ),
      operator_touch_ms: labeled(operatorTouchMs, operatorTouchMs === null ? "Unknown" : "Observed"),
      operator_wait_ms: labeled(operatorWaitMs, operatorWaitMs === null ? "Unknown" : "Observed")
    },
    acceptance: {
      effective_accepted_work_count: acceptanceComplete ? effectiveAccepted.length : null,
      events: acceptanceEvents.map((event) => ({
        ...envelope(event),
        accepted_work_id: event.accepted_work_id,
        acceptance_status: event.acceptance_status,
        revision: event.revision,
        accepted_by: event.accepted_by,
        artifact_validation_ref: event.artifact_validation_ref,
        accepted_scope_id: event.accepted_scope_id ?? null,
        artifact_refs: event.artifact_refs ?? [],
        validation_refs: event.validation_refs ?? [],
        first_pass: event.first_pass ?? null,
        rework_event_ids: event.rework_event_ids ?? [],
        supersedes_event_id: event.supersedes_event_id &&
          linkedEvent(
            read.events,
            event,
            event.supersedes_event_id,
            (target) => target.type === ACCEPTANCE_TYPE &&
              target.accepted_work_id === event.accepted_work_id
          )
          ? event.supersedes_event_id
          : null
      })),
      coverage: {
        ...coverage(acceptanceEvents),
        complete: acceptanceComplete,
        conflicting_accepted_work_revision_count: acceptedProjection.conflictingKeys.size
      }
    },
    material_decisions: decisions,
    oecb_headline: {
      snapshot_id: `oecb-${evidenceDigest.slice(0, 16)}`,
      benchmark_id: `execution-${execution}`,
      execution_id: execution,
      project_id: project,
      period: {
        start: events.length ? events.map((event) => event.occurred_at).sort()[0] : null,
        end: events.length ? events.map((event) => event.occurred_at).sort().at(-1) : null,
        evidence_class: events.length ? "Observed" : "Unknown"
      },
      system_version: events.find((event) => event.system_version)?.system_version ?? null,
      method_version: "oecb-headline-v1",
      evidence_digest: `sha256:${evidenceDigest}`,
      accepted_validated_scope: labeled(
        enrichedAcceptanceComplete ? acceptedScopeIds.length : null,
        enrichedAcceptanceComplete ? "Observed" : "Unknown"
      ),
      observed_wall_clock_hours: labeled(
        wallClockHours,
        wallClockHours === null ? "Unknown" : "Observed"
      ),
      operator_touch_hours: labeled(
        operatorTouchMs === null ? null : operatorTouchMs / (60 * 60 * 1000),
        operatorTouchMs === null ? "Unknown" : "Observed"
      ),
      observed_tokens: labeled(tokens, tokens === null ? "Unknown" : "Observed"),
      conventional_effort_hours: labeled(
        conventionalRange ? { p50: conventionalRange[0], p80: conventionalRange[1] } : null,
        conventionalEvent ? evidenceLabel(conventionalEvent.evidence_class) : "Unknown"
      ),
      derived_compression: labeled(
        compressionRange ? { lower: compressionRange[0], upper: compressionRange[1] } : null,
        compressionRange ? "Derived" : "Unknown"
      ),
      coverage: {
        accepted_scope: enrichedAcceptanceComplete ? "complete" : "unknown",
        wall_clock: wallClockHours === null ? "unknown" : "complete",
        operator_touch: operatorTouchMs === null ? "unknown" : "complete",
        tokens: tokens === null ? "unknown" : "complete",
        conventional_effort: conventionalRange ? "complete" : "unknown",
        compression: compressionRange ? "complete" : "unknown"
      },
      headline: boundedHeadline({
        acceptedScopes: enrichedAcceptanceComplete ? acceptedScopeIds.length : null,
        wallClockHours,
        conventional: conventionalRange,
        compression: compressionRange
      }),
      governance_influence: "none"
    },
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
    coverage: {
      event_count: events.length,
      token: coverage(tokenEvents),
      acceptance: {
        ...coverage(acceptanceEvents),
        complete: acceptanceComplete,
        conflicting_accepted_work_revision_count: acceptedProjection.conflictingKeys.size
      },
      credit_started: coverage(starts), credit_exhausted: coverage(exhausted), project_linked: coverage(links), authoritative_evidence: "never_inferred_when_unavailable"
    },
    semantics: { evidence_ledger: "one_private_append_only_evidence_ledger", architecture: "Kernel -> Receipts -> Events -> Metrics", governance_influence: "none", reality_contract: "governance_records_reality_does_not_manufacture_it" }
  };
}
