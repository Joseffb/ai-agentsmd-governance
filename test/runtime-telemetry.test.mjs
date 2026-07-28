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
  assert.equal(first.appended, 3);
  assert.equal(first.coverage.malformed_or_oversized_lines, 1, "only token-count-shaped malformed input is parsed");
  assert.equal(second.appended, 0);
  assert.equal(second.coverage.skipped_existing, 3);
  assert.equal(sha256(input.source), before, "source session bytes must not change");
  const events = fs.readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type).sort(), ["task.started", "token.quota_snapshot", "token.usage"]);
  const usage = events.find((event) => event.type === "token.usage");
  assert.equal(usage.input_tokens, 11);
  assert.equal(usage.total_tokens, 16);
  assert.equal(usage.task_id, "task-opaque");
  assert.equal(usage.coverage_status, "complete");
  const quota = events.find((event) => event.type === "token.quota_snapshot");
  assert.deepEqual(Object.keys(quota).sort(), ["coverage_status", "evidence_authority", "evidence_class", "event_id", "occurred_at", "project", "recorded_at", "reset_epoch_seconds", "schema_version", "source", "task_id", "type", "used_percent", "window_minutes"].sort());
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

test("runtime ingestion aggregates subagent token use but projects the earliest genuine main task start once", async () => {
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
  assert.equal(events.find((event) => event.type === "task.started").occurred_at, "2026-07-28T00:00:03.000Z");
  assert.equal(events.find((event) => event.type === "token.usage").total_tokens, 9, "subagent token usage remains parent-task evidence");
  assert.equal(events.filter((event) => event.type === "seat.started").length, 1);
  assert.match(events.find((event) => event.type === "seat.started").seat_id, /^runtime-[a-f0-9]{32}$/);
  assert.equal(events.find((event) => event.type === "coverage.seat_intervals").outcome, "incomplete");
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
