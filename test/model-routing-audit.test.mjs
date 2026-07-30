import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { auditModelRouting } from "../lib/model-routing-audit.mjs";

test("model audit imports launch metadata without prompts or output", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-audit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parentId = "019f-parent";
  const agentId = "019f-agent";
  const parent = path.join(root, `rollout-${parentId}.jsonl`);
  const child = path.join(root, `rollout-${agentId}.jsonl`);
  const envelope = {
    schema_version: 1,
    seat_id: "seat-1",
    model_critical: true,
    reasoning_critical: false,
    attempt: 1,
    objective: "Review authority",
    routing_reason: "Security review",
    weaker_insufficient: "Lower tier is insufficient for authority analysis",
    stronger_unnecessary: "Ultra is unnecessary",
    composer_assignment: {
      schema_version: 1,
      bundle_path: "/private/tmp/orchestration-bundle.json",
      bundle_digest: `sha256:${"b".repeat(64)}`,
      worker_seat: 1,
      worker_assignment_ids: ["security-review"],
      worker_prompt_envelope_sha256: `sha256:${"d".repeat(64)}`,
      requested_model: "gpt-5.6-sol",
      requested_reasoning_raw: "xhigh",
      spark_gate: {
        work_kind: "mechanical_edit",
        requires_judgment: true,
        availability: "selectable",
        actual_availability: "Unverified",
        worker_required: true,
        excluded_effects: ["security"]
      },
      availability_evidence: "Unverified"
    }
  };
  fs.writeFileSync(parent, [
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "response_item",
      payload: {
        type: "function_call",
        name: "spawn_agent",
        call_id: "call-1",
        arguments: JSON.stringify({
          message: `MODEL_ROUTING_GATE_V1 ${JSON.stringify(envelope)}\nSECRET_PROMPT`,
          model: "gpt-5.6-sol",
          reasoning_effort: "xhigh",
          fork_context: false
        })
      }
    }),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: JSON.stringify({ agent_id: agentId, output: "SECRET_OUTPUT" })
      }
    })
  ].join("\n") + "\n");
  fs.writeFileSync(child, [
    JSON.stringify({ type: "session_meta", payload: { id: agentId, parent_thread_id: parentId } }),
    JSON.stringify({
      type: "turn_context",
      payload: {
        model: "gpt-5.6-sol",
        collaboration_mode: { settings: { reasoning_effort: "xhigh" } }
      }
    })
  ].join("\n") + "\n");
  const log = path.join(root, "events.jsonl");
  const result = await auditModelRouting({ threadId: parentId, sessionRoot: root, logFile: log, days: 14 });
  assert.equal(result.total_launches, 1);
  assert.equal(result.sol_xhigh_or_stronger.count, 1);
  assert.equal(result.model_mismatches, 0);
  assert.equal(result.proportionality_evidence_missing, 0);
  assert.equal(result.composer_bound_launches, 1);
  assert.equal(result.composer_assignment_mismatches, 0);
  assert.equal(result.spark_required_launches, 0);
  assert.equal(result.seats[0].expected_requested_model, "gpt-5.6-sol");
  assert.equal(result.seats[0].composer_bundle_digest, `sha256:${"b".repeat(64)}`);
  assert.doesNotMatch(fs.readFileSync(log, "utf8"), /SECRET_PROMPT|SECRET_OUTPUT/);
});

test("model audit observes omitted eligibility as ordinary Terra high without Spark authorization", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-audit-unexposed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parentId = "019f-parent-unexposed";
  const agentId = "019f-agent-unexposed";
  const envelope = {
    schema_version: 1,
    seat_id: "seat-1",
    model_critical: false,
    reasoning_critical: false,
    attempt: 1,
    composer_assignment: {
      schema_version: 1,
      bundle_path: "/private/tmp/orchestration-unexposed.json",
      bundle_digest: `sha256:${"c".repeat(64)}`,
      worker_seat: 1,
      worker_assignment_ids: ["unexposed-review"],
      worker_prompt_envelope_sha256: `sha256:${"e".repeat(64)}`,
      requested_model: "gpt-5.6-terra",
      requested_reasoning_raw: "high",
      spark_gate: {
        work_kind: "unexposed",
        requires_judgment: true,
        availability: "unknown_or_unexposed",
        actual_availability: "Unverified",
        worker_required: true,
        excluded_effects: []
      },
      availability_evidence: "Unverified"
    }
  };
  fs.writeFileSync(path.join(root, `rollout-${parentId}.jsonl`), [
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "response_item",
      payload: {
        type: "function_call",
        name: "spawn_agent",
        call_id: "call-unexposed",
        arguments: JSON.stringify({
          message: `MODEL_ROUTING_GATE_V1 ${JSON.stringify(envelope)}\nSECRET_UNEXPOSED_PROMPT`,
          model: "gpt-5.6-terra",
          reasoning_effort: "high"
        })
      }
    }),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-unexposed",
        output: JSON.stringify({ agent_id: agentId })
      }
    })
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(root, `rollout-${agentId}.jsonl`), [
    JSON.stringify({ type: "session_meta", payload: { id: agentId, parent_thread_id: parentId } }),
    JSON.stringify({
      type: "turn_context",
      payload: {
        model: "gpt-5.6-terra",
        collaboration_mode: { settings: { reasoning_effort: "high" } }
      }
    })
  ].join("\n") + "\n");
  const log = path.join(root, "events.jsonl");
  const result = await auditModelRouting({ threadId: parentId, sessionRoot: root, logFile: log, days: 14 });
  assert.equal(result.composer_bound_launches, 1);
  assert.equal(result.composer_assignment_mismatches, 0);
  assert.equal(result.spark_required_launches, 0);
  assert.equal(result.spark_fallback_launches, 0);
  assert.equal(result.seats[0].expected_requested_model, "gpt-5.6-terra");
  assert.doesNotMatch(fs.readFileSync(log, "utf8"), /SECRET_UNEXPOSED_PROMPT/);
});
