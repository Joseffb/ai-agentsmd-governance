import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  ENVELOPE_PREFIX,
  processHook,
  readAgentReceipt,
  receiptPathForAgent,
  routingEventLogPath
} from "../scripts/model-routing-gate.mjs";

const sessionId = "thread-model-gate-test";
const pluginRoot = path.resolve(import.meta.dirname, "..");
const hookLauncher = path.join(pluginRoot, "scripts", "model-routing-gate-hook.sh");

function root(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-gate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fakeNode(directory, name, behavior = "healthy") {
  const file = path.join(directory, name);
  const probe = {
    healthy: "printf '%s\\n' 22.0.0; exit 0",
    versionOnly: "exit 0",
    malformed: "printf '%s\\n' invalid; exit 0",
    old: "printf '%s\\n' 18.20.0; exit 0",
    dyld: "printf '%s\\n' dyld-failure >&2; exit 1",
    broken: "exit 1"
  }[behavior];
  fs.writeFileSync(file, `#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  printf '%s\\n' v22.0.0\n  exit 0\nfi\nif [ \"$1\" = \"-p\" ] && [ \"$2\" = \"process.versions.node\" ]; then\n  ${probe}\nfi\nprintf '%s\\n' \"$0|$*\" > \"$MODEL_ROUTING_GATE_TEST_LOG\"\nprintf '%s\\n' fake-node-stdout\nprintf '%s\\n' fake-node-stderr >&2\ncat\nexit \"\${MODEL_ROUTING_GATE_TEST_EXIT:-0}\"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function message(seat, options = {}) {
  const envelope = {
    schema_version: 1,
    seat_id: seat,
    model_critical: options.modelCritical ?? true,
    reasoning_critical: options.reasoningCritical ?? false,
    attempt: options.attempt ?? 1
  };
  return `${ENVELOPE_PREFIX}${JSON.stringify(envelope)}\nPerform only the assigned bounded objective. SECRET_PROMPT_TEXT`;
}

function pre(stateRoot, toolUseId, seat, options = {}) {
  return processHook({
    session_id: options.sessionId || sessionId,
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_use_id: toolUseId,
    tool_input: {
      message: options.rawMessage ?? message(seat, options),
      model: options.model,
      reasoning_effort: options.reasoning,
      ...(options.agentId ? { agent_id: options.agentId } : {})
    }
  }, { stateRoot });
}

function post(stateRoot, toolUseId, agentId, options = {}) {
  return processHook({
    session_id: options.sessionId || sessionId,
    hook_event_name: "PostToolUse",
    tool_name: "Agent",
    tool_use_id: toolUseId,
    tool_input: {},
    tool_response: { agent_id: agentId, nickname: "ignored" }
  }, { stateRoot });
}

function start(stateRoot, agentId, model, options = {}) {
  return processHook({
    session_id: options.sessionId || sessionId,
    hook_event_name: "SubagentStart",
    agent_id: agentId,
    agent_type: "default",
    model,
    ...(options.actualReasoning ? { reasoning_effort: options.actualReasoning } : {})
  }, { stateRoot });
}

function wait(stateRoot, ids, options = {}) {
  return processHook({
    session_id: options.sessionId || sessionId,
    hook_event_name: "PreToolUse",
    tool_name: "wait_agent",
    tool_use_id: `wait-${ids.join("-")}`,
    tool_input: { ids }
  }, { stateRoot });
}

function acceptedLaunch(stateRoot, toolUseId, agentId, seat, model = "gpt-5.6-terra", reasoning = "high", options = {}) {
  assert.equal(pre(stateRoot, toolUseId, seat, { model, reasoning, ...options }).hookSpecificOutput.permissionDecision, "allow");
  start(stateRoot, agentId, model, options);
  post(stateRoot, toolUseId, agentId, options);
  return readAgentReceipt(stateRoot, options.sessionId || sessionId, agentId);
}

test("direct ungoverned Agent launch is blocked", (t) => {
  const state = root(t);
  const result = pre(state, "t1", "seat", { rawMessage: "No envelope", model: "gpt-5.6-terra", reasoning: "high" });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
});

test("missing exact model is blocked instead of inheriting", (t) => {
  const result = pre(root(t), "t2", "seat", { reasoning: "high" });
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /Exact runtime model ID/);
});

test("literal Inherit current model is blocked", (t) => {
  const result = pre(root(t), "t3", "seat", { model: "Inherit current", reasoning: "high" });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
});

test("missing exact reasoning is blocked instead of inheriting", (t) => {
  const result = pre(root(t), "t4", "seat", { model: "gpt-5.6-terra" });
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /Exact raw reasoning/);
});

test("unsupported family alias is blocked", (t) => {
  const result = pre(root(t), "t5", "seat", { model: "Terra", reasoning: "high" });
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /Unsupported exact runtime model ID/);
});

test("unsupported reasoning for the requested model is blocked", (t) => {
  const result = pre(root(t), "t6", "seat", { model: "gpt-5.3-codex-spark", reasoning: "ultra" });
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /Unsupported reasoning/);
});

test("Terra launch request records exact assignment before launch", (t) => {
  const state = root(t);
  const result = pre(state, "t7", "terra-seat", { model: "gpt-5.6-terra", reasoning: "xhigh" });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  const files = fs.readdirSync(path.join(state, "sessions"), { recursive: true });
  assert.ok(files.some((file) => String(file).includes("attempts")));
});

test("Sol launch request accepts exact high assignment", (t) => {
  const result = pre(root(t), "t8", "sol-seat", { model: "gpt-5.6-sol", reasoning: "high" });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
});

test("matching runtime model produces an admissible receipt", (t) => {
  const state = root(t);
  const receipt = acceptedLaunch(state, "t9", "a9", "match");
  assert.equal(receipt.model_attestation, "verified");
  assert.equal(receipt.output_admissible, true);
});

test("runtime model mismatch rejects the seat and requires close", (t) => {
  const state = root(t);
  pre(state, "t10", "mismatch", { model: "gpt-5.6-terra", reasoning: "high" });
  start(state, "a10", "gpt-5.6-sol");
  post(state, "t10", "a10");
  const receipt = readAgentReceipt(state, sessionId, "a10");
  assert.equal(receipt.status, "rejected");
  assert.equal(receipt.close_required, true);
  assert.equal(wait(state, ["a10"]).hookSpecificOutput.permissionDecision, "deny");
});

test("ordinary model-critical seat preserves unverified reasoning and passes", (t) => {
  const receipt = acceptedLaunch(root(t), "t11", "a11", "ordinary", "gpt-5.6-terra", "xhigh");
  assert.equal(receipt.actual_reasoning_raw, "Unverified");
  assert.equal(receipt.reasoning_attestation, "configured_not_runtime_attested");
  assert.equal(receipt.output_admissible, true);
});

test("reasoning-critical seat rejects unavailable runtime reasoning", (t) => {
  const state = root(t);
  pre(state, "t12", "reasoning-critical", {
    model: "gpt-5.6-sol",
    reasoning: "xhigh",
    reasoningCritical: true
  });
  start(state, "a12", "gpt-5.6-sol");
  post(state, "t12", "a12");
  assert.equal(readAgentReceipt(state, sessionId, "a12").output_admissible, false);
});

test("future authoritative reasoning match is verified", (t) => {
  const state = root(t);
  const receipt = acceptedLaunch(state, "t13", "a13", "reasoning-match", "gpt-5.6-sol", "xhigh", {
    reasoningCritical: true,
    actualReasoning: "xhigh"
  });
  assert.equal(receipt.reasoning_attestation, "verified");
  assert.equal(receipt.output_admissible, true);
});

test("authoritative reasoning mismatch rejects the seat", (t) => {
  const state = root(t);
  pre(state, "t14", "reasoning-mismatch", { model: "gpt-5.6-sol", reasoning: "xhigh" });
  start(state, "a14", "gpt-5.6-sol", { actualReasoning: "high" });
  post(state, "t14", "a14");
  assert.equal(readAgentReceipt(state, sessionId, "a14").reasoning_attestation, "mismatch");
  assert.equal(wait(state, ["a14"]).hookSpecificOutput.permissionDecision, "deny");
});

test("missing SubagentStart evidence remains pending and blocks wait", (t) => {
  const state = root(t);
  pre(state, "t15", "missing-start", { model: "gpt-5.6-terra", reasoning: "high" });
  post(state, "t15", "a15");
  assert.equal(readAgentReceipt(state, sessionId, "a15").status, "pending_runtime_evidence");
  assert.equal(wait(state, ["a15"]).hookSpecificOutput.permissionDecision, "deny");
});

test("concurrent launches correlate by tool and agent ids, not order", (t) => {
  const state = root(t);
  pre(state, "t16a", "terra-concurrent", { model: "gpt-5.6-terra", reasoning: "high" });
  pre(state, "t16b", "sol-concurrent", { model: "gpt-5.6-sol", reasoning: "high" });
  start(state, "a16b", "gpt-5.6-sol");
  start(state, "a16a", "gpt-5.6-terra");
  post(state, "t16a", "a16a");
  post(state, "t16b", "a16b");
  assert.equal(readAgentReceipt(state, sessionId, "a16a").seat_id, "terra-concurrent");
  assert.equal(readAgentReceipt(state, sessionId, "a16b").seat_id, "sol-concurrent");
});

test("duplicate tool correlation is rejected", (t) => {
  const state = root(t);
  pre(state, "t17", "duplicate", { model: "gpt-5.6-terra", reasoning: "high" });
  const duplicate = pre(state, "t17", "duplicate", { model: "gpt-5.6-terra", reasoning: "high" });
  assert.match(duplicate.hookSpecificOutput.permissionDecisionReason, /Duplicate or stale/);
});

test("stale agent binding cannot be reassigned to another launch", (t) => {
  const state = root(t);
  pre(state, "t18a", "first", { model: "gpt-5.6-terra", reasoning: "high" });
  pre(state, "t18b", "second", { model: "gpt-5.6-sol", reasoning: "high" });
  start(state, "a18", "gpt-5.6-terra");
  post(state, "t18a", "a18");
  const result = post(state, "t18b", "a18");
  assert.match(result.reason, /Duplicate or stale agent correlation/);
});

test("reuse requires the same accepted seat, model, and reasoning", (t) => {
  const state = root(t);
  acceptedLaunch(state, "t19", "a19", "reusable", "gpt-5.6-terra", "high");
  const compatible = pre(state, "t19-reuse", "reusable", {
    model: "gpt-5.6-terra",
    reasoning: "high",
    agentId: "a19"
  });
  assert.equal(compatible.hookSpecificOutput.permissionDecision, "allow");
  const incompatible = pre(state, "t19-bad", "reusable", {
    model: "gpt-5.6-sol",
    reasoning: "high",
    agentId: "a19"
  });
  assert.equal(incompatible.hookSpecificOutput.permissionDecision, "deny");
});

test("one governed relaunch is allowed and a second mismatch blocks the seat", (t) => {
  const state = root(t);
  pre(state, "t20a", "retry-seat", { model: "gpt-5.6-terra", reasoning: "high" });
  start(state, "a20a", "gpt-5.6-sol");
  post(state, "t20a", "a20a");
  assert.equal(pre(state, "t20b", "retry-seat", {
    model: "gpt-5.6-terra",
    reasoning: "high",
    attempt: 2
  }).hookSpecificOutput.permissionDecision, "allow");
  start(state, "a20b", "gpt-5.6-sol");
  post(state, "t20b", "a20b");
  assert.equal(readAgentReceipt(state, sessionId, "a20b").status, "blocked_runtime_routing_defect");
  const third = pre(state, "t20c", "retry-seat", {
    model: "gpt-5.6-terra",
    reasoning: "high",
    attempt: 2
  });
  assert.equal(third.hookSpecificOutput.permissionDecision, "deny");
});

test("receipt excludes prompts, nickname, and model output", (t) => {
  const state = root(t);
  acceptedLaunch(state, "t21", "a21", "redacted");
  const text = fs.readFileSync(receiptPathForAgent(state, sessionId, "a21"), "utf8");
  assert.doesNotMatch(text, /SECRET_PROMPT_TEXT|ignored|Perform only/);
});

test("non-critical seat still requires explicit assignment and runtime model match", (t) => {
  const state = root(t);
  const receipt = acceptedLaunch(state, "t22", "a22", "noncritical", "gpt-5.6-luna", "medium", {
    modelCritical: false
  });
  assert.equal(receipt.status, "accepted_non_critical");
  assert.equal(receipt.output_admissible, true);
});

test("launch lifecycle appends private metadata without prompt or output", (t) => {
  const state = root(t);
  acceptedLaunch(state, "t23", "a23", "logged", "gpt-5.6-terra", "high");
  processHook({
    session_id: sessionId,
    hook_event_name: "SubagentStop",
    agent_id: "a23"
  }, { stateRoot: state });
  const text = fs.readFileSync(routingEventLogPath(state), "utf8");
  assert.match(text, /"event_type":"launch_requested"/);
  assert.match(text, /"event_type":"runtime_attestation"/);
  assert.match(text, /"event_type":"seat_stopped"/);
  assert.doesNotMatch(text, /SECRET_PROMPT_TEXT|ignored|Perform only/);
});

test("hook launcher falls through a broken PATH node to healthy Volta", (t) => {
  const directory = root(t);
  const pathBin = path.join(directory, "path-bin");
  const voltaBin = path.join(directory, "volta", "bin");
  fs.mkdirSync(pathBin, { recursive: true });
  fs.mkdirSync(voltaBin, { recursive: true });
  fakeNode(pathBin, "node", "broken");
  const healthy = fakeNode(voltaBin, "node");
  const log = path.join(directory, "node.log");
  const result = spawnSync("/bin/sh", [hookLauncher, "hook", "argument"], {
    input: "hook-input",
    encoding: "utf8",
    env: { ...process.env, HOME: directory, PATH: `${pathBin}:/usr/bin:/bin`, VOLTA_HOME: path.join(directory, "volta"), MODEL_ROUTING_GATE_TEST_LOG: log }
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "fake-node-stdout\nhook-input");
  assert.equal(result.stderr, "fake-node-stderr\n");
  assert.match(fs.readFileSync(log, "utf8"), new RegExp(`^${healthy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|.*model-routing-gate\\.mjs hook argument`));
});

test("hook launcher falls through a broken explicit override", (t) => {
  const directory = root(t);
  const voltaBin = path.join(directory, "volta", "bin");
  fs.mkdirSync(voltaBin, { recursive: true });
  const broken = fakeNode(directory, "broken-node", "broken");
  const healthy = fakeNode(voltaBin, "node");
  const log = path.join(directory, "node.log");
  const result = spawnSync("/bin/sh", [hookLauncher, "hook"], {
    encoding: "utf8",
    env: { ...process.env, HOME: directory, PATH: "/usr/bin:/bin", MODEL_ROUTING_GATE_NODE: broken, VOLTA_HOME: path.join(directory, "volta"), MODEL_ROUTING_GATE_TEST_LOG: log }
  });
  assert.equal(result.status, 0);
  assert.match(fs.readFileSync(log, "utf8"), new RegExp(`^${healthy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|`));
});

test("hook launcher gives a healthy explicit override priority", (t) => {
  const directory = root(t);
  const voltaBin = path.join(directory, "volta", "bin");
  fs.mkdirSync(voltaBin, { recursive: true });
  const explicit = fakeNode(directory, "explicit-node");
  fakeNode(voltaBin, "node");
  const log = path.join(directory, "node.log");
  const result = spawnSync("/bin/sh", [hookLauncher, "hook"], {
    encoding: "utf8",
    env: { ...process.env, HOME: directory, PATH: "/usr/bin:/bin", MODEL_ROUTING_GATE_NODE: explicit, VOLTA_HOME: path.join(directory, "volta"), MODEL_ROUTING_GATE_TEST_LOG: log }
  });
  assert.equal(result.status, 0);
  assert.match(fs.readFileSync(log, "utf8"), new RegExp(`^${explicit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|`));
});

test("hook launcher rejects semantically invalid candidates and falls through", (t) => {
  const directory = root(t);
  const voltaBin = path.join(directory, "volta", "bin");
  fs.mkdirSync(voltaBin, { recursive: true });
  const healthy = fakeNode(voltaBin, "node");
  const candidates = [
    ["/usr/bin/true", "true"],
    [fakeNode(directory, "version-only", "versionOnly"), "version-only"],
    [fakeNode(directory, "malformed", "malformed"), "malformed"],
    [fakeNode(directory, "old", "old"), "old"],
    [fakeNode(directory, "dyld", "dyld"), "dyld"]
  ];
  const nonExecutable = fakeNode(directory, "non-executable");
  fs.chmodSync(nonExecutable, 0o644);
  candidates.push([nonExecutable, "non-executable"]);
  for (const [candidate, label] of candidates) {
    const log = path.join(directory, `${label}.log`);
    const result = spawnSync("/bin/sh", [hookLauncher, "hook"], {
      encoding: "utf8",
      env: { ...process.env, HOME: directory, PATH: "/usr/bin:/bin", MODEL_ROUTING_GATE_NODE: candidate, VOLTA_HOME: path.join(directory, "volta"), MODEL_ROUTING_GATE_TEST_LOG: log }
    });
    assert.equal(result.status, 0, label);
    assert.match(fs.readFileSync(log, "utf8"), new RegExp(`^${healthy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|`), label);
  }
});

test("hook launcher prefers Volta, then NVM, then PATH in order", (t) => {
  const directory = root(t);
  const voltaBin = path.join(directory, "volta", "bin");
  const nvmBin = path.join(directory, "nvm", "bin");
  const pathBin = path.join(directory, "path-bin");
  fs.mkdirSync(voltaBin, { recursive: true });
  fs.mkdirSync(nvmBin, { recursive: true });
  fs.mkdirSync(pathBin, { recursive: true });
  const volta = fakeNode(voltaBin, "node");
  const nvm = fakeNode(nvmBin, "node");
  const pathNode = fakeNode(pathBin, "node");
  for (const [label, environment, expected] of [
    ["volta", {}, volta],
    ["nvm", { VOLTA_HOME: path.join(directory, "missing-volta") }, nvm],
    ["path", { VOLTA_HOME: path.join(directory, "missing-volta"), NVM_BIN: path.join(directory, "missing-nvm") }, pathNode]
  ]) {
    const log = path.join(directory, `${label}.log`);
    const result = spawnSync("/bin/sh", [hookLauncher, "hook"], {
      encoding: "utf8",
      env: { ...process.env, HOME: path.join(directory, "no-home-volta"), PATH: pathBin, VOLTA_HOME: path.join(directory, "volta"), NVM_BIN: nvmBin, MODEL_ROUTING_GATE_TEST_LOG: log, ...environment }
    });
    assert.equal(result.status, 0, label);
    assert.match(fs.readFileSync(log, "utf8"), new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|`), label);
  }
});

test("hook launcher preserves quoting and the gate process standard streams and exit status", (t) => {
  const directory = root(t);
  const voltaBin = path.join(directory, "volta path with spaces", "bin");
  fs.mkdirSync(voltaBin, { recursive: true });
  const node = fakeNode(voltaBin, "node");
  const log = path.join(directory, "node.log");
  const result = spawnSync("/bin/sh", [hookLauncher, "hook", "argument with spaces", "$(not-expanded)"], {
    input: "stdin-through-launcher",
    encoding: "utf8",
    env: { ...process.env, HOME: path.join(directory, "no-home-volta"), PATH: "/usr/bin:/bin", VOLTA_HOME: path.join(directory, "volta path with spaces"), NVM_BIN: path.join(directory, "missing-nvm"), MODEL_ROUTING_GATE_TEST_LOG: log, MODEL_ROUTING_GATE_TEST_EXIT: "37" }
  });
  assert.equal(result.status, 37);
  assert.equal(result.stdout, "fake-node-stdout\nstdin-through-launcher");
  assert.equal(result.stderr, "fake-node-stderr\n");
  assert.match(fs.readFileSync(log, "utf8"), new RegExp(`^${node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|.*model-routing-gate\\.mjs hook argument with spaces \\$\\(not-expanded\\)`));
});

test("hook launcher fails closed without a healthy runtime", (t) => {
  const directory = root(t);
  const pathBin = path.join(directory, "path-bin");
  fs.mkdirSync(pathBin);
  const broken = fakeNode(pathBin, "node", "broken");
  const result = spawnSync("/bin/sh", [hookLauncher, "hook"], {
    encoding: "utf8",
    env: { ...process.env, HOME: directory, PATH: pathBin, MODEL_ROUTING_GATE_NODE: broken, VOLTA_HOME: path.join(directory, "missing-volta"), NVM_BIN: path.join(directory, "missing-nvm") }
  });
  assert.equal(result.status, 127);
  assert.equal(result.stderr, "model-routing-gate: no healthy Node runtime available\n");
});

test("every hook calls the launcher and no hook invokes bare node", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  const commands = Object.values(hooks.hooks).flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)));
  assert.equal(commands.length, 4);
  for (const command of commands) {
    assert.equal(command, "/bin/sh \"$PLUGIN_ROOT/scripts/model-routing-gate-hook.sh\" hook");
    assert.doesNotMatch(command, /(^|\s)node(\s|$)/);
  }
});
