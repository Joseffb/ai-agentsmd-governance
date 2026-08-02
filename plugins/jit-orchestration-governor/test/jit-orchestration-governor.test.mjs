import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CANONICAL_ORCHESTRATION_EFFECTS,
  COMPLETION_CONTRACT_PREFIX,
  diagnosticPath,
  processHook
} from "../scripts/jit-orchestration-governor.mjs";

function root(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jit-hook-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
function event(metadata) { return { hook_event_name: "PreToolUse", tool_name: "shell", tool_input: { jit_orchestration: metadata } }; }
function worker(seat = "0") { return { seat_id: seat, immediate_intent: "implementation", estimated_duration_ms: 300001, effects: ["source_mutation"], explicitly_atomic: true, low_risk: true, remedy_known: true, delegation_overhead_dominates: true, source_mutation_surfaces: ["lib/a.mjs"] }; }
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("plugin package manifest remains installable and delegates hooks to hooks.json", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const hookConfig = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));

  assert.equal(manifest.name, "jit-orchestration-governor");
  assert.match(manifest.version, /^3\.0\.0-rc\.3$/);
  assert.match(manifest.description, /JIT refresh/);
  assert.equal(manifest.author.name, "AI Codex Governance");
  assert.equal(manifest.interface.displayName, "JIT Orchestration Governor");
  assert.equal(manifest.interface.developerName, "AI Codex Governance");
  assert.deepEqual(manifest.interface.capabilities, ["hooks"]);
  assert.ok(manifest.interface.shortDescription);
  assert.ok(manifest.interface.longDescription);
  assert.ok(manifest.interface.defaultPrompt);
  assert.equal(Object.hasOwn(manifest, "hooks"), false);
  assert.equal(hookConfig.hooks.SessionStart[0].matcher, "^(startup|resume|clear|compact)$");
  assert.equal(hookConfig.hooks.PreToolUse[0].hooks[0].command, "node \"$PLUGIN_ROOT/scripts/jit-orchestration-governor.mjs\" hook");
  assert.equal(hookConfig.hooks.SubagentStop[0].matcher, ".*");
});

test("SessionStart refreshes bounded JIT context on startup resume clear and compact", (t) => {
  const state = root(t);
  for (const source of ["startup", "resume", "clear", "compact"]) {
    const result = processHook({ hook_event_name: "SessionStart", source }, { stateRoot: state });
    assert.equal(result.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(result.hookSpecificOutput.additionalContext, new RegExp(`refresh \\(${source}\\)`));
    assert.match(result.hookSpecificOutput.additionalContext, /smallest current policy delta/i);
    assert.match(result.hookSpecificOutput.additionalContext, /not execution admission or a persistent workflow/i);
  }
  assert.deepEqual(processHook({ hook_event_name: "SessionStart", source: "other" }, { stateRoot: state }), {});
});

test("SubagentStop gives one stateless completion-contract feedback pass", (t) => {
  const state = root(t);
  const missing = processHook({
    hook_event_name: "SubagentStop",
    agent_type: "worker",
    stop_hook_active: false,
    last_assistant_message: "Done."
  }, { stateRoot: state });
  assert.equal(missing.decision, "block");
  assert.match(missing.reason, new RegExp(COMPLETION_CONTRACT_PREFIX.trim()));

  const accepted = processHook({
    hook_event_name: "SubagentStop",
    agent_type: "explorer",
    stop_hook_active: false,
    last_assistant_message: `${COMPLETION_CONTRACT_PREFIX}${JSON.stringify({
      status: "complete",
      artifact: "commit abc123",
      validation: "node --test passed",
      residuals: "none"
    })}`
  }, { stateRoot: state });
  assert.deepEqual(accepted, {});

  const exhausted = processHook({
    hook_event_name: "SubagentStop",
    agent_type: "custom_role",
    stop_hook_active: true,
    last_assistant_message: "Still missing."
  }, { stateRoot: state });
  assert.deepEqual(exhausted, {});
});

test("observes and warns on Seat 0 worker-required work without denying execution", (t) => {
  const result = processHook(event(worker()), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /Seat 0 JIT advisory: worker_required/);
  assert.match(result.hookSpecificOutput.additionalContext, /never enforces execution against Seat 0/);
});

test("missing metadata fails open for project execution", (t) => {
  const result = processHook({ hook_event_name: "PreToolUse", tool_input: {} }, { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /Unverified/);
});

test("explicit Seat 0 prohibition remains external authority and is only observed", (t) => {
  const result = processHook(event({ ...worker("seat-0"), estimated_duration_ms: 1, seat0_prohibited: true }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /worker_required/);
});

test("worker bypass is allowed", (t) => {
  const result = processHook(event(worker("seat-1")), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
});

test("complete canonical worker metadata remains allowed", (t) => {
  const result = processHook(event({ ...worker("seat-1"), effects: ["build"] }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
});

test("primary classifier failure retries the deterministic fallback", (t) => {
  const result = processHook(event(worker()), { stateRoot: root(t), classifier: () => { throw new Error("unavailable"); } });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /worker_required/);
});

test("project authority remains fail-closed for workers when complete metadata requires it", (t) => {
  const result = processHook(event({
    ...worker("seat-1"),
    effects: ["database_mutation"],
    project_authority_granted: false
  }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /explicit project\/user authority/i);
});

test("Seat 0 project-authority findings warn but remain fail-open", (t) => {
  const result = processHook(event({
    ...worker("seat-0"),
    effects: ["database_mutation"],
    project_authority_granted: false
  }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /project_authority_required/);
  assert.match(result.hookSpecificOutput.additionalContext, /External project or user authority remains required/);
});

test("only boolean true grants authority in fallback classification", (t) => {
  const result = processHook(event({
    ...worker("seat-1"),
    effects: ["deployment"],
    project_authority_granted: "false"
  }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /authority/i);
});

test("unknown, aliased, and case-variant effects deny only the worker action", (t) => {
  for (const effect of ["Publication", "db", "database", "deploy", "contract"]) {
    const result = processHook(event({
      ...worker("seat-1"),
      estimated_duration_ms: 1,
      effects: [effect]
    }), { stateRoot: root(t) });
    assert.equal(result.hookSpecificOutput.permissionDecision, "deny", effect);
    assert.match(result.hookSpecificOutput.permissionDecisionReason, /canonical action metadata/i);
  }
});

test("unknown Seat 0 effects remain advisory and fail-open", (t) => {
  const result = processHook(event({
    ...worker("seat-0"),
    estimated_duration_ms: 1,
    effects: ["Publication"]
  }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /canonical_metadata_required/);
  assert.match(result.hookSpecificOutput.additionalContext, /never enforces execution against Seat 0/);
});

test("every canonical effect remains recognized by the standalone fallback", (t) => {
  for (const effect of CANONICAL_ORCHESTRATION_EFFECTS) {
    const result = processHook(event({
      ...worker("seat-1"),
      estimated_duration_ms: 1,
      effects: [effect]
    }), {
      stateRoot: root(t),
      classifier: () => { throw new Error("force standalone fallback"); }
    });
    const reason = result.hookSpecificOutput.permissionDecisionReason ?? "";
    assert.doesNotMatch(reason, /non-canonical effect/i, effect);
  }
});

test("explicit Seat 0 malformed metadata warns and fails open", (t) => {
  const result = processHook(event({ seat_id: "seat 0", immediate_intent: "implementation", estimated_duration_ms: "fast", effects: ["source_mutation"] }), {
    stateRoot: root(t),
    classifier: () => { throw new Error("unavailable"); },
    fallbackClassifier: () => { throw new Error("unavailable"); }
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /coverage warning/i);
  assert.match(result.hookSpecificOutput.additionalContext, /never enforces execution against Seat 0/i);
});

test("non-Seat-0 malformed metadata continues with Unverified guidance", (t) => {
  const result = processHook(event({ seat_id: "seat-1", immediate_intent: "implementation", estimated_duration_ms: "fast", effects: ["source_mutation"] }), {
    stateRoot: root(t),
    classifier: () => { throw new Error("unavailable"); },
    fallbackClassifier: () => { throw new Error("unavailable"); }
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /Unverified/);
});

test("private diagnostics are bounded per record and append-only", (t) => {
  const state = root(t);
  processHook(event(worker("seat-1")), { stateRoot: state });
  const file = diagnosticPath(state);
  const first = fs.readFileSync(file, "utf8");
  processHook(event(worker("seat-1")), { stateRoot: state });
  const second = fs.readFileSync(file, "utf8");
  assert.ok(second.startsWith(first));
  assert.equal(second.trimEnd().split("\n").length, 2);
  assert.ok(second.trimEnd().split("\n").every((line) => Buffer.byteLength(line) <= 2048));
  assert.doesNotMatch(second, /prompt|project data/i);
});
