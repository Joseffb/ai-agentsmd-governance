import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestRuntimeTelemetry } from "../lib/runtime-telemetry.mjs";

const cli = path.resolve("bin/acg.mjs");

function fixture(root) {
  const sessions = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(sessions);
  fs.mkdirSync(projectRoot);
  const source = path.join(sessions, "rollout.jsonl");
  fs.writeFileSync(source, [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:00.000Z", payload: { id: "session-opaque", session_id: "task-opaque", cwd: projectRoot, prompt: "never persist" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:01.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 11, cached_input_tokens: 4, output_tokens: 5, reasoning_output_tokens: 3, total_tokens: 16 }, total_token_usage: { input_tokens: 999, total_tokens: 999 }, secret: "never persist" }, rate_limits: { primary: { used_percent: 27, window_minutes: 300, reset_epoch_seconds: 1_785_000_000, credits: "never persist" } } } }),
    '{"type":"event_msg","payload":{"type":"token_count",',
    '{"type":"event_msg","payload":{"type":"model",',
    '{"type":"event_msg","payload":{"type":"tool",',
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:02.000Z", payload: { type: "other", output: "never persist" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:03.000Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000 }, model_output: "never parse as a token fact" } } })
  ].join("\n"));
  return { sessions, projectRoot, source };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("runtime ingestion emits schema-recognized per-turn token/quota facts, binds a task, and is idempotent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-"));
  const ledger = path.join(root, "engineering-events.jsonl");
  const input = fixture(root);
  const before = sha256(input.source);
  const options = {
    sessionRoot: input.sessions,
    project: "alpha",
    projectPath: input.projectRoot,
    thread: "task-opaque",
    ledger,
    now: new Date("2026-07-28T01:00:00.000Z")
  };
  const first = await ingestRuntimeTelemetry(options);
  const second = await ingestRuntimeTelemetry(options);
  assert.equal(first.appended, 3, "first-output evidence is persisted immediately as best-effort canonical execution evidence");
  assert.equal(first.coverage.malformed_or_oversized_lines, 1, "only token-count-shaped malformed input is parsed");
  assert.equal(second.appended, 0);
  assert.equal(second.coverage.skipped_existing, 3);
  assert.equal(sha256(input.source), before, "source session bytes must not change");
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type).sort(), ["execution.first_output", "task.started", "token.quota_snapshot", "token.usage"]);
  const usage = events.find((event) => event.type === "token.usage");
  assert.equal(usage.input_tokens, 11);
  assert.equal(usage.total_tokens, 16);
  assert.equal(usage.task_id, "task-opaque");
  assert.match(usage.execution_id, /^execution-[a-f0-9]{32}$/);
  assert.equal(usage.coverage_status, "complete");
  const firstOutput = events.find((event) => event.type === "execution.first_output");
  assert.equal(firstOutput.execution_id, usage.execution_id);
  assert.equal(firstOutput.occurred_at, "2026-07-28T00:00:01.000Z", "first output is timestamped from the positive per-turn output-token observation");
  assert.equal(firstOutput.evidence_class, "observed");
  assert.equal(firstOutput.evidence_authority, "runtime_metadata");
  assert.equal(firstOutput.coverage_status, "complete");
  const quota = events.find((event) => event.type === "token.quota_snapshot");
  assert.deepEqual(Object.keys(quota).sort(), ["coverage_status", "evidence_authority", "evidence_class", "event_id", "execution_id", "occurred_at", "project", "recorded_at", "reset_epoch_seconds", "schema_version", "source", "task_id", "type", "used_percent", "window_minutes"].sort());
  assert.equal(quota.used_percent, 27);
  assert.equal(quota.window_minutes, 300);
  assert.equal(quota.reset_epoch_seconds, 1_785_000_000);
  assert.equal(JSON.stringify(events).includes("never persist"), false);
  assert.equal(JSON.stringify(events).includes("999"), false, "cumulative snapshots are never imported");
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime ingestion refuses unbound or misattributed session transcripts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-binding-"));
  const input = fixture(root);
  const ledger = path.join(root, "events.jsonl");
  await assert.rejects(
    ingestRuntimeTelemetry({ sessionRoot: input.sessions, project: "alpha", ledger }),
    /requires --path.*and\/or --thread/
  );
  const mismatched = await ingestRuntimeTelemetry({
    sessionRoot: input.sessions,
    project: "alpha",
    projectPath: path.join(root, "other-project"),
    thread: "other-task",
    ledger
  });
  assert.equal(mismatched.appended, 0);
  assert.equal(fs.existsSync(ledger), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime ingestion treats bare subagent source as a root task and requires parent lineage for worker classification", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-main-start-"));
  const sessions = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  const ledger = path.join(root, "events.jsonl");
  fs.mkdirSync(sessions);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(sessions, "subagent.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:00.000Z", payload: { id: "subagent-session", session_id: "parent-task", cwd: projectRoot, thread_source: "subagent" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:01.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 7, total_tokens: 9 } } } })
  ].join("\n"));
  fs.writeFileSync(path.join(sessions, "main-late.jsonl"), JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:05.000Z", payload: { id: "main-late", session_id: "parent-task", cwd: projectRoot } }));
  fs.writeFileSync(path.join(sessions, "main-early.jsonl"), JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:03.000Z", payload: { id: "main-early", session_id: "parent-task", cwd: projectRoot, source: { subagent: false } } }));

  const options = { sessionRoot: sessions, project: "alpha", projectPath: projectRoot, thread: "parent-task", ledger };
  const result = await ingestRuntimeTelemetry(options);
  const repeated = await ingestRuntimeTelemetry(options);
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(result.coverage.task_started_projections, 1);
  assert.equal(events.filter((event) => event.type === "task.started").length, 1);
  assert.equal(events.find((event) => event.type === "task.started").occurred_at, "2026-07-28T00:00:00.000Z", "a root session_id with no parent remains task-level even when thread_source says subagent");
  assert.equal(events.find((event) => event.type === "token.usage").total_tokens, 9, "subagent token usage remains parent-task evidence");
  assert.equal(events.filter((event) => event.type === "seat.started").length, 0);
  assert.equal(events.filter((event) => event.type === "coverage.seat_intervals").length, 0);
  assert.equal(repeated.appended, 0, "main and subagent start projections are idempotent");
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime ingestion recognizes nested subagent metadata without fabricating task.started", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-subagent-only-"));
  const sessions = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  const ledger = path.join(root, "events.jsonl");
  fs.mkdirSync(sessions);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(sessions, "subagent-only.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:00.000Z", payload: { id: "subagent-only", session_id: "parent-task", cwd: projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: "parent-task" } } } } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:01.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 4, total_tokens: 6 } } } })
  ].join("\n"));

  const result = await ingestRuntimeTelemetry({ sessionRoot: sessions, project: "alpha", projectPath: projectRoot, thread: "parent-task", ledger });
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(result.coverage.task_started_projections, 0);
  assert.equal(events.filter((event) => event.type === "task.started").length, 0);
  assert.equal(events.find((event) => event.type === "token.usage").total_tokens, 6);
  assert.equal(events.filter((event) => event.type === "seat.started").length, 1);
  assert.equal(events.filter((event) => event.type === "seat.stopped").length, 0);
  const seatCoverage = events.find((event) => event.type === "coverage.seat_intervals");
  assert.equal(seatCoverage.outcome, "incomplete", "without an authoritative stop, utilization duration stays unavailable");
  assert.equal(seatCoverage.coverage_status, "partial");
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime ingestion treats direct parent lineage alone as a distinct worker session", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-direct-parent-"));
  const sessions = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  const ledger = path.join(root, "events.jsonl");
  fs.mkdirSync(sessions);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(sessions, "direct-parent.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:00.000Z", payload: { id: "child-direct", session_id: "parent-task", parent_thread_id: "parent-task", cwd: projectRoot } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:01.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 3, total_tokens: 5 } } } })
  ].join("\n"));

  const result = await ingestRuntimeTelemetry({ sessionRoot: sessions, project: "alpha", projectPath: projectRoot, thread: "parent-task", ledger });
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(result.coverage.task_started_projections, 0);
  assert.equal(events.filter((event) => event.type === "task.started").length, 0);
  assert.equal(events.filter((event) => event.type === "seat.started").length, 1);
  assert.match(events.find((event) => event.type === "seat.started").seat_id, /^runtime-[a-f0-9]{32}$/);
  assert.equal(events.find((event) => event.type === "token.usage").task_id, "parent-task");
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime ingestion preserves legacy same-seat starts while backfilling missing lifecycle facts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-seat-backfill-"));
  const sessions = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  const ledger = path.join(root, "events.jsonl");
  const seedLedger = path.join(root, "seed-events.jsonl");
  fs.mkdirSync(sessions);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(sessions, "parent.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:00.000Z", payload: { id: "parent-session", session_id: "parent-task", cwd: projectRoot } }),
    JSON.stringify({ type: "event_msg", payload: { type: "sub_agent_activity", kind: "started", agent_thread_id: "child-one", occurred_at_ms: Date.parse("2026-07-28T00:00:02.000Z") } }),
    JSON.stringify({ type: "event_msg", payload: { type: "sub_agent_activity", kind: "interrupted", agent_thread_id: "child-one", occurred_at_ms: Date.parse("2026-07-28T00:00:03.000Z") } })
  ].join("\n"));
  fs.writeFileSync(path.join(sessions, "child-one.jsonl"), JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:01.000Z", payload: { id: "child-one", session_id: "parent-task", parent_thread_id: "parent-task", cwd: projectRoot } }));
  fs.writeFileSync(path.join(sessions, "child-two.jsonl"), JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:04.000Z", payload: { id: "child-two", session_id: "parent-task", parent_thread_id: "parent-task", cwd: projectRoot } }));
  const options = { sessionRoot: sessions, project: "alpha", projectPath: projectRoot, thread: "parent-task" };
  await ingestRuntimeTelemetry({ ...options, ledger: seedLedger });
  const seedEvents = fs.readFileSync(seedLedger, "utf8").trim().split("\n").map(JSON.parse);
  const seededSeat = seedEvents.find((event) => event.type === "seat.stopped");
  fs.writeFileSync(ledger, `${JSON.stringify({ ...seededSeat, type: "seat.started", event_id: "legacy-seat-start", occurred_at: "2026-07-27T23:59:00.000Z", recorded_at: "2026-07-27T23:59:00.000Z" })}\n`);

  const result = await ingestRuntimeTelemetry({ ...options, ledger });
  const repeated = await ingestRuntimeTelemetry({ ...options, ledger });
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.filter((event) => event.type === "seat.started" && event.seat_id === seededSeat.seat_id).length, 1, "legacy same-seat start is retained without a timestamp-variant duplicate");
  assert.equal(events.filter((event) => event.type === "seat.started").length, 2, "a distinct missing worker seat still appends");
  assert.equal(events.filter((event) => event.type === "seat.stopped").length, 1, "stops remain independently appendable");
  assert.equal(events.filter((event) => event.type === "task.started").length, 1, "missing task start still appends");
  assert.ok(result.coverage.skipped_existing >= 1);
  assert.equal(repeated.appended, 0, "event-id idempotence remains intact after semantic backfill deduplication");
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime ingestion projects allowlisted worker lifecycle metadata without retaining collaboration content", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-lifecycle-"));
  const sessions = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  const ledger = path.join(root, "events.jsonl");
  fs.mkdirSync(sessions);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(sessions, "parent.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:00.000Z", payload: { id: "parent-session", session_id: "parent-task", cwd: projectRoot } }),
    JSON.stringify({ type: "event_msg", payload: { type: "sub_agent_activity", kind: "started", agent_thread_id: "child-one", occurred_at_ms: Date.parse("2026-07-28T00:00:01.000Z"), agent_path: "/private/path", event_id: "event-private" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "sub_agent_activity", kind: "started", agent_thread_id: "child-two", occurred_at_ms: Date.parse("2026-07-28T00:00:02.000Z") } }),
    JSON.stringify({ type: "event_msg", payload: { type: "sub_agent_activity", kind: "interrupted", agent_thread_id: "child-two", occurred_at_ms: Date.parse("2026-07-28T00:00:03.000Z") } })
  ].join("\n"));
  fs.writeFileSync(path.join(sessions, "child-one.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:01.000Z", payload: { id: "child-one", session_id: "parent-task", parent_thread_id: "parent-task", cwd: projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: "parent-task" } } } } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:05.000Z", payload: { type: "task_complete", last_agent_message: "never persist" } })
  ].join("\n"));
  fs.writeFileSync(path.join(sessions, "child-two.jsonl"), JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:02.000Z", payload: { id: "child-two", session_id: "parent-task", parent_thread_id: "parent-task", cwd: projectRoot } }));

  const first = await ingestRuntimeTelemetry({ sessionRoot: sessions, project: "alpha", projectPath: projectRoot, thread: "parent-task", ledger });
  const second = await ingestRuntimeTelemetry({ sessionRoot: sessions, project: "alpha", projectPath: projectRoot, thread: "parent-task", ledger });
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  const started = events.find((event) => event.type === "seat.started");
  const stopped = events.find((event) => event.type === "seat.stopped");
  assert.equal(first.coverage.seat_started_projections, 2);
  assert.equal(first.coverage.seat_stopped_projections, 2);
  assert.equal(first.coverage.observed_completion_projections, 1);
  assert.equal(second.appended, 0, "lifecycle projections are idempotent");
  assert.match(started.seat_id, /^runtime-[a-f0-9]{32}$/);
  assert.equal(stopped.seat_id, started.seat_id);
  const startedSeatIds = new Set(events.filter((event) => event.type === "seat.started").map((event) => event.seat_id));
  const stoppedSeatIds = new Set(events.filter((event) => event.type === "seat.stopped").map((event) => event.seat_id));
  assert.equal(startedSeatIds.size, 2, "distinct child UUIDs retain distinct opaque seat identities");
  assert.deepEqual(stoppedSeatIds, startedSeatIds, "parent activities pair with the observed child UUID identities");
  assert.equal(stopped.occurred_at, "2026-07-28T00:00:05.000Z");
  assert.equal(stopped.coverage_status, "partial", "a task_complete record without completed_at is first-observed completion");
  assert.equal(events.filter((event) => event.type === "seat.stopped" && event.coverage_status === "complete").length, 1, "timestamped interruption is an exact observed stop");
  assert.equal(events.find((event) => event.type === "coverage.seat_intervals").outcome, "incomplete");
  assert.equal(JSON.stringify(events).includes("never persist"), false);
  assert.equal(JSON.stringify(events).includes("private/path"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime ingestion streams oversized records without parsing them and resumes at the next valid token record", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-streaming-"));
  const sessions = path.join(root, "sessions");
  const projectRoot = path.join(root, "project");
  const ledger = path.join(root, "events.jsonl");
  fs.mkdirSync(sessions);
  fs.mkdirSync(projectRoot);
  const source = path.join(sessions, "long-lived.jsonl");
  const oversizedPayload = "x".repeat(1024 * 1024);
  fs.writeFileSync(source, [
    JSON.stringify({ type: "session_meta", timestamp: "2026-07-28T00:00:00.000Z", payload: { id: "stream-session", session_id: "stream-task", cwd: projectRoot } }),
    JSON.stringify({ type: "event_msg", payload: { type: "model" }, output: oversizedPayload }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count" }, output: oversizedPayload }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-07-28T00:00:01.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 7, total_tokens: 9 } } } })
  ].join("\n"));
  const before = sha256(source);

  const result = await ingestRuntimeTelemetry({
    sessionRoot: sessions,
    project: "alpha",
    projectPath: projectRoot,
    thread: "stream-task",
    ledger,
    now: new Date("2026-07-28T01:00:00.000Z")
  });

  assert.equal(result.coverage.malformed_or_oversized_lines, 2);
  assert.equal(result.appended, 2, "the following valid token line is ingested");
  assert.equal(sha256(source), before, "ingestion does not mutate the stable input fixture");
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.find((event) => event.type === "token.usage").total_tokens, 9);
  fs.rmSync(root, { recursive: true, force: true });
});

test("metrics ingest-runtime is quiet unless diagnostics are requested", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-cli-"));
  const input = fixture(root);
  const ledger = path.join(root, "events.jsonl");
  const quiet = execFileSync(process.execPath, [cli, "metrics", "ingest-runtime", "--session-root", input.sessions, "--project", "alpha", "--path", input.projectRoot, "--thread", "task-opaque", "--ledger", ledger], { encoding: "utf8" });
  assert.equal(quiet, "");
  const diagnostics = execFileSync(process.execPath, [cli, "metrics", "ingest-runtime", "--session-root", input.sessions, "--project", "alpha", "--path", input.projectRoot, "--thread", "task-opaque", "--ledger", ledger, "--diagnostics"], { encoding: "utf8" });
  assert.equal(JSON.parse(diagnostics).appended, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
