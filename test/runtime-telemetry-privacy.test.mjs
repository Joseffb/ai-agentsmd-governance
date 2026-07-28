import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metrics = fs.readFileSync(path.join(root, "docs", "agent-metrics.md"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

test("runtime telemetry contract confines ingestion to the allowlisted one-stream family", () => {
  assert.match(metrics, /one-stream, typed-family/i);
  assert.match(metrics, /`session_meta`/);
  assert.match(metrics, /`token_count`/);
  assert.match(metrics, /Unknown record families and fields are discarded/);
  assert.match(metrics, /never created, modified, truncated, renamed, or deleted/i);
  assert.match(metrics, /append-only, private local ledger/i);
  assert.match(metrics, /idempotency key/i);
});

test("runtime telemetry contract preserves unknown tokens and bounded projections", () => {
  assert.match(metrics, /exact values when observed/i);
  assert.match(metrics, /is `null`, with explicit coverage/i);
  assert.match(metrics, /\*\*Runtime\*\*, \*\*Work\*\*, \*\*Token\*\*, \*\*Acceptance\*\*, and\s+\*\*Utilization\*\*/);
  assert.match(metrics, /do not inflate task, acceptance, validation, or product-quality failure counts/i);
  assert.match(metrics, /Raw local machine paths remain local-only/i);
});

test("runtime telemetry contract prohibits task-control and external effects", () => {
  assert.match(readme, /cannot inject context/i);
  assert.match(readme, /send a task message/i);
  assert.match(readme, /network/i);
  assert.match(readme, /report automatically/i);
  assert.match(readme, /execution from a metric/i);
  assert.match(metrics, /no authority to inject context/i);
  assert.match(metrics, /send task messages/i);
  assert.match(metrics, /make network calls/i);
  assert.match(metrics, /create automatic reports/i);
  assert.match(metrics, /execution from a metric/i);
  assert.match(metrics, /create or accept a handoff/i);
});

test("runtime telemetry API exposes an idempotent pure ingestion boundary", async () => {
  const runtimeTelemetry = await import("../lib/runtime-telemetry.mjs");
  assert.equal(typeof runtimeTelemetry.ingestRuntimeTelemetry, "function");
});
