import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cli = path.resolve("bin/acg.mjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-projectless-"));
  const target = path.join(root, "generated-workspace");
  const profile = path.join(root, "profile.json");
  fs.mkdirSync(target);
  fs.writeFileSync(profile, JSON.stringify({
    schema_version: 1,
    approval_mode: "approve_for_me",
    approved_roots: [],
    project_roots: {},
    project_read_roots: {}
  }));
  return {
    root,
    target,
    profile,
    env: { ...process.env, ACG_MACHINE_PROFILE: profile, ACG_PROVENANCE_ROOT: path.join(root, "provenance") }
  };
}

function inspect(value, project = "null") {
  return JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "inspect",
    "--project", project,
    "--path", value.target,
    "--seat", "reader",
    "--model", "gpt-5.6-terra",
    "--reasoning", "high",
    "--objective", "Inspect only this generated workspace"
  ], { encoding: "utf8", env: value.env }));
}

test("explicit CLI --project null uses a bounded non-reporting projectless read-only fallback", () => {
  const value = fixture();
  const beforeProfile = fs.readFileSync(value.profile, "utf8");
  const output = inspect(value);

  assert.deepEqual(output.project_binding, { kind: "projectless_unbound" });
  assert.equal(output.status, "native_read_only_fallback");
  assert.equal(output.read_only, true);
  assert.equal(output.target, fs.realpathSync(value.target));
  assert.equal(output.actual_model, "Unverified");
  assert.equal(output.actual_reasoning_raw, "Unverified");
  assert.equal(output.native_read_only_fallback.exact_target_path, fs.realpathSync(value.target));
  assert.equal(output.native_read_only_fallback.mutation_authorized, false);
  assert.equal(output.native_read_only_fallback.machine_profile_mutation_authorized, false);
  assert.equal(output.seat_ready, false);
  assert.equal(output.native_fallback_ready, true);
  assert.equal(output.native_read_only_fallback.unregistered_root_absence_agent_system_defect_report_eligible, false);
  assert.equal(output.native_read_only_fallback.immediate_next_action, "native_or_manual_read_only_delegation");
  assert.equal(output.native_read_only_fallback.wait_for_agent_system, false);
  assert.equal(output.native_spawn_request.model, "gpt-5.6-terra");
  assert.equal(output.admitted_assignment.pass_message_verbatim, true);
  assert.equal(fs.readFileSync(value.profile, "utf8"), beforeProfile);
  assert.match(output.completion_sentinel, /^ACG_PROJECTLESS_READ_ONLY_FALLBACK:[a-f0-9]{16}$/u);
});

test("missing --project remains an error and registered roots require a binding", () => {
  const value = fixture();
  const missing = spawnSync(process.execPath, [
    cli, "seat", "inspect", "--path", value.target, "--seat", "reader", "--model", "gpt-5.6-terra", "--reasoning", "high"
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /project is required/u);

  const profile = JSON.parse(fs.readFileSync(value.profile, "utf8"));
  profile.project_roots.projectless = [value.target];
  fs.writeFileSync(value.profile, JSON.stringify(profile));
  const rejected = spawnSync(process.execPath, [cli, "seat", "inspect", "--project", "null", "--path", value.target, "--seat", "reader", "--model", "gpt-5.6-terra", "--reasoning", "high"], { encoding: "utf8", env: value.env });
  assert.match(rejected.stderr, /registered_project_binding_required:projectless/u);
});

test("raw JSON project:null remains invalid instead of normalizing to projectless", () => {
  const value = fixture();
  const input = path.join(value.root, "route.json");
  fs.writeFileSync(input, JSON.stringify({
    mode: "read_only", phase: "audit", project: null, operations: ["audit"], tools: ["filesystem_read"], paths: [value.target], risk_tags: [], mutation_authority: false
  }));
  const result = spawnSync(process.execPath, [cli, "route", "--file", input], { encoding: "utf8", env: value.env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project.*(?:null|expected string)/u);
});

test("Codex date/task workspace is a narrow projectless fallback target", () => {
  const value = fixture();
  const target = path.join(value.root, "Documents", "Codex", "2026-07-29", "task-opaque");
  fs.mkdirSync(target, { recursive: true });
  value.target = target;
  value.env.HOME = value.root;
  const output = inspect(value);
  assert.equal(output.native_fallback_ready, true);
  assert.equal(output.target, fs.realpathSync(target));
  assert.match(output.admitted_assignment.required_final_sentinel, /^ACG_PROJECTLESS_READ_ONLY_RESULT:/u);
});

test("project read root admits read-only inspect and child preflight but not mutation", () => {
  const value = fixture();
  const profile = JSON.parse(fs.readFileSync(value.profile, "utf8"));
  profile.project_read_roots.fixture = [value.target];
  fs.writeFileSync(value.profile, JSON.stringify(profile));
  const output = inspect(value, "fixture");
  const preflight = JSON.parse(execFileSync(process.execPath, output.child_preflight.args, { encoding: "utf8", env: value.env }));
  assert.equal(preflight.seat_preflight_ready, true);
  const input = path.join(value.root, "mutation.json");
  fs.writeFileSync(input, JSON.stringify({ mode: "mutation", phase: "implementation", project: "fixture", operations: ["implementation"], tools: ["filesystem_write"], paths: [value.target], risk_tags: [], mutation_authority: true, authorities: ["filesystem_mutation"] }));
  const mutation = spawnSync(process.execPath, [cli, "route", "--file", input], { encoding: "utf8", env: value.env });
  assert.notEqual(mutation.status, 0);
});

test("read root rejects raw mutating delegation while allowing raw read-only delegation", () => {
  const value = fixture();
  const profile = JSON.parse(fs.readFileSync(value.profile, "utf8"));
  profile.project_read_roots.fixture = [value.target];
  fs.writeFileSync(value.profile, JSON.stringify(profile));
  const request = (operation) => {
    const input = path.join(value.root, `${operation}.json`);
    fs.writeFileSync(input, JSON.stringify({ mode: "delegation", phase: "delegation", project: "fixture", operations: [operation], tools: ["subagent"], paths: [value.target], risk_tags: [], mutation_authority: operation === "launch_mutating_subagent", authorities: operation === "launch_mutating_subagent" ? ["delegation_mutation"] : ["delegation"] }));
    return spawnSync(process.execPath, [cli, "route", "--file", input], { encoding: "utf8", env: value.env });
  };
  assert.equal(request("launch_subagent").status, 0);
  const rejected = request("launch_mutating_subagent");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /outside approved roots/u);
});

test("null project is rejected outside seat inspect", () => {
  const value = fixture();
  const result = spawnSync(process.execPath, [cli, "audit", "--project", "null", "--path", value.target], { encoding: "utf8", env: value.env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /permitted only for seat inspect/u);
});
