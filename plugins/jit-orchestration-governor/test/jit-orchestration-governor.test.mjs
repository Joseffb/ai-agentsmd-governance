import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CANONICAL_ORCHESTRATION_EFFECTS,
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

  assert.equal(manifest.name, path.basename(pluginRoot));
  assert.match(manifest.version, /^3\.0\.0-rc\.1$/);
  assert.equal(manifest.description, "Bounded JIT guard for immediate orchestration actions");
  assert.equal(manifest.author.name, "AI Codex Governance");
  assert.equal(manifest.interface.displayName, "JIT Orchestration Governor");
  assert.equal(manifest.interface.developerName, "AI Codex Governance");
  assert.deepEqual(manifest.interface.capabilities, ["hooks"]);
  assert.ok(manifest.interface.shortDescription);
  assert.ok(manifest.interface.longDescription);
  assert.ok(manifest.interface.defaultPrompt);
  assert.equal(Object.hasOwn(manifest, "hooks"), false);
  assert.equal(hookConfig.hooks.PreToolUse[0].hooks[0].command, "node \"$PLUGIN_ROOT/scripts/jit-orchestration-governor.mjs\" hook");
});

test("enforces proven Seat 0 worker-required work", (t) => {
  const result = processHook(event(worker()), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
});

test("missing metadata fails open for project execution", (t) => {
  const result = processHook({ hook_event_name: "PreToolUse", tool_input: {} }, { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.additionalContext, /Unverified/);
});

test("explicit Seat 0 prohibition is enforced", (t) => {
  const result = processHook(event({ ...worker("seat-0"), estimated_duration_ms: 1, seat0_prohibited: true }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
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
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /worker_required/);
});

test("project authority is denied for every seat when complete metadata requires it", (t) => {
  const result = processHook(event({
    ...worker("seat-1"),
    effects: ["database_mutation"],
    project_authority_granted: false
  }), { stateRoot: root(t) });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /explicit project\/user authority/i);
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

test("unknown, aliased, and case-variant effects deny only that action for every seat", (t) => {
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

test("explicit Seat 0 malformed metadata denies only that action with native delegation guidance", (t) => {
  const result = processHook(event({ seat_id: "seat 0", immediate_intent: "implementation", estimated_duration_ms: "fast", effects: ["source_mutation"] }), {
    stateRoot: root(t),
    classifier: () => { throw new Error("unavailable"); },
    fallbackClassifier: () => { throw new Error("unavailable"); }
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /native worker tooling/i);
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /project may continue/i);
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
