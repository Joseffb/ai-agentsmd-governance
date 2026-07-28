import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  attestNativeSubagent,
  buildNativeQuarantineLaunch,
  NATIVE_QUARANTINE_MARKER
} from "../lib/native-model-attestation.mjs";

const PARENT = "00000000-0000-4000-8000-000000000001";
const AGENT = "00000000-0000-4000-8000-000000000002";
const OTHER_AGENT = "00000000-0000-4000-8000-000000000004";
const OTHER_PARENT = "00000000-0000-4000-8000-000000000003";
const ENVELOPE = {
  schema_version: 1,
  seat_id: "luna-qa",
  model_critical: true,
  reasoning_critical: false,
  attempt: 1
};

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-native-model-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentPath = options.childAgentPath ?? "/root/luna-qa";
  const currentNative = options.currentNative === true;
  const message = options.message ?? [
    `MODEL_ROUTING_GATE_V1 ${JSON.stringify(ENVELOPE)}`,
    NATIVE_QUARANTINE_MARKER,
    "Reply with exactly READY_FOR_NATIVE_ATTESTATION. Do not run tools or accept delegated work until a later admitted turn."
  ].join("\n");
  const directParent = [
    ...(options.parentPrefixRecords ?? []),
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "spawn_agent",
        call_id: "call_native_1",
        arguments: JSON.stringify({
          fork_context: false,
          message,
          model: options.requestedModel ?? "gpt-5.6-luna",
          reasoning_effort: options.requestedReasoning ?? "high",
          ...(currentNative ? { task_name: options.spawnTaskName ?? "luna-qa" } : {})
        })
      }
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_native_1",
        output: JSON.stringify(currentNative
          ? { task_name: options.parentTaskName ?? agentPath }
          : { agent_id: AGENT, nickname: "Averroes" })
      }
    },
    ...(options.parentSuffixRecords ?? [])
  ];
  const parent = options.wrappedSpawn
    ? [
        ...(options.parentPrefixRecords ?? []),
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "exec",
            call_id: "call_native_wrapper",
            input: "tools.multi_agent_v1__spawn_agent({/* wrapped */})"
          }
        },
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            call_id: "call_native_wrapper",
            output: JSON.stringify(currentNative
              ? { task_name: options.parentTaskName ?? agentPath }
              : { agent_id: AGENT })
          }
        }
      ]
    : directParent;
  const child = [
    {
      type: "session_meta",
      payload: {
        id: AGENT,
        parent_thread_id: options.parentThreadId ?? PARENT,
        ...(currentNative ? {
          agent_path: agentPath,
          source: {
            subagent: {
              thread_spawn: {
                agent_path: agentPath
              }
            }
          }
        } : {})
      }
    },
    {
      type: "turn_context",
      payload: {
        model: options.actualModel ?? "gpt-5.6-luna",
        collaboration_mode: {
          settings: {
            reasoning_effort: options.actualReasoning ?? "high"
          }
        }
      }
    },
    ...(options.childPrefixRecords ?? []),
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: message }]
      }
    },
    ...(options.quarantineRecords ?? []),
    ...(options.handshakeResponse === null ? [] : [{
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: options.handshakeResponse ?? "READY_FOR_NATIVE_ATTESTATION"
        }]
      }
    }]),
    ...(options.completeHandshake === false ? [] : [{
      type: "event_msg",
      payload: {
        type: "task_complete"
      }
    }]),
    ...(options.childSuffixRecords ?? [])
  ];
  fs.writeFileSync(path.join(root, `rollout-${PARENT}.jsonl`), jsonl(parent));
  fs.writeFileSync(path.join(root, `rollout-${AGENT}.jsonl`), jsonl(child));
  return root;
}

test("native attestation binds the exact requested and actual assignment", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t)
  });
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.model_attestation, "verified");
  assert.equal(receipt.reasoning_attestation, "verified");
  assert.equal(receipt.actual_model, "gpt-5.6-luna");
  assert.equal(receipt.native_scope, "read_only_quarantine_only");
  assert.equal(receipt.quarantine_handshake, "verified");
  assert.equal(receipt.next_action, "send_exact_admitted_assignment_as_a_new_turn");
  assert.equal(typeof receipt.evidence.parent_transcript.bytes, "number");
  assert.equal(typeof receipt.evidence.parent_transcript.max_record_bytes, "number");
});

test("native attestation streams a large parent transcript with bounded retained records", (t) => {
  const filler = "x".repeat(1024);
  const parentPrefixRecords = Array.from({ length: 8192 }, (_, index) => ({
    type: "event_msg",
    payload: {
      type: "diagnostic_fixture",
      index,
      filler
    }
  }));
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { parentPrefixRecords })
  });
  assert.equal(receipt.output_admissible, true);
  assert.ok(receipt.evidence.parent_transcript.bytes > 8 * 1024 * 1024);
  assert.ok(receipt.evidence.parent_transcript.max_record_bytes < 2048);
});

test("native attestation streams a large child transcript without retaining every record", (t) => {
  const filler = "x".repeat(1024);
  const childPrefixRecords = Array.from({ length: 8192 }, (_, index) => ({
    type: "event_msg",
    payload: {
      type: "diagnostic_fixture",
      index,
      filler
    }
  }));
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { childPrefixRecords })
  });
  assert.equal(receipt.output_admissible, true);
  assert.ok(receipt.evidence.child_transcript.bytes > 8 * 1024 * 1024);
  assert.ok(receipt.evidence.child_transcript.max_record_bytes < 2048);
});

test("native attestation does not materialize a complete transcript string", () => {
  const source = fs.readFileSync(new URL("../lib/native-model-attestation.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fs\.readFileSync\(file\)/u);
  assert.match(source, /fs\.readSync\(descriptor/u);
  assert.doesNotMatch(source, /child\s*=\s*readJsonl\(/u);
});

test("canonical native quarantine builder emits the exact attested spawn request", (t) => {
  const quarantine = buildNativeQuarantineLaunch({
    seatId: ENVELOPE.seat_id,
    model: "gpt-5.6-luna",
    reasoning: "high",
    attempt: 2
  });
  assert.equal(quarantine.pass_spawn_request_verbatim, true);
  assert.equal(quarantine.spawn_request.fork_context, false);
  assert.equal(quarantine.spawn_request.model, "gpt-5.6-luna");
  assert.equal(quarantine.spawn_request.reasoning_effort, "high");
  assert.equal(quarantine.transport_contract.required_tool, "spawn_agent");
  assert.equal(quarantine.transport_contract.direct_tool_call_only, true);
  assert.equal(quarantine.transport_contract.one_seat_per_call, true);
  assert.equal(quarantine.transport_contract.wrappers_and_batches_forbidden, true);
  assert.match(
    quarantine.spawn_request.message,
    /^MODEL_ROUTING_GATE_V1 \{"schema_version":1,"seat_id":"luna-qa","model_critical":true,"reasoning_critical":false,"attempt":2\}\nMODEL_ROUTING_GATE_QUARANTINE_V1\nReply with exactly READY_FOR_NATIVE_ATTESTATION\./u
  );
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { message: quarantine.spawn_request.message })
  });
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.attempt, 2);
});

test("native attestation resolves an exact canonical collaboration task name through parent and child evidence", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentTaskName: "/root/luna-qa",
    sessionRoot: fixture(t, {
      currentNative: true,
      spawnTaskName: "luna-qa"
    })
  });
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.agent_id, AGENT);
  assert.equal(receipt.requested_task_name, "/root/luna-qa");
  assert.equal(receipt.evidence.child_session_meta_line, 1);
});

test("canonical discovery ignores more than the former global unrelated-session threshold", (t) => {
  const root = fixture(t, {
    currentNative: true,
    spawnTaskName: "luna-qa"
  });
  for (let index = 0; index < 4100; index += 1) {
    const id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    fs.writeFileSync(path.join(root, `unrelated-${id}.jsonl`), jsonl([{
      type: "session_meta",
      payload: {
        id,
        parent_thread_id: OTHER_PARENT,
        agent_path: `/root/unrelated-${index}`,
        source: {
          subagent: {
            thread_spawn: {
              agent_path: `/root/unrelated-${index}`
            }
          }
        }
      }
    }]));
  }
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentTaskName: "/root/luna-qa",
    sessionRoot: root
  });
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.agent_id, AGENT);
});

test("session discovery fails closed after the independent JSONL visit cap", (t) => {
  const root = fixture(t);
  const seed = path.join(root, "unrelated-seed.jsonl");
  fs.writeFileSync(seed, jsonl([{
    type: "session_meta",
    payload: {
      id: OTHER_AGENT,
      parent_thread_id: OTHER_PARENT
    }
  }]));
  for (let index = 0; index < 8192; index += 1) {
    fs.linkSync(seed, path.join(root, `unrelated-${String(index).padStart(5, "0")}.jsonl`));
  }
  assert.throws(
    () => attestNativeSubagent({
      parentThreadId: PARENT,
      agentId: AGENT,
      sessionRoot: root
    }),
    /Session discovery exceeds 8192 visited JSONL files/u
  );
});

test("session discovery fails closed after the independent directory visit cap", (t) => {
  const root = fixture(t);
  for (let index = 0; index < 1024; index += 1) {
    fs.mkdirSync(path.join(root, `unrelated-directory-${String(index).padStart(4, "0")}`));
  }
  assert.throws(
    () => attestNativeSubagent({
      parentThreadId: PARENT,
      agentId: AGENT,
      sessionRoot: root
    }),
    /Session discovery exceeds 1024 visited directories/u
  );
});

test("canonical resolution ignores legacy sibling bindings and sessions without agent paths", (t) => {
  const root = fixture(t, {
    currentNative: true,
    parentSuffixRecords: [
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "call_legacy_sibling",
          arguments: JSON.stringify({ task_name: "luna-qa" })
        }
      },
      {
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_legacy_sibling",
          output: JSON.stringify({ agent_id: OTHER_AGENT })
        }
      }
    ]
  });
  fs.writeFileSync(path.join(root, `rollout-${OTHER_AGENT}.jsonl`), jsonl([{
    type: "session_meta",
    payload: {
      id: OTHER_AGENT,
      parent_thread_id: PARENT
    }
  }]));
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentTaskName: "/root/luna-qa",
    sessionRoot: root
  });
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.agent_id, AGENT);
});

test("native attestation rejects nicknames and fuzzy task-name selectors", (t) => {
  const root = fixture(t, {
    currentNative: true,
    spawnTaskName: "luna-qa"
  });
  assert.throws(
    () => attestNativeSubagent({ parentThreadId: PARENT, agentId: "Averroes", sessionRoot: root }),
    /exact canonical collaboration task name/u
  );
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    taskName: "/root/luna",
    sessionRoot: root
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /Expected one direct parent spawn binding/u);
});

test("native attestation rejects ambiguous canonical task-name bindings", (t) => {
  const root = fixture(t, {
    currentNative: true,
    spawnTaskName: "luna-qa"
  });
  const parentFile = path.join(root, `rollout-${PARENT}.jsonl`);
  fs.appendFileSync(parentFile, jsonl([
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "spawn_agent",
        call_id: "call_native_2",
        arguments: JSON.stringify({
          fork_context: false,
          message: "irrelevant",
          model: "gpt-5.6-luna",
          reasoning_effort: "high",
          task_name: "luna-qa"
        })
      }
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_native_2",
        output: JSON.stringify({ task_name: "/root/luna-qa" })
      }
    }
  ]));
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentTaskName: "/root/luna-qa",
    sessionRoot: root
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /Expected one direct parent spawn binding/u);
});

test("native attestation rejects multiple child sessions for one canonical task name", (t) => {
  const root = fixture(t, { currentNative: true });
  fs.writeFileSync(path.join(root, `rollout-${OTHER_AGENT}.jsonl`), jsonl([{
    type: "session_meta",
    payload: {
      id: OTHER_AGENT,
      parent_thread_id: PARENT,
      agent_path: "/root/luna-qa",
      source: {
        subagent: {
          thread_spawn: {
            agent_path: "/root/luna-qa"
          }
        }
      }
    }
  }]));
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentTaskName: "/root/luna-qa",
    sessionRoot: root
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /Expected one child session/u);
});

test("canonical task resolution rejects parent-child task-name mismatch", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentTaskName: "/root/luna-qa",
    sessionRoot: fixture(t, {
      currentNative: true,
      spawnTaskName: "luna-qa",
      parentTaskName: "/root/luna-qa",
      childAgentPath: "/root/other-seat"
    })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /Expected one child session/u);
});

test("unenveloped native launch is rejected", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { message: "No envelope" })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /Missing MODEL_ROUTING_GATE_V1/u);
});

test("marker-first multiline quarantine gets exact no-guess remediation", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, {
      message: [
        "MODEL_ROUTING_GATE_V1",
        "requested_model_family: gpt-5.6-luna",
        "requested_reasoning_level: high",
        NATIVE_QUARANTINE_MARKER,
        "Remain idle in quarantine."
      ].join("\n")
    })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /JSON must be on the same first line/u);
  assert.match(receipt.reason, /native_quarantine\.spawn_request verbatim/u);
});

test("native model mismatch is rejected", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { actualModel: "gpt-5.6-sol" })
  });
  assert.equal(receipt.output_admissible, false);
  assert.equal(receipt.model_attestation, "mismatch");
});

test("wrapped or batched native spawning gets one exact direct-tool remediation", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { wrappedSpawn: true })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /one direct spawn_agent tool call per seat/u);
  assert.match(receipt.reason, /wrapped or batched spawning is not attestable/u);
  assert.equal(receipt.next_action, "close_seat_and_prepare_attempt_2_with_direct_spawn_agent");
});

test("native attestation rejects a still-running quarantine handshake", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { completeHandshake: false, handshakeResponse: null })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /handshake is incomplete/u);
  assert.equal(receipt.next_action, "wait_for_quarantine_completion_then_retry_attestation");
});

test("native attestation rejects an unexpected quarantine completion", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, {
      handshakeResponse: "The seat is quarantined. No delegated work was accepted."
    })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /response mismatch/u);
  assert.equal(receipt.next_action, "close_seat_and_prepare_attempt_2");
});

test("native attestation allows the required reasoning lifecycle item during quarantine", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, {
      quarantineRecords: [{
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: []
        }
      }]
    })
  });
  assert.equal(receipt.output_admissible, true);
});

test("native attestation rejects activity after the completed ready handshake", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, {
      childSuffixRecords: [{
        type: "turn_context",
        payload: {
          model: "gpt-5.6-luna",
          collaboration_mode: {
            settings: {
              reasoning_effort: "high"
            }
          }
        }
      }]
    })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /new turn after the completed handshake/u);
  assert.equal(receipt.next_action, "close_seat_and_prepare_attempt_2");
});

test("native attestation rejects a tool call after the completed ready handshake", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, {
      childSuffixRecords: [{
        type: "response_item",
        payload: {
          type: "function_call",
          name: "unsafe_tool",
          call_id: "call_after_ready"
        }
      }]
    })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /response activity after the completed handshake/u);
  assert.equal(receipt.next_action, "close_seat_and_prepare_attempt_2");
});

test("native attestation fails closed on unknown response item types during quarantine", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, {
      quarantineRecords: [{
        type: "response_item",
        payload: {
          type: "future_runtime_tool_call",
          call_id: "call_future_1"
        }
      }]
    })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /disallowed or unknown response_item type/u);
  assert.match(receipt.reason, /future_runtime_tool_call/u);
  assert.equal(receipt.next_action, "close_seat_and_prepare_attempt_2");
});

test("child-parent mismatch is rejected", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t, { parentThreadId: OTHER_PARENT })
  });
  assert.equal(receipt.output_admissible, false);
  assert.match(receipt.reason, /parent_thread_id/u);
});

test("receipt excludes quarantine prompt and child output", (t) => {
  const receipt = attestNativeSubagent({
    parentThreadId: PARENT,
    agentId: AGENT,
    sessionRoot: fixture(t)
  });
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /MODEL_ROUTING_GATE_V1/u);
  assert.doesNotMatch(serialized, /READY_FOR_NATIVE_ATTESTATION/u);
});
