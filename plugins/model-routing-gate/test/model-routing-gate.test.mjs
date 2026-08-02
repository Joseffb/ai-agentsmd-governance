import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  processHook,
  routingEventLogPath
} from "../scripts/model-routing-gate.mjs";
import { buildOrchestrationBundle } from "../../../lib/orchestration.mjs";
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
    malformed: "printf '%s\\n' invalid; exit 0",
    old: "printf '%s\\n' 18.20.0; exit 0",
    broken: "exit 1"
  }[behavior];
  fs.writeFileSync(file, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' v22.0.0
  exit 0
fi
if [ "$1" = "-p" ] && [ "$2" = "process.versions.node" ]; then
  ${probe}
fi
printf '%s\\n' "$0|$*" > "$MODEL_ROUTING_GATE_TEST_LOG"
printf '%s\\n' fake-node-stdout
printf '%s\\n' fake-node-stderr >&2
cat
exit "\${MODEL_ROUTING_GATE_TEST_EXIT:-0}"
`);
  fs.chmodSync(file, 0o755);
  return file;
}

test("plugin metadata and installed hook are passive native lifecycle diagnostics", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const hookConfig = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  const skill = fs.readFileSync(path.join(pluginRoot, "skills", "model-routing-gate", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  const readme = fs.readFileSync(path.join(pluginRoot, "README.md"), "utf8").replace(/\s+/g, " ");

  assert.equal(manifest.version, "1.2.0+codex.20260802");
  assert.match(manifest.description, /Passive/);
  assert.match(manifest.interface.longDescription, /reports an active model/i);
  assert.match(manifest.interface.longDescription, /passive context/i);
  assert.match(manifest.interface.longDescription, /Unverified/i);
  assert.deepEqual(Object.keys(hookConfig.hooks), ["SubagentStart"]);
  assert.match(hookConfig.description, /Passive/);
  assert.match(skill, /Set `model_critical:false` unless result validity or safety explicitly depends/i);
  assert.match(readme, /Do not run a canary, quarantine turn, or attestation handshake as the default/i);
  assert.match(readme, /review and trust its hook through `\/hooks`/i);
  assert.match(skill, /re-trust the exact definition whenever it changes/i);
  assert.match(readme, /app Reload as the supported refresh action/i);
  assert.match(skill, /app Reload as the supported refresh action/i);
  assert.match(readme, /Reload does not retrofit transcript history or prove hook interception/i);
});

test("composer launch requires seat assignment and child preflight for mutation", (t) => {
  const bundleRoot = root(t);
  const priorRoot = process.env.ACG_ORCHESTRATION_BUNDLE_ROOT;
  process.env.ACG_ORCHESTRATION_BUNDLE_ROOT = bundleRoot;
  t.after(() => {
    if (priorRoot === undefined) delete process.env.ACG_ORCHESTRATION_BUNDLE_ROOT;
    else process.env.ACG_ORCHESTRATION_BUNDLE_ROOT = priorRoot;
  });
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: 300001,
    effects: ["source_mutation"],
    complexity: "mechanical",
    spark_eligibility: {
      work_kind: "mechanical_edit",
      requires_judgment: false,
      availability: "selectable"
    },
    maximum_workers: 1,
    decomposition_complete: true,
    coherent_chain: false,
    work_items: [{ id: "bounded-work", write_scopes: ["lib/bounded-work.mjs"] }]
  });
  const bundlePath = path.join(bundleRoot, `${bundle.bundle_digest.slice("sha256:".length)}.json`);
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });

  const launch = orchestrateLaunch({ bundlePath, seat: "1" });
  assert.equal(launch.contract, "native_mutating_worker_isolation_required");
  assert.equal(launch.admission, "blocked_pending_verified_worktree_and_child_preflight");
  assert.equal(launch.native_assignment, null);
  assert.equal(launch.admitted_assignment, null);
  assert.deepEqual(launch.high_level_next_action, {
    command: "seat assign",
    project: bundle.project_identity.project,
    repository: bundle.project_identity.repository_root,
    bundle_path: bundlePath,
    worker_seat: "1",
    write_scopes: ["lib/bounded-work.mjs"],
    requested_model: "gpt-5.3-codex-spark",
    requested_reasoning_raw: "low",
    required_unbound_inputs: ["base", "worktree_root"],
    child_preflight: {
      command: "seat preflight",
      assignment_source: "seat_assign.assignment_package",
      required_before_mutation: true
    },
    no_guess_contract: "Select an exact base commit and approved worktree root through seat assign; do not construct a native spawn request."
  });
  assert.equal(JSON.stringify(launch).includes("start_request"), false);
  assert.equal(Object.hasOwn(launch, "launch_package_path"), false);
});

test("composer launch retains direct native V2 assignment for read-only discovery", (t) => {
  const bundleRoot = root(t);
  const priorRoot = process.env.ACG_ORCHESTRATION_BUNDLE_ROOT;
  process.env.ACG_ORCHESTRATION_BUNDLE_ROOT = bundleRoot;
  t.after(() => {
    if (priorRoot === undefined) delete process.env.ACG_ORCHESTRATION_BUNDLE_ROOT;
    else process.env.ACG_ORCHESTRATION_BUNDLE_ROOT = priorRoot;
  });
  const bundle = buildOrchestrationBundle({
    immediate_intent: "implementation",
    estimated_duration_ms: 300001,
    effects: ["filesystem_mutation"],
    maximum_workers: 1,
    decomposition_complete: false,
    coherent_chain: false,
    work_items: [{ id: "bounded-discovery", write_scopes: ["lib/bounded-discovery.mjs"] }]
  });
  const bundlePath = path.join(bundleRoot, `${bundle.bundle_digest.slice("sha256:".length)}.json`);
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });

  const launch = orchestrateLaunch({ bundlePath, seat: "1" });
  assert.equal(launch.native_assignment.contract, "native_direct_worker_assignment");
  assert.equal(launch.native_assignment.admission, "direct");
  assert.equal(launch.native_assignment.pass_start_request_verbatim, true);
  assert.equal(launch.native_assignment.start_request.model, launch.requested_model);
  assert.equal(launch.native_assignment.start_request.reasoning_effort, launch.requested_reasoning_raw);
  const message = launch.native_assignment.start_request.message;
  const delimiter = "CANONICAL_ASSIGNMENT_JSON:\n";
  assert.match(message, /^ORCHESTRATION_WORKER_ASSIGNMENT_V2\n/);
  const suffixOffset = message.indexOf(delimiter);
  assert.notEqual(suffixOffset, -1);
  const assignment = JSON.parse(message.slice(suffixOffset + delimiter.length));
  assert.equal(assignment.required_final_sentinel, launch.admitted_assignment.required_final_sentinel);
  assert.equal(launch.native_assignment.actual_model, "Unverified");
  assert.equal(launch.native_assignment.actual_reasoning_raw, "Unverified");
  assert.equal(
    launch.native_assignment.compatibility_diagnostics.legacy_quarantine_attestation,
    "not_required_for_direct_admission"
  );
  assert.equal(Object.hasOwn(launch, "native_quarantine"), false);
});

test("official SubagentStart reports passive model context without actual attestation", (t) => {
  const state = root(t);
  const result = processHook({
    session_id: sessionId,
    hook_event_name: "SubagentStart",
    turn_id: "turn-1",
    agent_id: "native-agent",
    agent_type: "worker",
    permission_mode: "workspace-write",
    model: "gpt-5.6-terra",
    reasoning_effort: "fabricated-extra-field"
  }, { stateRoot: state });

  assert.match(result.systemMessage, /passive active-model context/i);
  assert.match(result.systemMessage, /no reasoning or requested-to-actual binding/i);
  assert.match(result.systemMessage, /actual routing remains Unverified/i);
  const events = fs.readFileSync(routingEventLogPath(state), "utf8");
  assert.match(events, /"reported_model":"gpt-5.6-terra"/);
  assert.match(events, /"reported_model_evidence":"passive_non_authoritative_context"/);
  assert.match(events, /"actual_model":"Unverified"/);
  assert.match(events, /"actual_reasoning_raw":"Unverified"/);
  assert.doesNotMatch(events, /fabricated-extra-field/);
});

test("synthetic evidence events and tool hooks cannot create model admission", (t) => {
  const state = root(t);
  for (const hook_event_name of [
    "RuntimeModelEvidence",
    "RuntimeModelEvidenceStop",
    "PreToolUse",
    "PostToolUse"
  ]) {
    assert.deepEqual(processHook({
      session_id: sessionId,
      hook_event_name,
      agent_id: "caller-supplied-agent",
      model: "caller-supplied-model",
      reasoning_effort: "caller-supplied-reasoning",
      tool_name: "spawn_agent"
    }, { stateRoot: state }), {});
  }
  assert.equal(fs.existsSync(routingEventLogPath(state)), false);
});

test("official SubagentStop remains passive if invoked outside installed hook config", (t) => {
  const state = root(t);
  assert.deepEqual(processHook({
    session_id: sessionId,
    hook_event_name: "SubagentStop",
    agent_id: "native-agent",
    agent_type: "worker",
    model: "gpt-5.6-terra",
    last_assistant_message: "untrusted output"
  }, { stateRoot: state }), {});
  const events = fs.readFileSync(routingEventLogPath(state), "utf8");
  assert.match(events, /"event_type":"subagent_stopped"/);
  assert.match(events, /"actual_model":"Unverified"/);
  assert.doesNotMatch(events, /untrusted output|gpt-5\.6-terra/);
});

test("hook launcher selects a healthy Volta runtime and preserves streams", (t) => {
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

test("hook launcher rejects invalid runtimes and fails closed without a healthy one", (t) => {
  const directory = root(t);
  const pathBin = path.join(directory, "path-bin");
  fs.mkdirSync(pathBin);
  for (const behavior of ["malformed", "old", "broken"]) {
    const candidate = fakeNode(pathBin, `node-${behavior}`, behavior);
    const result = spawnSync("/bin/sh", [hookLauncher, "hook"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: directory,
        PATH: pathBin,
        MODEL_ROUTING_GATE_NODE: candidate,
        VOLTA_HOME: path.join(directory, "missing-volta"),
        NVM_BIN: path.join(directory, "missing-nvm")
      }
    });
    assert.equal(result.status, 127, behavior);
    assert.equal(result.stderr, "model-routing-gate: no healthy Node runtime available\n", behavior);
  }
});

test("every installed hook calls the launcher and no hook invokes bare node", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  const commands = Object.values(hooks.hooks).flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)));
  assert.deepEqual(commands, ["/bin/sh \"$PLUGIN_ROOT/scripts/model-routing-gate-hook.sh\" hook"]);
  assert.doesNotMatch(commands[0], /(^|\s)node(\s|$)/);
});
