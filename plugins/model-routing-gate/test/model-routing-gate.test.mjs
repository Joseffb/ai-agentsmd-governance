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
import {
  buildOrchestrationBundle,
  bundleDigest,
  canonicalJson,
  sha256
} from "../../../lib/orchestration.mjs";
import { orchestrateLaunch } from "../../../lib/orchestration-cli.mjs";

const sessionId = "thread-model-gate-test";
const pluginRoot = path.resolve(import.meta.dirname, "..");
const hookLauncher = path.join(pluginRoot, "scripts", "model-routing-gate-hook.sh");

function root(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-gate-")));
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
    attempt: options.attempt ?? 1,
    ...(options.composerAssignment === undefined ? {} : { composer_assignment: options.composerAssignment })
  };
  return `${ENVELOPE_PREFIX}${JSON.stringify(envelope)}\nPerform only the assigned bounded objective. SECRET_PROMPT_TEXT`;
}

function composerAssignment(t, {
  availability = "selectable",
  workKind = "mechanical_edit",
  requiresJudgment = false,
  excludedEffects = [],
  workerSeat = 1,
  workerAssignmentIds = ["bounded-work"]
} = {}) {
  const bundleRoot = root(t);
  fs.chmodSync(bundleRoot, 0o700);
  const priorRoot = process.env.ACG_ORCHESTRATION_BUNDLE_ROOT;
  process.env.ACG_ORCHESTRATION_BUNDLE_ROOT = bundleRoot;
  t.after(() => {
    if (priorRoot === undefined) delete process.env.ACG_ORCHESTRATION_BUNDLE_ROOT;
    else process.env.ACG_ORCHESTRATION_BUNDLE_ROOT = priorRoot;
  });
  const workItems = workerAssignmentIds.map((id, index) => ({
    id,
    write_scopes: [`lib/${id}-${index}.mjs`]
  }));
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: 300001,
    effects: ["source_mutation", ...excludedEffects],
    complexity: "mechanical",
    ...(workKind === "unexposed" ? {} : {
      spark_eligibility: {
        work_kind: workKind,
        requires_judgment: requiresJudgment,
        availability
      }
    }),
    maximum_workers: Math.max(workerSeat, workItems.length),
    decomposition_complete: true,
    coherent_chain: false,
    work_items: workItems
  });
  const worker = bundle.topology.workers[workerSeat - 1];
  assert.ok(worker, "fixture worker seat must exist");
  const bundlePath = path.join(bundleRoot, `${bundle.bundle_digest.slice("sha256:".length)}.json`);
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  if (["authoritatively_unavailable", "separate_pool_exhausted"].includes(availability)) {
    return {
      schema_version: 1,
      bundle_path: bundlePath,
      bundle_digest: bundle.bundle_digest,
      execution_id: bundle.execution_id,
      correlation_id: bundle.correlation_id,
      causation_id: bundle.causation_id,
      worker_seat: workerSeat,
      worker_assignment_ids: worker.assignment_ids,
      worker_prompt_envelope_sha256: sha256(canonicalJson(worker.prompt_envelope)),
      requested_model: worker.requested_model,
      requested_reasoning_raw: worker.requested_reasoning_raw,
      spark_gate: bundle.model_recommendation.spark_gate,
      availability_evidence: "Unverified"
    };
  }
  const launch = orchestrateLaunch({ bundlePath, seat: String(workerSeat) });
  const firstLine = launch.native_quarantine.spawn_request.message.split(/\r?\n/u, 1)[0];
  assert.ok(firstLine.startsWith(ENVELOPE_PREFIX), "composer launch fixture must use the gate envelope");
  return structuredClone(JSON.parse(firstLine.slice(ENVELOPE_PREFIX.length)).composer_assignment);
}

function pre(stateRoot, toolUseId, seat, options = {}) {
  return processHook({
    session_id: options.sessionId || sessionId,
    hook_event_name: "PreToolUse",
    tool_name: options.toolName || "Agent",
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
    tool_name: options.toolName || "Agent",
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

test("plugin metadata and guidance limit enforcement to proven hook-covered paths", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const skill = fs.readFileSync(path.join(pluginRoot, "skills", "model-routing-gate", "SKILL.md"), "utf8");
  const readme = fs.readFileSync(path.join(pluginRoot, "README.md"), "utf8");
  const governSkill = fs.readFileSync(path.resolve(pluginRoot, "..", "..", "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  assert.match(manifest.description, /hook-covered/i);
  assert.match(manifest.interface.shortDescription, /hook-covered/i);
  assert.match(manifest.interface.longDescription, /proven hook-covered paths/i);
  assert.match(manifest.interface.longDescription, /Unverified/i);
  assert.doesNotMatch(`${manifest.description}\n${manifest.interface.shortDescription}\n${manifest.interface.longDescription}`, /universal/i);
  assert.match(skill, /Set `model_critical:false` unless result validity or safety explicitly depends/i);
  assert.match(skill, /app Reload as the supported refresh action/i);
  assert.match(skill, /creating a fresh task alone does not reload a process-cached plugin/i);
  assert.match(readme, /failed negative canary is telemetry.*never a project stop/is);
  assert.match(readme, /mutating model-critical seat.*hook-covered path or an operator-approved redesign/is);
  const refreshFallback = "If Reload does not refresh the plugin, mark enforcement `Unverified`, continue projects through the permitted fallback, and leave any restart or diagnostic action to explicit operator choice.";
  for (const text of [readme, skill, governSkill]) {
    assert.match(text, new RegExp(refreshFallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(text, /fully quit|quit and reopen|must restart|require.*restart/i);
  }
  assert.deepEqual([readme, skill, governSkill].map((text) => text.match(new RegExp(refreshFallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))?.[0]), [refreshFallback, refreshFallback, refreshFallback]);
});

test("native spawn_agent hooks enforce when invoked and absence leaves no fabricated interception", (t) => {
  const state = root(t);
  const toolName = "multi_agent_v1__spawn_agent";
  const allowed = pre(state, "native-spawn", "native-seat", {
    model: "gpt-5.6-terra",
    reasoning: "high",
    toolName
  });
  assert.equal(allowed.hookSpecificOutput.permissionDecision, "allow");
  start(state, "native-agent", "gpt-5.6-terra");
  post(state, "native-spawn", "native-agent", { toolName });
  assert.equal(readAgentReceipt(state, sessionId, "native-agent").output_admissible, true);

  const ungatedState = root(t);
  const observedStart = start(ungatedState, "host-bypassed-agent", "gpt-5.6-terra");
  assert.match(observedStart.systemMessage, /captured runtime model evidence and is awaiting deterministic spawn binding/i);
  assert.equal(readAgentReceipt(ungatedState, sessionId, "host-bypassed-agent"), null);
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

test("unbound Spark and Terra low launches are denied while ordinary legacy routing remains", (t) => {
  for (const [model, reasoning] of [
    ["gpt-5.3-codex-spark", "low"],
    ["gpt-5.6-terra", "low"]
  ]) {
    const result = pre(root(t), `unbound-${model}`, "legacy-seat", { model, reasoning });
    assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
    assert.match(result.hookSpecificOutput.permissionDecisionReason, /require a verified composer_assignment/);
  }
  assert.equal(pre(root(t), "legacy-terra-high", "legacy-seat", {
    model: "gpt-5.6-terra",
    reasoning: "high"
  }).hookSpecificOutput.permissionDecision, "allow");
});

test("fake bundle path and digest are denied", (t) => {
  const missing = composerAssignment(t);
  missing.bundle_path = path.join(path.dirname(missing.bundle_path), "missing.json");
  assert.match(pre(root(t), "fake-path", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: missing
  }).hookSpecificOutput.permissionDecisionReason, /does not exist/);

  const digestMismatch = composerAssignment(t);
  digestMismatch.bundle_digest = `sha256:${"f".repeat(64)}`;
  assert.match(pre(root(t), "fake-digest", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: digestMismatch
  }).hookSpecificOutput.permissionDecisionReason, /differs from the verified bundle/);

  const outside = composerAssignment(t);
  const outsideDirectory = root(t);
  const outsidePath = path.join(outsideDirectory, path.basename(outside.bundle_path));
  fs.copyFileSync(outside.bundle_path, outsidePath);
  fs.chmodSync(outsidePath, 0o600);
  outside.bundle_path = outsidePath;
  assert.match(pre(root(t), "outside-root", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: outside
  }).hookSpecificOutput.permissionDecisionReason, /outside ACG_ORCHESTRATION_BUNDLE_ROOT/);

  const symlinked = composerAssignment(t);
  const symlinkPath = `${symlinked.bundle_path}.link`;
  fs.symlinkSync(symlinked.bundle_path, symlinkPath);
  symlinked.bundle_path = symlinkPath;
  assert.match(pre(root(t), "symlink-path", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: symlinked
  }).hookSpecificOutput.permissionDecisionReason, /regular non-symlink file/);
});

test("tampered bundle, payload, and worker seat are denied", (t) => {
  const tamperedBundle = composerAssignment(t);
  const persisted = JSON.parse(fs.readFileSync(tamperedBundle.bundle_path, "utf8"));
  persisted.model_recommendation.model = "gpt-5.6-terra";
  fs.writeFileSync(tamperedBundle.bundle_path, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });
  assert.match(pre(root(t), "tampered-bundle", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: tamperedBundle
  }).hookSpecificOutput.permissionDecisionReason, /bundle digest is invalid/);

  const tamperedPayload = composerAssignment(t);
  tamperedPayload.worker_assignment_ids = ["different-work"];
  assert.match(pre(root(t), "tampered-payload", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: tamperedPayload
  }).hookSpecificOutput.permissionDecisionReason, /assignment_ids differ/);

  const tamperedPromptBinding = composerAssignment(t);
  tamperedPromptBinding.worker_prompt_envelope_sha256 = `sha256:${"f".repeat(64)}`;
  assert.match(pre(root(t), "tampered-prompt-binding", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: tamperedPromptBinding
  }).hookSpecificOutput.permissionDecisionReason, /prompt_envelope_sha256 differs/);

  const wrongSeat = composerAssignment(t);
  assert.match(pre(root(t), "wrong-seat", "seat-2", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: wrongSeat
  }).hookSpecificOutput.permissionDecisionReason, /seat_id does not match/);
});

test("digest-recomputed self-authored bundle cannot forge Spark eligibility", (t) => {
  const forgedAssignment = composerAssignment(t);
  const forgedBundle = JSON.parse(fs.readFileSync(forgedAssignment.bundle_path, "utf8"));
  forgedBundle.classification.classification = "seat0_owned";
  forgedBundle.classification.effects = ["security"];
  forgedBundle.bundle_digest = bundleDigest(forgedBundle);
  const forgedPath = path.join(
    path.dirname(forgedAssignment.bundle_path),
    `${forgedBundle.bundle_digest.slice("sha256:".length)}.json`
  );
  fs.writeFileSync(forgedPath, `${JSON.stringify(forgedBundle, null, 2)}\n`, { mode: 0o600 });
  forgedAssignment.bundle_path = forgedPath;
  forgedAssignment.bundle_digest = forgedBundle.bundle_digest;

  const result = pre(root(t), "self-authored-spark", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: forgedAssignment
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /failed full orchestration semantic validation/);

  const eligibilityForgery = composerAssignment(t);
  const coordinatedBundle = JSON.parse(fs.readFileSync(eligibilityForgery.bundle_path, "utf8"));
  coordinatedBundle.classification.effects = ["security"];
  coordinatedBundle.classification.anti_evasion.mandatory_effect_requires_worker = true;
  coordinatedBundle.seat0_decision.reasons.splice(2, 0, "mandatory_effect_requires_worker");
  coordinatedBundle.bundle_digest = bundleDigest(coordinatedBundle);
  const coordinatedPath = path.join(
    path.dirname(eligibilityForgery.bundle_path),
    `${coordinatedBundle.bundle_digest.slice("sha256:".length)}.json`
  );
  fs.writeFileSync(coordinatedPath, `${JSON.stringify(coordinatedBundle, null, 2)}\n`, { mode: 0o600 });
  eligibilityForgery.bundle_path = coordinatedPath;
  eligibilityForgery.bundle_digest = coordinatedBundle.bundle_digest;
  const coordinated = pre(root(t), "forged-eligibility", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: eligibilityForgery
  });
  assert.equal(coordinated.hookSpecificOutput.permissionDecision, "deny");
  assert.match(coordinated.hookSpecificOutput.permissionDecisionReason, /Spark eligibility rejects excluded effects/);
});

test("composer-bound launch rejects a missing expected assignment field", (t) => {
  const expected = composerAssignment(t);
  delete expected.requested_model;
  const result = pre(root(t), "composer-missing", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: expected
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /Missing composer_assignment field: requested_model/);
});

test("composer-bound v6 execution identity is exact, bundle-bound, and tamper-evident", (t) => {
  const accepted = composerAssignment(t);
  for (const [field, prefix] of [
    ["execution_id", "execution"],
    ["correlation_id", "correlation"],
    ["causation_id", "causation"]
  ]) {
    assert.match(accepted[field], new RegExp(`^${prefix}-[a-f0-9]{32}$`));
  }
  assert.equal(pre(root(t), "composer-v6-identity", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: accepted
  }).hookSpecificOutput.permissionDecision, "allow");

  for (const [field, prefix] of [
    ["execution_id", "execution"],
    ["correlation_id", "correlation"],
    ["causation_id", "causation"]
  ]) {
    const missing = composerAssignment(t);
    delete missing[field];
    assert.match(pre(root(t), `composer-missing-${field}`, "seat-1", {
      model: "gpt-5.3-codex-spark",
      reasoning: "low",
      composerAssignment: missing
    }).hookSpecificOutput.permissionDecisionReason, new RegExp(`Missing composer_assignment field: ${field}`));

    const tampered = composerAssignment(t);
    tampered[field] = `${prefix}-${"0".repeat(32)}`;
    assert.match(pre(root(t), `composer-tampered-${field}`, "seat-1", {
      model: "gpt-5.3-codex-spark",
      reasoning: "low",
      composerAssignment: tampered
    }).hookSpecificOutput.permissionDecisionReason, /execution identity differs from the verified bundle/);
  }

  const selfAuthored = composerAssignment(t);
  selfAuthored.identity_claim = "self-authored";
  assert.match(pre(root(t), "composer-self-authored-identity", "seat-1", {
    model: "gpt-5.3-codex-spark",
    reasoning: "low",
    composerAssignment: selfAuthored
  }).hookSpecificOutput.permissionDecisionReason, /Unknown composer_assignment field: identity_claim/);
});

test("tampered composer assignment cannot relabel a Spark-required seat as Terra", (t) => {
  const tampered = composerAssignment(t);
  tampered.requested_model = "gpt-5.6-terra";
  const result = pre(root(t), "composer-tampered", "seat-1", {
    model: "gpt-5.6-terra",
    reasoning: "low",
    composerAssignment: tampered
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /model\/reasoning differs from the verified bundle/);
});

test("Terra launch mismatching a composer-required Spark assignment is denied", (t) => {
  const result = pre(root(t), "composer-terra-mismatch", "seat-1", {
    model: "gpt-5.6-terra",
    reasoning: "low",
    composerAssignment: composerAssignment(t)
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /Launch model\/reasoning differs/);
});

test("exact composer-required Spark assignment is accepted and receipt-bound", (t) => {
  const state = root(t);
  const receipt = acceptedLaunch(
    state,
    "composer-spark",
    "composer-spark-agent",
    "seat-1",
    "gpt-5.3-codex-spark",
    "low",
    { composerAssignment: composerAssignment(t) }
  );
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.spark_required, true);
  assert.equal(receipt.spark_fallback_authorized, false);
  assert.match(receipt.composer_assignment_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(receipt.composer_bundle_digest, /^sha256:[a-f0-9]{64}$/);
});

test("Terra low fallback passes only when composer availability authorizes it", (t) => {
  const state = root(t);
  const receipt = acceptedLaunch(
    state,
    "composer-fallback",
    "composer-fallback-agent",
    "seat-1",
    "gpt-5.6-terra",
    "low",
    {
      composerAssignment: composerAssignment(t, {
        model: "gpt-5.6-terra",
        availability: "unknown_or_unexposed"
      })
    }
  );
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.spark_required, false);
  assert.equal(receipt.spark_fallback_authorized, true);

  const unauthorized = pre(root(t), "composer-fallback-denied", "seat-1", {
    model: "gpt-5.6-terra",
    reasoning: "low",
    composerAssignment: composerAssignment(t, {
      model: "gpt-5.6-terra",
      availability: "selectable"
    })
  });
  assert.equal(unauthorized.hookSpecificOutput.permissionDecision, "deny");

  for (const availability of ["authoritatively_unavailable", "separate_pool_exhausted"]) {
    const unsupportedEvidence = pre(root(t), `composer-${availability}`, "seat-1", {
      model: "gpt-5.6-terra",
      reasoning: "low",
      composerAssignment: composerAssignment(t, {
        model: "gpt-5.6-terra",
        availability
      })
    });
    assert.equal(unsupportedEvidence.hookSpecificOutput.permissionDecision, "deny");
    assert.match(unsupportedEvidence.hookSpecificOutput.permissionDecisionReason, /lacks a supported authoritative host capability receipt/);
  }
});

test("omitted Spark eligibility routes through ordinary Terra high without fallback authorization", (t) => {
  const state = root(t);
  const receipt = acceptedLaunch(
    state,
    "composer-unexposed",
    "composer-unexposed-agent",
    "seat-1",
    "gpt-5.6-terra",
    "high",
    {
      composerAssignment: composerAssignment(t, {
        workKind: "unexposed"
      })
    }
  );
  assert.equal(receipt.output_admissible, true);
  assert.equal(receipt.spark_required, false);
  assert.equal(receipt.spark_fallback_authorized, false);
  assert.equal(receipt.spark_gate.work_kind, "unexposed");
  assert.equal(receipt.spark_gate.requires_judgment, true);
  assert.equal(receipt.spark_gate.worker_required, true);
});

test("omitted Spark eligibility cannot authorize Spark or Terra low", (t) => {
  for (const model of ["gpt-5.3-codex-spark", "gpt-5.6-terra"]) {
    const result = pre(root(t), `composer-unexposed-${model}`, "seat-1", {
      model,
      reasoning: "low",
      composerAssignment: composerAssignment(t, { workKind: "unexposed" })
    });
    assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
    assert.match(result.hookSpecificOutput.permissionDecisionReason, /Launch model\/reasoning differs/);
  }
});

test("legacy ordinary non-Spark launches remain compatible", (t) => {
  assert.equal(pre(root(t), "legacy-terra", "legacy-seat", {
    model: "gpt-5.6-terra",
    reasoning: "high"
  }).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(pre(root(t), "legacy-sol", "legacy-seat", {
    model: "gpt-5.6-sol",
    reasoning: "high"
  }).hookSpecificOutput.permissionDecision, "allow");
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
