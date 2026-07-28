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
    seat_id: "security-review",
    model_critical: true,
    reasoning_critical: false,
    attempt: 1,
    objective: "Review authority",
    routing_reason: "Security review",
    weaker_insufficient: "Lower tier is insufficient for authority analysis",
    stronger_unnecessary: "Ultra is unnecessary"
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
  assert.doesNotMatch(fs.readFileSync(log, "utf8"), /SECRET_PROMPT|SECRET_OUTPUT/);
});
