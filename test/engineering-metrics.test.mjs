import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAfterActionReport,
  buildMetricsReport,
  ENGINEERING_EVENT_FAMILIES,
  normalizeEngineeringEvent,
  readEngineeringEvents,
  recordEngineeringEvent
} from "../lib/engineering-metrics.mjs";

const cli = path.resolve("bin/acg.mjs");
const NOW = new Date("2026-07-27T00:00:00.000Z");

function event(type, occurredAt, extra = {}) {
  return {
    type,
    occurred_at: occurredAt,
    project: "alpha",
    thread_id: "thread-1",
    source: "operator",
    ...extra
  };
}

test("default-estimate benchmark fixture preserves the complete sanitized prompt", () => {
  const fixture = JSON.parse(fs.readFileSync(
    path.resolve("fixtures/ai-estimation-benchmark.example.json"),
    "utf8"
  ));
  assert.equal(fixture.status, "active_fixture_no_unqualified_blinded_samples");
  assert.equal(fixture.fixture_id, "performed-work-package-generic-v1");
  assert.equal(fixture.variants.generic, "Give me an estimate.");
  assert.equal(fixture.controls.fresh_context, true);
  assert.equal(fixture.controls.verified_current_hook_parent, true);
  assert.equal(fixture.controls.authoritative_hook_execution_evidence_required, true);
  assert.equal(fixture.controls.governance_bootstrap_outside_factual_prompt, true);
  assert.equal(fixture.controls.older_tasks_do_not_gain_new_launch_hooks_on_reload, true);
  assert.equal(
    fixture.controls.prompt_only_no_repository_filesystem_memory_web_prior_task_or_continuity_inspection,
    true
  );
  assert.equal(fixture.controls.reject_stale_or_unverified_parent, true);
  assert.equal(fixture.controls.reject_prompt_visible_governance_coaching, true);
  assert.equal(fixture.controls.record_initial_response_before_follow_up, true);
  assert.equal(fixture.controls.launch_requires_operator_cost_approval, true);
  const genericPrompt = `${fixture.performed_work_scope}\n\n${fixture.variants.generic}`;
  assert.equal(
    crypto.createHash("sha256").update(genericPrompt).digest("hex"),
    fixture.canonical_generic_prompt_sha256
  );
  for (const term of fixture.controls.generic_forbidden_terms) {
    assert.equal(genericPrompt.toLowerCase().includes(term.toLowerCase()), false, term);
  }
});

test("event ledger rejects unbounded data and CLI writes are private and quiet", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-metrics-"));
  const ledger = path.join(root, "events.jsonl");
  assert.throws(() => normalizeEngineeringEvent({
    ...event("task.started", "2026-07-26T00:00:00.000Z"),
    prompt: "must never be stored"
  }), /prohibited or unknown fields/);
  assert.throws(() => normalizeEngineeringEvent({
    ...event("task.started", "2026-07-26T00:00:00.000Z"),
    thread_id: "/private/path"
  }), /without whitespace or path separators/);
  assert.throws(() => normalizeEngineeringEvent({
    type: "task.started",
    occurred_at: "2026-07-26T00:00:00.000Z",
    project: "alpha",
    source: "operator"
  }), /requires one of thread_id, task_id, or work_id/);
  const output = execFileSync(process.execPath, [
    cli,
    "metrics",
    "record",
    "--event", "task.started",
    "--project", "alpha",
    "--thread", "thread-1",
    "--at", "2026-07-26T00:00:00.000Z",
    "--ledger", ledger
  ], { encoding: "utf8" });
  assert.equal(output, "");
  assert.equal(fs.statSync(ledger).mode & 0o777, 0o600);
  const read = readEngineeringEvents({ ledger });
  assert.equal(read.valid_lines, 1);
  assert.equal(read.events[0].type, "task.started");
  fs.rmSync(root, { recursive: true, force: true });
});

test("metrics record accepts a closed JSON event without exposing telemetry output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-metrics-json-"));
  const ledger = path.join(root, "events.jsonl");
  const input = path.join(root, "event.json");
  fs.writeFileSync(input, JSON.stringify(event("estimate.conventional", "2026-07-26T00:00:00.000Z", {
    workstream_id: "workstream-1",
    p50_hours: 2700,
    p80_hours: 4200,
    scope_class: "source_task",
    time_basis: "active_human_estimate",
    evidence_class: "proposed",
    qualification: "primary"
  })));
  const output = execFileSync(process.execPath, [
    cli, "metrics", "record", "--file", input, "--ledger", ledger
  ], { encoding: "utf8" });
  assert.equal(output, "");
  assert.equal(readEngineeringEvents({ ledger }).events[0].p50_hours, 2700);
  fs.rmSync(root, { recursive: true, force: true });
});

test("typed token events retain only observed fields and expose field-level coverage", () => {
  assert.deepEqual(ENGINEERING_EVENT_FAMILIES.Token, ["token."]);
  const report = buildMetricsReport({
    events: [
      event("task.started", "2026-07-26T00:00:00.000Z"),
      event("token.usage", "2026-07-26T00:05:00.000Z", {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        provider_latency_ms: 41,
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "partial"
      }),
      event("task.completed", "2026-07-26T01:00:00.000Z")
    ],
    thread: "thread-1",
    days: 7,
    now: NOW
  });
  const token = report.projects[0].tasks[0].views.token;
  assert.equal(token.input_tokens.value, 120);
  assert.equal(token.total_tokens.value, 150);
  assert.equal(token.cached_input_tokens.value, null);
  assert.equal(token.cached_input_tokens.coverage_status, "partial");
  assert.equal(token.total_tokens.coverage_status, "partial");
  assert.throws(() => normalizeEngineeringEvent(event("token.usage", "2026-07-26T00:00:00.000Z", {
    evidence_class: "observed",
    evidence_authority: "runtime_metadata",
    coverage_status: "complete"
  })), /requires at least one observed token or provider latency field/);
});

test("anchorless in-window runtime and token evidence remains visible without fabricating task lifecycle", () => {
  const report = buildMetricsReport({
    events: [
      event("token.usage", "2026-07-26T00:05:00.000Z", {
        total_tokens: 150,
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "complete"
      }),
      event("token.quota_snapshot", "2026-07-26T00:06:00.000Z", {
        used_percent: 30,
        window_minutes: 300,
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "complete"
      }),
      event("runtime.tooling_fallback", "2026-07-26T00:07:00.000Z", {
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "partial"
      }),
      event("seat.started", "2026-07-26T00:08:00.000Z", { seat_id: "seat-1" })
    ],
    thread: "thread-1",
    days: 7,
    now: NOW
  });
  const project = report.projects[0];
  const task = project.tasks[0];
  assert.equal(report.ledger.selected_events, 4);
  assert.equal(report.ledger.anchorless_runtime_evidence_events, 4);
  assert.deepEqual(report.runtime_diagnostics.anchorless_runtime_evidence, {
    coverage_status: "partial",
    event_count: 4,
    task_count: 1
  });
  assert.equal(task.started_at, null);
  assert.equal(task.usable_at, null);
  assert.equal(task.terminal_at, null);
  assert.equal(task.wall_clock_hours, null);
  assert.equal(task.accepted, false);
  assert.equal(task.views.work.coverage_status, "unknown");
  assert.equal(task.views.utilization.effective_seat_hours, null);
  assert.equal(task.views.utilization.peak_concurrent_seats, null);
  assert.equal(task.views.runtime.anchorless_runtime_evidence, true);
  assert.equal(task.views.runtime.seat_lifecycle_events, 1);
  assert.equal(task.views.runtime.tooling_fallback_events, 1);
  assert.equal(task.views.token.total_tokens.value, 150);
  assert.equal(task.views.token.quota_snapshots[0].used_percent, 30);
  assert.equal(project.delivery.wall_clock_hours, null);
  assert.equal(project.comparison.accepted_tasks_per_hour, null);
  assert.equal(project.comparison.accepted_tasks_per_million_exact_observed_tokens, null);
});

test("pre-window task anchors retain only in-window runtime and token evidence", () => {
  const report = buildMetricsReport({
    events: [
      event("task.started", "2026-07-20T00:00:00.000Z"),
      event("token.usage", "2026-07-24T23:59:59.000Z", {
        total_tokens: 999,
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "complete"
      }),
      event("token.usage", "2026-07-26T00:05:00.000Z", {
        total_tokens: 100,
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "complete"
      }),
      event("runtime.segment", "2026-07-26T00:06:00.000Z", {
        workstream_id: "workstream-1",
        segment_id: "segment-1",
        duration_ms: 3600000,
        runtime_status: "complete",
        completeness: "complete",
        evidence_class: "observed",
        qualification: "current_segment"
      }),
      event("seat.started", "2026-07-26T00:07:00.000Z", { seat_id: "seat-1" }),
      event("token.quota_snapshot", "2026-07-27T00:00:00.000Z", {
        used_percent: 80,
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "complete"
      })
    ],
    thread: "thread-1",
    days: 2,
    now: NOW
  });
  const project = report.projects[0];
  const task = project.tasks[0];
  assert.equal(report.ledger.selected_events, 3);
  assert.equal(task.started_at, null);
  assert.equal(task.wall_clock_hours, null);
  assert.equal(task.views.token.total_tokens.value, 100);
  assert.equal(task.views.token.quota_snapshots.length, 0);
  assert.equal(task.views.runtime.complete_wall_clock_hours, 1);
  assert.equal(task.views.utilization.effective_seat_hours, null);
  assert.equal(project.delivery.wall_clock_hours, null);
  assert.equal(project.agent_efficiency.average_concurrent_seats, null);
  assert.equal(project.comparison.task_latency_hours_mean, null);
});

test("operator-requested comparison metrics require complete accepted-task denominators", () => {
  const report = buildMetricsReport({
    events: [
      event("task.started", "2026-07-26T00:00:00.000Z"),
      event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "0" }),
      event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "1" }),
      event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "2" }),
      event("token.usage", "2026-07-26T00:10:00.000Z", {
        total_tokens: 2_000_000,
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "complete"
      }),
      event("quality.duplicated_work", "2026-07-26T01:00:00.000Z", { duration_ms: 60 * 60 * 1000 }),
      event("coordination.overhead", "2026-07-26T01:30:00.000Z", { duration_ms: 30 * 60 * 1000 }),
      event("seat.stopped", "2026-07-26T02:00:00.000Z", { seat_id: "0" }),
      event("seat.stopped", "2026-07-26T02:00:00.000Z", { seat_id: "1" }),
      event("seat.stopped", "2026-07-26T02:00:00.000Z", { seat_id: "2" }),
      event("task.result_usable", "2026-07-26T02:00:00.000Z"),
      event("coverage.seat_intervals", "2026-07-26T02:00:00.000Z", { outcome: "complete" }),
      event("coverage.duplicated_work", "2026-07-26T02:00:00.000Z", { outcome: "complete" }),
      event("coverage.coordination", "2026-07-26T02:00:00.000Z", { outcome: "complete" }),
      event("quality.acceptance", "2026-07-26T02:00:00.000Z", { first_pass: true }),
      event("coverage.quality", "2026-07-26T02:00:00.000Z", { outcome: "complete" }),
      event("task.completed", "2026-07-26T02:00:00.000Z")
    ],
    thread: "thread-1",
    days: 7,
    now: NOW
  });
  const comparison = report.projects[0].comparison;
  assert.equal(comparison.accepted_tasks_per_hour, 0.5);
  assert.equal(comparison.accepted_tasks_per_million_exact_observed_tokens, 0.5);
  assert.equal(comparison.task_latency_hours_mean, 2);
  assert.equal(comparison.average_delegated_worker_count, 2);
  assert.equal(comparison.duplicated_work_duration_over_total_admitted_seat_time, 0.25);
  assert.equal(comparison.orchestration_overhead_duration_over_wall_clock, 0.25);
  assert.equal(comparison.coverage.exact_observed_tokens.ratio, 1);

  const incomplete = buildMetricsReport({
    events: [
      event("task.started", "2026-07-26T00:00:00.000Z"),
      event("quality.acceptance", "2026-07-26T02:00:00.000Z", { first_pass: true }),
      event("coverage.quality", "2026-07-26T02:00:00.000Z", { outcome: "complete" }),
      event("task.completed", "2026-07-26T02:00:00.000Z")
    ],
    thread: "thread-1",
    days: 7,
    now: NOW
  }).projects[0].comparison;
  assert.equal(incomplete.accepted_tasks_per_million_exact_observed_tokens, null);
  assert.equal(incomplete.average_delegated_worker_count, null);
  assert.equal(incomplete.duplicated_work_duration_over_total_admitted_seat_time, null);
  assert.equal(incomplete.orchestration_overhead_duration_over_wall_clock, null);
});

test("orphan seat lifecycle and tooling fallbacks stay runtime diagnostics", () => {
  const report = buildMetricsReport({
    events: [
      event("seat.started", "2026-07-26T00:00:00.000Z", {
        thread_id: undefined,
        seat_id: "orphan-seat"
      }),
      event("seat.stopped", "2026-07-26T00:10:00.000Z", {
        thread_id: undefined,
        seat_id: "orphan-seat"
      }),
      {
        type: "runtime.tooling_fallback",
        occurred_at: "2026-07-26T00:15:00.000Z",
        project: "alpha",
        source: "runtime",
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: "partial"
      }
    ],
    days: 7,
    now: NOW
  });
  assert.equal(report.projects[0].task_count, 0);
  assert.equal(report.projects[0].delivery.completed_tasks, 0);
  assert.equal(report.ledger.orphan_seat_lifecycle_events, 2);
  assert.equal(report.runtime_diagnostics.unlinked_seat_lifecycle_events, 2);
  assert.equal(report.runtime_diagnostics.tooling_fallback_events, 1);
  assert.equal(report.runtime_diagnostics.kpi_effect, "none");
  assert.equal(report.semantics.evidence_authority, "evidence_provenance_not_execution_authority");
});

test("forecasting keeps segment lower bounds and proposed human baselines separate", () => {
  const historical = event("runtime.segment", "2026-07-26T00:00:01.000Z", {
    event_id: "historical-runtime",
    workstream_id: "workstream-1",
    segment_id: "historical-estimate",
    duration_ms: 32 * 60 * 60 * 1000,
    runtime_status: "unknown",
    completeness: "unknown",
    evidence_class: "user_report",
    qualification: "historical_estimate"
  });
  const events = [
    event("task.started", "2026-07-26T00:00:00.000Z"),
    historical,
    event("benchmark.qualification", "2026-07-26T00:00:02.000Z", {
      workstream_id: "workstream-1",
      supersedes_event_id: "historical-runtime",
      evidence_class: "user_report",
      qualification: "boundary_superseded",
      comparability: "unknown"
    }),
    event("forecast.created", "2026-07-26T00:00:03.000Z", {
      workstream_id: "workstream-1",
      p50_wall_clock_hours: 20,
      p80_wall_clock_hours: 30,
      critical_path_hours: 18,
      manual_hours_p50: 2700,
      manual_hours_p80: 4200,
      confidence: "low",
      sample_size: 0,
      evidence_class: "proposed"
    }),
    event("estimate.conventional", "2026-07-26T00:00:04.000Z", {
      workstream_id: "workstream-1",
      p50_hours: 2700,
      p80_hours: 4200,
      scope_class: "source_task",
      time_basis: "active_human_estimate",
      evidence_class: "proposed",
      qualification: "primary"
    }),
    event("estimate.conventional", "2026-07-26T00:00:05.000Z", {
      workstream_id: "workstream-1",
      p50_hours: 1690,
      p80_hours: 2540,
      scope_class: "accepted_product",
      time_basis: "active_human_estimate",
      evidence_class: "proposed",
      qualification: "narrower_scope"
    }),
    event("runtime.segment", "2026-07-26T00:00:06.000Z", {
      workstream_id: "workstream-1",
      segment_id: "current-goal",
      duration_ms: 283485000,
      tokens_used: 28465674,
      runtime_status: "usage_limited",
      completeness: "lower_bound",
      evidence_class: "observed",
      qualification: "current_segment"
    }),
    event("runtime.segment", "2026-07-26T00:00:07.000Z", {
      workstream_id: "workstream-1",
      segment_id: "prior-goal",
      runtime_status: "unknown",
      completeness: "unknown",
      evidence_class: "user_report",
      qualification: "prior_segment"
    }),
    event("runtime.gap", "2026-07-26T00:00:08.000Z", {
      workstream_id: "workstream-1",
      segment_id: "inter-goal-gap",
      parent_segment_id: "prior-goal",
      completeness: "unknown",
      evidence_class: "unknown",
      qualification: "inter_segment_gap"
    }),
    event("validation.run", "2026-07-26T00:00:09.000Z", {
      workstream_id: "workstream-1",
      duration_ms: 9.8534 * 60 * 60 * 1000,
      outcome: "passed",
      first_pass: true,
      validation_mode: "serial",
      completeness: "complete",
      evidence_class: "observed"
    }),
    event("benchmark.estimate_sample", "2026-07-26T00:00:10.000Z", {
      workstream_id: "workstream-1",
      central_hours: 4000,
      lower_hours: 3200,
      upper_hours: 4800,
      team_size: 5,
      variant: "generic",
      evidence_class: "proposed",
      qualification: "reconstructed_not_blinded",
      model_family: "unknown",
      reasoning_level: "unknown",
      model_attestation: "unverified",
      spontaneous_ai_distinction: false
    })
  ];
  const report = buildMetricsReport({
    events,
    thread: "thread-1",
    days: 7,
    now: NOW
  });
  const task = report.projects[0].tasks[0];
  assert.equal(report.ledger.superseded_events, 1);
  assert.equal(report.projects[0].delivery.delivery_compression, null);
  assert.equal(task.forecasting.runtime.complete_wall_clock_hours, null);
  assert.equal(task.forecasting.runtime.observed_lower_bound_hours, 78.745833);
  assert.equal(task.forecasting.runtime.observed_tokens, 28465674);
  assert.equal(task.forecasting.runtime.tokens_complete, false);
  assert.equal(task.forecasting.runtime.unknown_segments, 1);
  assert.equal(task.forecasting.runtime.unknown_gaps, 1);
  assert.equal(task.forecasting.actual_vs_forecast.covered, false);
  assert.equal(task.forecasting.validation.serial_hours, 9.8534);
  assert.deepEqual(
    task.forecasting.conventional_estimates.map((value) => value.scope_class),
    ["source_task", "accepted_product"]
  );
  assert.equal(task.forecasting.estimate_samples[0].qualification, "reconstructed_not_blinded");
});

test("operator override can retain a context-disclosed estimate without calling it blinded", () => {
  const sample = normalizeEngineeringEvent(event("benchmark.estimate_sample", "2026-07-26T15:02:41.000Z", {
    workstream_id: "workstream-1",
    response_artifact_id: "thread-4",
    central_hours: 4650,
    lower_hours: 3800,
    upper_hours: 5500,
    team_size: 4,
    variant: "generic",
    evidence_class: "observed",
    qualification: "operator_included_context_disclosed",
    model_family: "unknown",
    reasoning_level: "unknown",
    model_attestation: "unverified",
    spontaneous_ai_distinction: false
  }));
  assert.equal(sample.qualification, "operator_included_context_disclosed");
  assert.notEqual(sample.qualification, "blinded");
});

test("historical workstream registration enables reporting without inventing a start time", () => {
  const report = buildMetricsReport({
    events: [
      event("workstream.registered", "2026-07-26T00:00:00.000Z", {
        workstream_id: "workstream-1",
        evidence_class: "observed"
      }),
      event("runtime.segment", "2026-07-26T00:00:01.000Z", {
        workstream_id: "workstream-1",
        segment_id: "segment-1",
        duration_ms: 3600000,
        runtime_status: "complete",
        completeness: "complete",
        evidence_class: "observed",
        qualification: "current_segment"
      })
    ],
    now: NOW,
    days: 30,
    project: "alpha",
    thread: "thread-1"
  });
  assert.equal(report.ledger.orphan_task_events, 0);
  assert.equal(report.projects[0].tasks[0].started_at, null);
  assert.equal(report.projects[0].tasks[0].wall_clock_hours, null);
  assert.equal(report.projects[0].tasks[0].forecasting.runtime.complete_wall_clock_hours, 1);
});

test("invalid benchmark probes remain append-only evidence outside estimate distributions", () => {
  const probe = normalizeEngineeringEvent(event("benchmark.probe", "2026-07-26T14:58:58.000Z", {
    workstream_id: "workstream-1",
    prompt_fixture_id: "performed-work-package-generic-v0",
    prompt_digest: "a".repeat(64),
    response_artifact_id: "thread-3",
    variant: "generic",
    sample_status: "invalid_contaminated",
    evidence_class: "observed",
    bootstrap_attestation: "current_hook_attested",
    prompt_purity: "contaminated",
    invalid_reason: "prohibited_prior_context_inspection",
    central_hours: 4650,
    lower_hours: 3800,
    upper_hours: 5500,
    team_size: 4,
    response_units: "engineering_hours",
    spontaneous_ai_distinction: false,
    requested_model_family: "default",
    requested_reasoning_level: "default",
    actual_model_family: "unknown",
    actual_reasoning_level: "unknown",
    model_attestation: "unverified",
    governance_release_id: "v1-example",
    system_version: "1.3.0"
  }));
  const report = buildMetricsReport({
    events: [event("task.started", "2026-07-26T14:58:57.000Z"), probe],
    now: NOW,
    days: 30,
    project: "alpha",
    thread: "thread-1"
  });
  const task = report.projects[0].tasks[0];
  assert.equal(task.forecasting.estimate_samples.length, 0);
  assert.equal(task.forecasting.probes[0].sample_status, "invalid_contaminated");
  assert.equal(task.forecasting.probes[0].bootstrap_attestation, "current_hook_attested");
  assert.equal(task.forecasting.probes[0].actual_model_family, "unknown");
  assert.equal(task.forecasting.probes[0].central_hours, 4650);
  assert.equal(task.forecasting.probes[0].response_units, "engineering_hours");
  assert.throws(() => normalizeEngineeringEvent(event("benchmark.probe", "2026-07-26T14:58:58.000Z", {
    ...probe,
    event_id: "bad-admission",
    sample_status: "admitted",
    invalid_reason: "none",
    prompt_purity: "contaminated"
  })), /admitted benchmark\.probe/);
});

test("forecast schema rejects invented ranges, free text, and self-supersession", () => {
  assert.throws(() => normalizeEngineeringEvent(event("forecast.created", "2026-07-26T00:00:00.000Z", {
    workstream_id: "workstream-1",
    p50_wall_clock_hours: 30,
    p80_wall_clock_hours: 20,
    critical_path_hours: 18,
    manual_hours_p50: 100,
    manual_hours_p80: 200,
    confidence: "low",
    sample_size: 0,
    evidence_class: "proposed"
  })), /p80_wall_clock_hours/);
  assert.throws(() => normalizeEngineeringEvent(event("runtime.segment", "2026-07-26T00:00:00.000Z", {
    workstream_id: "workstream-1",
    segment_id: "segment-1",
    runtime_status: "unknown",
    completeness: "unknown",
    evidence_class: "user_report",
    qualification: "prior_segment",
    narrative: "must not enter the ledger"
  })), /prohibited or unknown fields/);
  assert.throws(() => normalizeEngineeringEvent(event("benchmark.qualification", "2026-07-26T00:00:00.000Z", {
    event_id: "same-event",
    workstream_id: "workstream-1",
    supersedes_event_id: "same-event",
    evidence_class: "observed",
    qualification: "scope_superseded",
    comparability: "unknown"
  })), /cannot reference the same event/);
});

test("project report computes north-star metrics only from covered evidence", () => {
  const events = [
    event("task.started", "2026-07-26T00:00:00.000Z"),
    event("estimate.manual_hours", "2026-07-26T00:00:00.000Z", { manual_hours_estimate: 8 }),
    event("estimate.manual_hours_avoided", "2026-07-26T00:00:00.000Z", { manual_hours_avoided_estimate: 4 }),
    event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "seat-1" }),
    event("seat.started", "2026-07-26T01:00:00.000Z", { seat_id: "seat-2" }),
    event("seat.idle_started", "2026-07-26T02:00:00.000Z", { seat_id: "seat-2" }),
    event("seat.idle_stopped", "2026-07-26T03:00:00.000Z", { seat_id: "seat-2" }),
    event("operator.intervention", "2026-07-26T03:30:00.000Z", { material: true }),
    event("quality.acceptance", "2026-07-26T04:00:00.000Z", { first_pass: true }),
    event("validation.completed", "2026-07-26T04:00:00.000Z", { outcome: "passed" }),
    event("proof.completed", "2026-07-26T04:00:00.000Z", { outcome: "complete" }),
    event("coverage.intervention", "2026-07-26T04:00:00.000Z", { outcome: "complete" }),
    event("coverage.quality", "2026-07-26T04:00:00.000Z", { outcome: "complete" }),
    event("coverage.validation", "2026-07-26T04:00:00.000Z", { outcome: "complete" }),
    event("coverage.proof", "2026-07-26T04:00:00.000Z", { outcome: "complete" }),
    event("coverage.seat_intervals", "2026-07-26T04:00:00.000Z", { outcome: "complete" }),
    event("seat.stopped", "2026-07-26T04:00:00.000Z", { seat_id: "seat-1" }),
    event("seat.stopped", "2026-07-26T04:00:00.000Z", { seat_id: "seat-2" }),
    event("task.result_usable", "2026-07-26T04:00:00.000Z"),
    event("task.completed", "2026-07-26T04:00:00.000Z"),
    event("task.started", "2026-07-26T10:00:00.000Z", { thread_id: "thread-2" }),
    event("coverage.intervention", "2026-07-26T12:00:00.000Z", { thread_id: "thread-2", outcome: "complete" }),
    event("task.result_usable", "2026-07-26T12:00:00.000Z", { thread_id: "thread-2" }),
    event("task.completed", "2026-07-26T12:00:00.000Z", { thread_id: "thread-2" })
  ];
  const report = buildMetricsReport({
    events,
    project: "alpha",
    days: 7,
    now: NOW
  });
  assert.equal(report.report_type, "project");
  assert.equal(report.projects.length, 1);
  const project = report.projects[0];
  assert.equal(project.delivery.delivery_compression, 2);
  assert.equal(project.delivery.manual_hours_avoided_estimate, 4);
  assert.equal(project.delivery.manual_hours_avoided_is_estimate, true);
  assert.equal(project.delivery.human_waiting_hours_median, 3);
  assert.equal(project.agent_efficiency.average_concurrent_seats, 1.5);
  assert.equal(project.agent_efficiency.peak_concurrent_seats, 2);
  assert.equal(project.agent_efficiency.parallelization_efficiency, 0.75);
  assert.equal(project.operator_load.material_events, 1);
  assert.equal(project.autonomous_completion.counts.completed_after_intervention, 1);
  assert.equal(project.autonomous_completion.counts.completed_without_intervention, 1);
  assert.equal(project.autonomous_completion.autonomous_completion_rate, 0.5);
  assert.equal(project.quality.first_pass_acceptance_rate, 1);
  assert.equal(project.quality.validation_pass_rate, 1);
  assert.equal(project.quality.proof_completion_rate, 1);
  assert.deepEqual(project.coverage.delivery_compression, { covered: 1, eligible: 2, missing: 1, ratio: 0.5 });
  assert.deepEqual(project.coverage.manual_hours_avoided_estimate, { covered: 1, eligible: 2, missing: 1, ratio: 0.5 });
  assert.deepEqual(project.coverage.human_waiting, { covered: 2, eligible: 2, missing: 0, ratio: 1 });
});

test("missing intervals and estimates stay null with coverage", () => {
  const events = [
    event("task.started", "2026-07-26T00:00:00.000Z"),
    event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "seat-1" }),
    event("task.completed", "2026-07-26T01:00:00.000Z")
  ];
  const report = buildMetricsReport({ events, days: 7, now: NOW });
  const project = report.projects[0];
  assert.equal(project.delivery.delivery_compression, null);
  assert.equal(project.delivery.manual_hours_avoided_estimate, null);
  assert.equal(project.agent_efficiency.parallelization_efficiency, null);
  assert.deepEqual(project.coverage.manual_hours_estimate, { covered: 0, eligible: 1, missing: 1, ratio: 0 });
  assert.deepEqual(project.coverage.active_seat_intervals, { covered: 0, eligible: 1, missing: 1, ratio: 0 });
});

test("reports count malformed rows, group portfolio weeks, and filter thread drilldown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-metrics-malformed-"));
  const ledger = path.join(root, "events.jsonl");
  recordEngineeringEvent(event("task.started", "2026-07-20T00:00:00.000Z"), { ledger });
  recordEngineeringEvent(event("task.completed", "2026-07-20T01:00:00.000Z"), { ledger });
  fs.appendFileSync(ledger, "{\"type\":\"task.started\",\"prompt\":\"prohibited\"}\nnot-json\n");
  const portfolio = buildMetricsReport({ ledger, days: 14, now: NOW });
  assert.equal(portfolio.report_type, "portfolio");
  assert.equal(portfolio.ledger.valid_lines, 2);
  assert.equal(portfolio.ledger.invalid_lines, 2);
  assert.equal("path" in portfolio.ledger, false);
  assert.equal(portfolio.weekly_trend.length, 1);
  const drilldown = buildMetricsReport({ ledger, thread: "thread-1", days: 14, now: NOW });
  assert.equal(drilldown.report_type, "thread");
  assert.equal(drilldown.projects[0].tasks.length, 1);
  assert.equal(drilldown.projects[0].tasks[0].key, "thread-1");
  const linkedEvents = [
    event("task.started", "2026-07-20T00:00:00.000Z", {
      thread_id: "child-thread",
      task_id: "source-task"
    }),
    event("task.completed", "2026-07-20T01:00:00.000Z", {
      thread_id: "child-thread",
      task_id: "source-task"
    })
  ];
  const linked = buildMetricsReport({
    events: linkedEvents,
    thread: "source-task",
    days: 14,
    now: NOW
  });
  assert.equal(linked.projects[0].tasks[0].key, "source-task");
  fs.rmSync(root, { recursive: true, force: true });
});

test("identical event IDs deduplicate and conflicting IDs are excluded", () => {
  const shared = {
    ...event("task.started", "2026-07-26T00:00:00.000Z"),
    event_id: "event-shared",
    recorded_at: "2026-07-26T00:00:00.000Z"
  };
  const report = buildMetricsReport({
    events: [
      shared,
      { ...shared },
      { ...shared, type: "task.completed" }
    ],
    days: 7,
    now: NOW
  });
  assert.equal(report.ledger.duplicate_events, 1);
  assert.equal(report.ledger.conflicting_event_ids, 1);
  assert.equal(report.ledger.selected_events, 0);
});

test("weekly trend cohorts a task by its start week and marks current week partial", () => {
  const events = [
    event("task.started", "2026-07-19T23:00:00.000Z"),
    event("coverage.intervention", "2026-07-20T01:00:00.000Z", { outcome: "complete" }),
    event("task.result_usable", "2026-07-20T01:00:00.000Z"),
    event("task.completed", "2026-07-20T01:00:00.000Z")
  ];
  const report = buildMetricsReport({ events, days: 14, now: NOW });
  assert.equal(report.weekly_trend.length, 1);
  assert.equal(report.weekly_trend[0].week_start, "2026-07-13");
  assert.equal(report.weekly_trend[0].projects[0].task_count, 1);
  assert.equal(report.weekly_trend[0].partial, false);
});

test("partial final rows are diagnostics and report generation is read-only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-metrics-partial-"));
  const ledger = path.join(root, "events.jsonl");
  recordEngineeringEvent(event("task.started", "2026-07-26T00:00:00.000Z"), { ledger });
  fs.appendFileSync(ledger, "{\"schema_version\":1");
  const before = fs.statSync(ledger);
  const report = buildMetricsReport({ ledger, days: 7, now: NOW });
  const after = fs.statSync(ledger);
  assert.equal(report.ledger.valid_lines, 1);
  assert.equal(report.ledger.invalid_lines, 0);
  assert.equal(report.ledger.partial_tail_lines, 1);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(fs.readFileSync(ledger, "utf8").endsWith("{\"schema_version\":1"), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("seat efficiency requires declared complete intervals and respects stop-before-start", () => {
  const base = [
    event("task.started", "2026-07-26T00:00:00.000Z"),
    event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "seat-1" }),
    event("seat.stopped", "2026-07-26T01:00:00.000Z", { seat_id: "seat-1" }),
    event("seat.started", "2026-07-26T01:00:00.000Z", { seat_id: "seat-2" }),
    event("seat.stopped", "2026-07-26T02:00:00.000Z", { seat_id: "seat-2" }),
    event("task.result_usable", "2026-07-26T02:00:00.000Z"),
    event("task.completed", "2026-07-26T02:00:00.000Z")
  ];
  const uncovered = buildMetricsReport({ events: base, days: 7, now: NOW }).projects[0];
  assert.equal(uncovered.agent_efficiency.parallelization_efficiency, null);
  assert.deepEqual(uncovered.coverage.active_seat_intervals, {
    covered: 0,
    eligible: 1,
    missing: 1,
    ratio: 0
  });

  const covered = buildMetricsReport({
    events: [
      ...base,
      event("coverage.seat_intervals", "2026-07-26T02:00:00.000Z", { outcome: "complete" })
    ],
    days: 7,
    now: NOW
  }).projects[0];
  assert.equal(covered.agent_efficiency.peak_concurrent_seats, 1);
  assert.equal(covered.agent_efficiency.average_concurrent_seats, 1);
  assert.equal(covered.agent_efficiency.parallelization_efficiency, 1);
});

test("seat zero is topology-only and never contributes to worker-seat metrics", () => {
  const report = buildMetricsReport({
    events: [
      event("task.started", "2026-07-26T00:00:00.000Z"),
      event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "0" }),
      event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "1" }),
      event("seat.stopped", "2026-07-26T01:00:00.000Z", { seat_id: "0" }),
      event("seat.stopped", "2026-07-26T01:00:00.000Z", { seat_id: "1" }),
      event("coverage.seat_intervals", "2026-07-26T01:00:00.000Z", { outcome: "complete" }),
      event("task.result_usable", "2026-07-26T01:00:00.000Z"),
      event("task.completed", "2026-07-26T01:00:00.000Z")
    ],
    days: 7,
    now: NOW
  }).projects[0];

  assert.equal(report.agent_efficiency.peak_concurrent_seats, 1);
  assert.equal(report.agent_efficiency.average_concurrent_seats, 1);
  assert.equal(report.agent_efficiency.parallelization_efficiency, 1);
});

test("idle evidence outside active intervals makes efficiency unavailable", () => {
  const events = [
    event("task.started", "2026-07-26T00:00:00.000Z"),
    event("seat.started", "2026-07-26T00:00:00.000Z", { seat_id: "seat-1" }),
    event("seat.idle_started", "2026-07-26T00:30:00.000Z", { seat_id: "seat-2" }),
    event("seat.idle_stopped", "2026-07-26T01:00:00.000Z", { seat_id: "seat-2" }),
    event("seat.stopped", "2026-07-26T02:00:00.000Z", { seat_id: "seat-1" }),
    event("coverage.seat_intervals", "2026-07-26T02:00:00.000Z", { outcome: "complete" }),
    event("task.result_usable", "2026-07-26T02:00:00.000Z"),
    event("task.completed", "2026-07-26T02:00:00.000Z")
  ];
  const project = buildMetricsReport({
    events,
    thread: "thread-1",
    days: 7,
    now: NOW
  }).projects[0];
  assert.equal(project.agent_efficiency.parallelization_efficiency, null);
  assert.equal(project.tasks[0].coverage.idle_within_active, false);
});

test("remaining forecasts preserve completion targets and expose material target shifts", () => {
  const initial = event("forecast.remaining", "2026-07-26T01:00:00.000Z", {
    event_id: "forecast-initial",
    workstream_id: "workstream-1",
    p50_remaining_hours: 11,
    p80_remaining_hours: 14,
    critical_path_remaining_hours: 9,
    machine_validation_serial_remaining_hours: 2,
    forecast_reason: "initial",
    confidence: "medium",
    evidence_class: "proposed",
    scope_version: "scope-1",
    gate_count_total: 10,
    gate_count_complete: 3
  });
  const revised = event("forecast.remaining", "2026-07-26T01:06:00.000Z", {
    event_id: "forecast-revised",
    workstream_id: "workstream-1",
    p50_remaining_hours: 5.5,
    p80_remaining_hours: 7,
    critical_path_remaining_hours: 5,
    machine_validation_serial_remaining_hours: 2,
    forecast_reason: "calibration_update",
    prior_forecast_event_id: "forecast-initial",
    confidence: "low",
    evidence_class: "proposed",
    scope_version: "scope-1",
    gate_count_total: 10,
    gate_count_complete: 3
  });
  const task = buildMetricsReport({
    events: [
      event("workstream.registered", "2026-07-26T00:00:00.000Z", {
        workstream_id: "workstream-1",
        evidence_class: "observed"
      }),
      initial,
      revised
    ],
    thread: "thread-1",
    days: 7,
    now: NOW
  }).projects[0].tasks[0];
  const history = task.forecasting.remaining_forecast_history;
  assert.equal(history.length, 2);
  assert.equal(history[0].p50_target_at, "2026-07-26T12:00:00.000Z");
  assert.equal(history[0].p80_target_at, "2026-07-26T15:00:00.000Z");
  assert.equal(history[1].elapsed_since_prior_hours, 0.1);
  assert.equal(history[1].p50_target_shift_hours, -5.4);
  assert.equal(history[1].p80_target_shift_hours, -6.9);
  assert.equal(history[1].forecast_reason, "calibration_update");
});

test("remaining forecast validation rejects incoherent ranges and revision lineage", () => {
  assert.throws(
    () => normalizeEngineeringEvent(event("forecast.remaining", "2026-07-26T01:00:00.000Z", {
      workstream_id: "workstream-1",
      p50_remaining_hours: 8,
      p80_remaining_hours: 7,
      critical_path_remaining_hours: 6,
      forecast_reason: "initial",
      confidence: "medium",
      evidence_class: "proposed",
      scope_version: "scope-1",
      gate_count_total: 4,
      gate_count_complete: 1
    })),
    /p80_remaining_hours/
  );
  assert.throws(
    () => normalizeEngineeringEvent(event("forecast.remaining", "2026-07-26T01:00:00.000Z", {
      workstream_id: "workstream-1",
      p50_remaining_hours: 8,
      p80_remaining_hours: 10,
      critical_path_remaining_hours: 6,
      forecast_reason: "gate_completed",
      confidence: "medium",
      evidence_class: "proposed",
      scope_version: "scope-1",
      gate_count_total: 4,
      gate_count_complete: 2
    })),
    /prior_forecast_event_id/
  );
});

test("operator-directed current-segment compression stays qualified and outside north-star metrics", () => {
  const task = buildMetricsReport({
    events: [
      event("workstream.registered", "2026-07-26T00:00:00.000Z", {
        workstream_id: "workstream-1",
        evidence_class: "observed"
      }),
      event("benchmark.compression_snapshot", "2026-07-26T01:00:00.000Z", {
        workstream_id: "workstream-1",
        manual_hours_lower: 2700,
        manual_hours_upper: 4200,
        denominator_hours: 283485 / 3600,
        numerator_scope: "source_task",
        denominator_scope: "current_goal_segment",
        evidence_class: "derived",
        qualification: "operator_directed_current_segment",
        comparability: "category_mismatch"
      })
    ],
    thread: "thread-1",
    days: 7,
    now: NOW
  }).projects[0].tasks[0];
  const snapshot = task.forecasting.compression_snapshots[0];
  assert.equal(snapshot.compression_lower, 34.287528);
  assert.equal(snapshot.compression_midpoint, 43.811842);
  assert.equal(snapshot.compression_upper, 53.336155);
  assert.equal(snapshot.north_star_eligible, false);
  assert.throws(
    () => normalizeEngineeringEvent(event(
      "benchmark.compression_snapshot",
      "2026-07-26T02:00:00.000Z",
      {
        workstream_id: "workstream-1",
        manual_hours_lower: 2700,
        manual_hours_upper: 4200,
        denominator_hours: 78.745833,
        numerator_scope: "source_task",
        denominator_scope: "complete_workstream",
        evidence_class: "derived",
        qualification: "operator_directed_current_segment",
        comparability: "comparable"
      }
    )),
    /current-goal category mismatch/
  );
});

test("remaining forecast lineage rejects cross-workstream and forward references", () => {
  const reports = buildMetricsReport({
    events: [
      event("workstream.registered", "2026-07-26T00:00:00.000Z", {
        workstream_id: "workstream-1",
        evidence_class: "observed"
      }),
      event("forecast.remaining", "2026-07-26T01:00:00.000Z", {
        event_id: "forecast-a",
        workstream_id: "workstream-a",
        p50_remaining_hours: 8,
        p80_remaining_hours: 10,
        critical_path_remaining_hours: 7,
        forecast_reason: "initial",
        confidence: "medium",
        evidence_class: "proposed",
        scope_version: "scope-1",
        gate_count_total: 4,
        gate_count_complete: 1
      }),
      event("forecast.remaining", "2026-07-26T01:06:00.000Z", {
        event_id: "forecast-b",
        workstream_id: "workstream-b",
        p50_remaining_hours: 5,
        p80_remaining_hours: 7,
        critical_path_remaining_hours: 4,
        forecast_reason: "calibration_update",
        prior_forecast_event_id: "forecast-a",
        confidence: "low",
        evidence_class: "proposed",
        scope_version: "scope-1",
        gate_count_total: 4,
        gate_count_complete: 1
      })
    ],
    thread: "thread-1",
    days: 7,
    now: NOW
  }).projects[0].tasks[0].forecasting.remaining_forecast_history;
  assert.equal(reports[1].lineage_valid, false);
  assert.equal(reports[1].lineage_error, "cross_workstream_prior");
  assert.equal(reports[1].p50_target_shift_hours, null);
});

test("after-action projection is bounded and excludes raw task and thread identity", () => {
  const report = buildAfterActionReport({
    events: [
      event("task.started", "2026-07-26T00:00:00.000Z", {
        task_id: "private-task-ref",
        thread_id: "private-thread-ref"
      }),
      event("task.completed", "2026-07-26T01:00:00.000Z", {
        task_id: "private-task-ref",
        thread_id: "private-thread-ref"
      })
    ],
    project: "alpha",
    thread: "private-thread-ref",
    days: 7,
    now: NOW
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.report_type, "agent_system_after_action");
  assert.equal(report.semantics.governance_influence, "none");
  assert.equal(report.semantics.completion_effect, "none");
  assert.doesNotMatch(serialized, /private-task-ref|private-thread-ref/);
  assert.equal("ledger" in report, false);
  assert.equal("filters" in report, false);
});
