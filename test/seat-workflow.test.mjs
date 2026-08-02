import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveRoute } from "../lib/core.mjs";
import { buildNativeQuarantineLaunch } from "../lib/native-model-attestation.mjs";

const cli = path.resolve("bin/acg.mjs");
const helper = path.resolve("skills/govern-codex-policy/scripts/subagent-git.mjs");
const policyRoot = path.resolve("governance");

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-seat-"));
  const repository = path.join(root, "repo");
  const worktrees = path.join(root, "worktrees");
  const provenance = path.join(root, "provenance");
  const bundleRoot = path.join(root, "private-bundles");
  const metricsLedger = path.join(root, "engineering-events.jsonl");
  const profile = path.join(root, "profile.json");
  fs.mkdirSync(path.join(repository, "src"), { recursive: true });
  fs.mkdirSync(worktrees);
  fs.mkdirSync(bundleRoot, { mode: 0o700 });
  git(repository, ["init"]);
  git(repository, ["config", "user.email", "acg@example.invalid"]);
  git(repository, ["config", "user.name", "ACG Test"]);
  fs.writeFileSync(path.join(repository, "src", "owned.rs"), "base\n");
  fs.writeFileSync(path.join(repository, "Cargo.lock"), "clean\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "base"]);
  const base = git(repository, ["rev-parse", "HEAD"]);
  fs.writeFileSync(profile, JSON.stringify({
    schema_version: 1,
    approval_mode: "approve_for_me",
    approved_roots: [],
    project_roots: { fixture: [root] },
    project_read_roots: {}
  }));
  const env = {
    ...process.env,
    ACG_MACHINE_PROFILE: profile,
    ACG_PROVENANCE_ROOT: provenance,
    ACG_ORCHESTRATION_BUNDLE_ROOT: bundleRoot,
    ACG_METRICS_LEDGER: metricsLedger,
    TMPDIR: root
  };
  return { root, repository, worktrees, provenance, bundleRoot, metricsLedger, base, env };
}

function orchestrationBundle(value, facts = {}) {
  const factsPath = path.join(value.root, `orchestration-facts-${crypto.randomUUID()}.json`);
  fs.writeFileSync(factsPath, JSON.stringify({
    estimated_duration_ms: 300001,
    effects: ["source_mutation"],
    decomposition_complete: true,
    coherent_chain: false,
    work_items: [{ id: "owned", write_scopes: ["src/owned.rs"] }],
    ...facts
  }));
  return JSON.parse(execFileSync(process.execPath, [
    cli, "orchestrate", "next", "--project", "fixture", "--path", value.repository,
    "--intent", "implementation", "--facts", factsPath
  ], { encoding: "utf8", env: value.env }));
}

function seatArgs(value, command, seat, writeScope = "src/owned.rs") {
  return [
    cli, "seat", command,
    "--project", "fixture",
    "--repository", value.repository,
    "--base", value.base,
    "--seat", seat,
    "--worktree-root", value.worktrees,
    "--write-scope", writeScope,
    "--model", "gpt-5.6-terra",
    "--reasoning", "high"
  ];
}

function inspectArgs(value, seat = "reader") {
  return [
    cli, "seat", "inspect",
    "--project", "fixture",
    "--path", value.repository,
    "--seat", seat,
    "--model", "gpt-5.6-terra",
    "--reasoning", "high",
    "--objective", "Inspect the bounded repository without mutation"
  ];
}

test("seat inspect owns the read-only lifecycle and emits a one-command child preflight", () => {
  const value = fixture();
  const audit = JSON.parse(execFileSync(process.execPath, [
    cli, "audit",
    "--project", "fixture",
    "--path", value.repository
  ], { encoding: "utf8", env: value.env }));
  const priorReceipt = path.join(value.root, "prior-audit.json");
  fs.writeFileSync(priorReceipt, JSON.stringify(audit));

  const output = JSON.parse(execFileSync(process.execPath, [
    ...inspectArgs(value),
    "--prior-receipt", priorReceipt
  ], { encoding: "utf8", env: value.env }));
  assert.equal(output.seat_ready, true);
  assert.equal(output.read_only, true);
  assert.match(output.completion_sentinel, /^ACG_READ_ONLY_SEAT_READY:[0-9a-f]{16}$/);
  assert.equal(output.child_preflight.shell, false);
  assert.deepEqual(output.child_preflight.args.slice(-4), [
    "seat",
    "preflight",
    "--assignment", output.assignment_package
  ]);
  assert.match(output.child_instruction, /Start the native child directly/u);

  const assignment = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  assert.equal(assignment.package_type, "governed_read_only_seat_assignment");
  assert.equal(assignment.child_ledger, "fresh_no_parent_receipt");
  assert.equal(assignment.actual_model, "Unverified");
  assert.equal(assignment.actual_reasoning_raw, "Unverified");
  assert.match(assignment.execution_id, /^execution-[a-f0-9]{32}$/u);
  assert.match(assignment.correlation_id, /^correlation-[a-f0-9]{32}$/u);
  assert.match(assignment.causation_id, /^causation-[a-f0-9]{32}$/u);
  assert.deepEqual(output.native_assignment, assignment.native_assignment);
  assert.equal(assignment.native_assignment.contract, "native_direct_read_only_assignment");
  assert.equal(assignment.native_assignment.admission, "direct");
  assert.equal(assignment.native_assignment.requested_model, "gpt-5.6-terra");
  assert.equal(assignment.native_assignment.requested_reasoning_raw, "high");
  assert.equal(assignment.native_assignment.actual_model, "Unverified");
  assert.equal(assignment.native_assignment.actual_reasoning_raw, "Unverified");
  assert.deepEqual(assignment.native_assignment.required_capabilities, ["native_subagent_start", "filesystem_read", "local_runtime", "thread_coordination"]);
  assert.deepEqual(assignment.native_assignment.start_request, {
    task_name: "read-only-reader",
    fork_turns: "none",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    message: output.admitted_assignment.message
  });
  assert.equal(assignment.native_assignment.automatic_fallback.ordered, true);
  assert.deepEqual(assignment.native_assignment.automatic_fallback.steps.map(({ order, action }) => ({ order, action })), [
    { order: 1, action: "start_native_subagent_with_exact_start_request" },
    { order: 2, action: "delegate_exact_admitted_assignment_manually" },
    { order: 3, action: "return_bounded_read_only_blocker_without_mutation" }
  ]);
  assert.equal(assignment.native_assignment.compatibility_diagnostics.subagent_start_model_metadata, "active_model_slug_may_be_reported_without_requested_to_actual_binding_or_reasoning_proof");
  assert.equal(output.admitted_assignment.pass_message_verbatim, true);
  assert.equal(output.admitted_assignment.starts_new_turn, true);
  assert.match(output.admitted_assignment.message, /'seat' 'preflight'/u);
  assert.match(
    output.admitted_assignment.message,
    new RegExp(`${output.admitted_assignment.required_final_sentinel}$`, "u")
  );
  assert.match(output.admitted_assignment.stale_notification_rule, /without the required final sentinel/u);
  assert.equal(assignment.result_sentinel, output.admitted_assignment.required_final_sentinel);
  assert.deepEqual(assignment.admitted_assignment, output.admitted_assignment);
  assert.equal(assignment.admitted_assignment.message, output.admitted_assignment.message);
  assert.equal(assignment.child_preflight.executable, process.execPath);
  assert.equal(assignment.child_preflight.shell, false);
  assert.deepEqual(assignment.child_preflight.args.slice(-5), [
    "audit",
    "--project", "fixture",
    "--path", fs.realpathSync(value.repository)
  ]);
  assert.equal(assignment.child_preflight.args.includes("route"), false);
  assert.equal(assignment.child_preflight.args.includes("deliver"), false);
  assert.equal(assignment.child_preflight.args.includes("acknowledge"), false);
  assert.equal(assignment.child_preflight.args.some((arg) => arg.includes("--help")), false);
  assert.equal(assignment.retry_contract.corrected_retries, 1);
  assert.match(assignment.retry_contract.catalog_discovery, /only_when/);
  assert.ok(
    assignment.policy_lifecycle.context_acknowledgment.accumulated_policy_tokens >=
      audit.context_acknowledgment.accumulated_policy_tokens
  );

  const preflight = JSON.parse(execFileSync(
    output.child_preflight.executable,
    output.child_preflight.args,
    { encoding: "utf8", env: value.env }
  ));
  assert.equal(preflight.command, "seat preflight");
  assert.equal(preflight.seat_preflight_ready, true);
  assert.equal(preflight.audit_ready, true);
  assert.equal(preflight.preflight_contract_verified, true);
  assert.equal(preflight.source_inspection_authorized, true);
  assert.equal(preflight.seat, "reader");
  assert.deepEqual(
    [preflight.execution_id, preflight.correlation_id, preflight.causation_id],
    [assignment.execution_id, assignment.correlation_id, assignment.causation_id]
  );
  assert.match(preflight.audit_completion_sentinel, /^ACG_AUDIT_READY:[0-9a-f]{16}$/);
  assert.match(preflight.completion_sentinel, /^ACG_READ_ONLY_SEAT_PREFLIGHT:[0-9a-f]{16}$/);
  const events = fs.readFileSync(value.metricsLedger, "utf8").trim().split("\n").map(JSON.parse);
  const allocated = events.find((event) => event.type === "execution.allocated");
  const running = events.find((event) => event.type === "execution.running");
  const started = events.find((event) => event.type === "seat.started");
  assert.deepEqual(
    [allocated.execution_id, allocated.correlation_id, allocated.causation_id],
    [assignment.execution_id, assignment.correlation_id, assignment.causation_id]
  );
  for (const event of [running, started]) {
    assert.deepEqual(
      [event.execution_id, event.correlation_id, event.causation_id],
      [assignment.execution_id, assignment.correlation_id, assignment.causation_id]
    );
    assert.equal(event.coverage_status, "complete");
  }
});

test("seat assign and inspect inherit a verified v6 orchestration execution identity", () => {
  const value = fixture();
  const bundle = orchestrationBundle(value);
  const expected = JSON.parse(fs.readFileSync(bundle.bundle_path, "utf8"));
  const assigned = JSON.parse(execFileSync(process.execPath, [
    ...seatArgs(value, "assign", "1"), "--bundle", bundle.bundle_path
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  assert.deepEqual(
    [assignment.execution_id, assignment.correlation_id, assignment.causation_id],
    [expected.execution_id, expected.correlation_id, expected.causation_id]
  );
  assert.deepEqual(assignment.orchestration_bundle, {
    bundle_path: bundle.bundle_path,
    bundle_digest: bundle.bundle_digest,
    worker_seat: 1,
    worker_assignment_ids: ["owned"],
    execution_id: expected.execution_id,
    correlation_id: expected.correlation_id,
    causation_id: expected.causation_id
  });
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  assert.deepEqual(provenance.orchestration_bundle, assignment.orchestration_bundle);
  const inspected = JSON.parse(execFileSync(process.execPath, [
    ...inspectArgs(value, "1"), "--bundle", bundle.bundle_path
  ], { encoding: "utf8", env: value.env }));
  const readOnly = JSON.parse(fs.readFileSync(inspected.assignment_package, "utf8"));
  assert.deepEqual(
    [readOnly.execution_id, readOnly.correlation_id, readOnly.causation_id],
    [expected.execution_id, expected.correlation_id, expected.causation_id]
  );
  assert.deepEqual(readOnly.orchestration_bundle, assignment.orchestration_bundle);
  const events = fs.readFileSync(value.metricsLedger, "utf8").trim().split("\n").map(JSON.parse);
  for (const event of events.filter((event) => event.type === "seat.prepared" || event.type === "execution.allocated")) {
    assert.equal(event.execution_id, expected.execution_id);
    assert.equal(event.correlation_id, expected.correlation_id);
    assert.equal(event.causation_id, expected.causation_id);
  }
});

test("seat bundle binding rejects a tampered bundle and project or seat mismatches", () => {
  const value = fixture();
  const bundle = orchestrationBundle(value);
  const mismatchedSeat = spawnSync(process.execPath, [
    ...seatArgs(value, "assign", "2"), "--bundle", bundle.bundle_path
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(mismatchedSeat.status, 0);
  assert.match(mismatchedSeat.stderr, /does not select the requested worker seat/u);
  const mismatchedProject = spawnSync(process.execPath, [
    cli, "seat", "inspect", "--project", "other", "--path", value.repository,
    "--seat", "1", "--model", "gpt-5.6-terra", "--reasoning", "high", "--bundle", bundle.bundle_path
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(mismatchedProject.status, 0);
  assert.match(mismatchedProject.stderr, /project does not match seat project/u);
  const tampered = JSON.parse(fs.readFileSync(bundle.bundle_path, "utf8"));
  tampered.execution_id = "execution-00000000000000000000000000000000";
  fs.writeFileSync(bundle.bundle_path, JSON.stringify(tampered), { mode: 0o600 });
  const rejected = spawnSync(process.execPath, [
    ...seatArgs(value, "assign", "1"), "--bundle", bundle.bundle_path
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /correlation_id must be derived from execution_id|bundle digest is invalid/u);
});

test("seat inspect persists the exact admitted assignment for truncation-safe recovery", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, inspectArgs(value), {
    encoding: "utf8",
    env: value.env
  }));
  const truncatedNormalOutput = JSON.stringify(output).slice(0, 120);
  assert.doesNotMatch(truncatedNormalOutput, new RegExp(output.admitted_assignment.required_final_sentinel, "u"));

  const persisted = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  assert.equal(persisted.admitted_assignment.message, output.admitted_assignment.message);
  assert.equal(persisted.admitted_assignment.required_final_sentinel, output.admitted_assignment.required_final_sentinel);
  assert.equal(persisted.admitted_assignment.stale_notification_rule, output.admitted_assignment.stale_notification_rule);
  assert.equal(persisted.admitted_assignment.close_rule, output.admitted_assignment.close_rule);
  assert.deepEqual(persisted.native_assignment, output.native_assignment);

  const explained = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "explain", "--assignment", output.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.deepEqual(explained.admitted_assignment, output.admitted_assignment);
});

test("seat preflight rejects a tampered persisted admitted assignment", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, inspectArgs(value), {
    encoding: "utf8",
    env: value.env
  }));
  const assignment = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  assignment.admitted_assignment.message = "send a guessed message";
  fs.writeFileSync(output.assignment_package, JSON.stringify(assignment, null, 2) + "\n");

  const failed = spawnSync(process.execPath, [
    cli, "seat", "preflight", "--assignment", output.assignment_package
  ], { encoding: "utf8", env: value.env });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /admitted payload is invalid/);
});

test("seat preflight supports legacy read-only packages without an admitted payload", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, inspectArgs(value), {
    encoding: "utf8",
    env: value.env
  }));
  const legacy = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  delete legacy.admitted_assignment;
  delete legacy.native_assignment;
  legacy.native_quarantine = buildNativeQuarantineLaunch({
    seatId: legacy.seat,
    model: legacy.requested_model,
    reasoning: legacy.requested_reasoning_raw
  });
  const legacyIdentity = crypto.createHash("sha256").update(JSON.stringify(legacy)).digest("hex").slice(0, 16);
  const legacyPath = path.join(path.dirname(output.assignment_package), `read-only-assignment-${legacyIdentity}.json`);
  fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2) + "\n");

  const preflight = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "preflight", "--assignment", legacyPath
  ], { encoding: "utf8", env: value.env }));
  assert.equal(preflight.seat_preflight_ready, true);
  const explained = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "explain", "--assignment", legacyPath
  ], { encoding: "utf8", env: value.env }));
  assert.match(explained.admitted_assignment.message, /Run this exact child preflight command once/u);
});

test("seat inspect keeps direct native admission independent of legacy quarantine attempts", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, [
    ...inspectArgs(value, "reader-retry"),
    "--attempt", "2"
  ], { encoding: "utf8", env: value.env }));
  assert.equal(output.native_assignment.admission, "direct");
  assert.equal(output.native_assignment.start_request.model, "gpt-5.6-terra");
  assert.equal(output.native_assignment.start_request.reasoning_effort, "high");
});

test("seat inspect rejects seat zero before assignment, provenance, or metrics effects", () => {
  const value = fixture();
  const failed = spawnSync(process.execPath, inspectArgs(value, "0"), { encoding: "utf8", env: value.env });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Seat 0 is reserved/);
  assert.equal(fs.existsSync(value.provenance), false);
  assert.equal(fs.existsSync(value.metricsLedger), false);
});

test("seat preflight rejects a modified read-only assignment package", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, inspectArgs(value), {
    encoding: "utf8",
    env: value.env
  }));
  const assignment = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  assignment.objective = "modified after preparation";
  fs.writeFileSync(output.assignment_package, JSON.stringify(assignment, null, 2) + "\n");

  const failed = spawnSync(process.execPath, [
    cli,
    "seat",
    "preflight",
    "--assignment", output.assignment_package
  ], { encoding: "utf8", env: value.env });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /content identity does not match its filename/);
});

test("seat explain supports read-only assignment packages", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, inspectArgs(value), {
    encoding: "utf8",
    env: value.env
  }));

  const explained = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "explain",
    "--assignment", output.assignment_package
  ], { encoding: "utf8", env: value.env }));

  assert.equal(explained.command, "seat explain");
  assert.equal(explained.read_only, true);
  assert.equal(explained.assignment.package_type, "governed_read_only_seat_assignment");
  assert.equal(explained.assignment.child_preflight.shell, false);
  assert.deepEqual(explained.assignment.child_preflight.args.slice(-5), [
    "audit",
    "--project", "fixture",
    "--path", fs.realpathSync(value.repository)
  ]);
  assert.equal(explained.provenance, null);
});

test("seat assign hides protocol and emits a private assignment package", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "writer"), {
    encoding: "utf8",
    env: value.env
  }));
  assert.equal(output.seat_ready, true);
  assert.equal(output.status, "ready");
  assert.equal(output.visibility, "normal");
  assert.equal(output.scope_count, 1);
  assert.equal(output.resolution_receipt, undefined);
  assert.equal(output.active_worktree_receipt, undefined);
  const assignment = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  assert.equal(assignment.child_ledger, "fresh_no_parent_receipt");
  assert.equal(assignment.requested_model, "gpt-5.6-terra");
  assert.match(assignment.execution_id, /^execution-[a-f0-9]{32}$/);
  assert.match(assignment.correlation_id, /^correlation-[a-f0-9]{32}$/);
  assert.match(assignment.causation_id, /^causation-[a-f0-9]{32}$/);
  assert.deepEqual(assignment.write_scope, ["src/owned.rs"]);
  assert.ok(assignment.policy_lifecycle.context_acknowledgment);
  const events = fs.readFileSync(value.metricsLedger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "seat.prepared");
  assert.equal(events[0].project, "fixture");
  assert.equal(events[1].type, "execution.allocated");
  assert.equal(events[1].execution_id, assignment.execution_id);
  assert.equal(events[1].correlation_id, assignment.correlation_id);
  assert.equal(events[1].causation_id, assignment.causation_id);
});

test("mutating preflight records the observed subtask start with its execution correlation", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "started-writer"), {
    encoding: "utf8",
    env: value.env
  }));
  const assignment = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  execFileSync(assigned.child_preflight.executable, assigned.child_preflight.args, {
    encoding: "utf8",
    env: value.env
  });
  const events = fs.readFileSync(value.metricsLedger, "utf8").trim().split("\n").map(JSON.parse);
  const started = events.find((event) => event.type === "seat.started");
  const running = events.find((event) => event.type === "execution.running");
  assert.equal(started.execution_id, assignment.execution_id);
  assert.equal(running.execution_id, assignment.execution_id);
  assert.equal(started.correlation_id, assignment.correlation_id);
  assert.equal(running.causation_id, assignment.causation_id);
  assert.equal(started.occurred_at, running.occurred_at);
  assert.ok(Date.parse(started.occurred_at) >= Date.parse(assignment.created_at));
  assert.equal(started.coverage_status, "complete");
});

test("seat assign carries declared generated scope in its private assignment package", () => {
  const value = fixture();
  const output = JSON.parse(execFileSync(process.execPath, [
    ...seatArgs(value, "assign", "generated-writer"),
    "--generated-scope", "node_modules"
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  assert.deepEqual(assignment.generated_output_scope, ["node_modules"]);
});

test("mutating seat assign emits an integrity-bound one-command preflight", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "preflight-writer"), {
    encoding: "utf8", env: value.env
  }));
  assert.equal(assigned.child_preflight.shell, false);
  assert.deepEqual(assigned.child_preflight.args.slice(-4), ["seat", "preflight", "--assignment", assigned.assignment_package]);
  const preflight = JSON.parse(execFileSync(assigned.child_preflight.executable, assigned.child_preflight.args, { encoding: "utf8", env: value.env }));
  assert.equal(preflight.seat_preflight_ready, true);
  assert.equal(preflight.mutation_authorized_in_verified_worktree, true);
  assert.deepEqual(
    preflight.delivered_modules.map(({ content, ...module }) => module),
    preflight.context_acknowledgment.delivery_history.at(-1).modules
  );
  for (const module of preflight.delivered_modules) {
    assert.equal(module.content, fs.readFileSync(path.join(policyRoot, module.path), "utf8"));
    assert.match(module.digest, /^sha256:[0-9a-f]{64}$/);
  }
  assert.ok(preflight.delivered_modules.some((module) => module.id === "project-overlays"));
  assert.ok(preflight.delivered_modules.some((module) => module.id === "context-routing"));
  assert.match(preflight.completion_sentinel, /^ACG_MUTATING_SEAT_PREFLIGHT:/);
  const tampered = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  tampered.seat = "other";
  fs.writeFileSync(assigned.assignment_package, JSON.stringify(tampered));
  const rejected = spawnSync(process.execPath, assigned.child_preflight.args, { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /content identity/);
});

test("initial assignment finalization internally binds legitimate owned dirty state", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "initial-finalize"), {
    encoding: "utf8", env: value.env
  }));
  const assignment = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(assignment.worktree, "src", "owned.rs"), "owned candidate\n");

  const finalized = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(finalized.command, "seat finalize");
  assert.equal(finalized.changed_paths, 1);
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  assert.equal(provenance.execution_id, assignment.execution_id);
  assert.equal(provenance.correlation_id, assignment.correlation_id);
  assert.equal(provenance.causation_id, assignment.causation_id);
  assert.match(provenance.finalization_receipt_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(provenance.final_changed_paths, ["src/owned.rs"]);
  assert.equal(provenance.final_files[0].deleted, false);
  assert.match(provenance.final_files[0].final_digest, /^sha256:[0-9a-f]{64}$/u);
  const receipt = JSON.parse(fs.readFileSync(provenance.finalization_receipt, "utf8"));
  assert.equal(receipt.receipt_purpose, "continuation");
  assert.deepEqual(receipt.dirty_paths, ["src/owned.rs"]);
});

test("initial assignment finalization records an untracked-only owned file", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(
    process.execPath,
    seatArgs(value, "assign", "initial-finalize-untracked", "src/new.rs"),
    { encoding: "utf8", env: value.env }
  ));
  const assignment = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(assignment.worktree, "src", "new.rs"), "new candidate\n");

  const finalized = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(finalized.changed_paths, 1);
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  assert.deepEqual(provenance.final_changed_paths, ["src/new.rs"]);
  assert.deepEqual(provenance.final_files.map((entry) => entry.path), ["src/new.rs"]);
  assert.equal(provenance.final_files[0].deleted, false);
  assert.match(provenance.final_files[0].final_digest, /^sha256:[0-9a-f]{64}$/u);
});

test("initial assignment finalization separates declared generated output from integrable source", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, [
    ...seatArgs(value, "assign", "initial-finalize-generated"),
    "--generated-scope", "artifacts/result.json"
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(assignment.worktree, "src", "owned.rs"), "owned candidate\n");
  fs.mkdirSync(path.join(assignment.worktree, "artifacts"));
  fs.writeFileSync(path.join(assignment.worktree, "artifacts", "result.json"), "{\"ok\":true}\n");

  const finalized = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(finalized.changed_paths, 1);
  assert.equal(finalized.generated_paths, 1);
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  assert.deepEqual(provenance.final_changed_paths, ["src/owned.rs"]);
  assert.deepEqual(provenance.final_generated_paths, ["artifacts/result.json"]);
  assert.deepEqual(provenance.final_files.map((entry) => entry.path), ["src/owned.rs"]);
  assert.deepEqual(provenance.final_generated_files.map((entry) => entry.path), ["artifacts/result.json"]);
  assert.equal(provenance.final_generated_files[0].type, "file");
  assert.match(provenance.final_generated_files[0].final_digest, /^sha256:[0-9a-f]{64}$/u);
});

test("initial assignment finalization rejects out-of-scope dirty state without recording evidence", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "initial-finalize-reject"), {
    encoding: "utf8", env: value.env
  }));
  const assignment = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  const provenanceBefore = fs.readFileSync(assignment.provenance_path, "utf8");
  fs.writeFileSync(path.join(assignment.worktree, "Cargo.lock"), "outside scope\n");

  const rejected = spawnSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Dirty path is outside declared write scope: Cargo\.lock/u);
  assert.equal(fs.readFileSync(assignment.provenance_path, "utf8"), provenanceBefore);
});

test("initial assignment finalization rejects another valid assignment receipt", () => {
  const value = fixture();
  const first = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "initial-finalize-first"), {
    encoding: "utf8", env: value.env
  }));
  const second = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "initial-finalize-second"), {
    encoding: "utf8", env: value.env
  }));
  const firstAssignment = JSON.parse(fs.readFileSync(first.assignment_package, "utf8"));
  const secondAssignment = JSON.parse(fs.readFileSync(second.assignment_package, "utf8"));
  const provenanceBefore = fs.readFileSync(firstAssignment.provenance_path, "utf8");
  fs.writeFileSync(path.join(firstAssignment.worktree, "src", "owned.rs"), "owned candidate\n");

  const rejected = spawnSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", first.assignment_package,
    "--receipt", secondAssignment.active_worktree_receipt
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Finalize receipt must match the receipt bound into the assignment/u);
  assert.equal(fs.readFileSync(firstAssignment.provenance_path, "utf8"), provenanceBefore);
});

test("seat continue binds validate intent and its shell-free child preflight acknowledges validation", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "continuation-writer"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "x".repeat(5 * 1024 * 1024 + 17));
  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base,
    "--intent", "validate"
  ], { encoding: "utf8", env: value.env }));
  assert.equal(continued.continuation_ready, true);
  assert.equal(continued.immediate_intent, "validate");
  assert.equal(continued.child_preflight.shell, false);
  assert.deepEqual(continued.child_preflight.args.slice(-4), [
    "seat", "preflight", "--assignment", continued.assignment_package
  ]);
  const preflight = JSON.parse(execFileSync(
    continued.child_preflight.executable,
    continued.child_preflight.args,
    { encoding: "utf8", env: value.env }
  ));
  assert.equal(preflight.seat_preflight_ready, true);
  assert.equal(preflight.mutation_authorized_in_verified_worktree, true);
  assert.equal(preflight.immediate_intent, "validate");
  assert.deepEqual(preflight.context_acknowledgment.operations, ["validate"]);
  assert.ok(preflight.delivered_modules.some((module) => module.id === "validation-and-evidence"));
  assert.equal(preflight.route_request_field.subagent_worktree_receipt, fs.realpathSync(preflight.route_request_field.subagent_worktree_receipt));
  assert.match(preflight.completion_sentinel, /^ACG_MUTATING_SEAT_PREFLIGHT:/);

  const explained = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "explain", "--assignment", continued.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(explained.provenance.receipt_type, "seat_continuation_provenance");
  assert.equal(explained.provenance.immediate_intent, "validate");
  assert.equal(explained.provenance.assignment_package, fs.realpathSync(continued.assignment_package));
  assert.match(explained.provenance.continuation_receipt_sha256, /^sha256:[0-9a-f]{64}$/);

  const finalized = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", continued.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(finalized.command, "seat finalize");
  assert.match(finalized.completion_sentinel, /^ACG_SEAT_FINALIZED:/);
});

test("seat continue accepts untracked files beneath a top-level write scope", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "top-level-untracked", "app"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.mkdirSync(path.join(original.worktree, "app"));
  fs.writeFileSync(path.join(original.worktree, "app", "owned.rs"), "new\n");

  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base,
    "--intent", "validate"
  ], { encoding: "utf8", env: value.env }));
  assert.equal(continued.continuation_ready, true);
  assert.equal(continued.immediate_intent, "validate");

  const preflight = JSON.parse(execFileSync(
    continued.child_preflight.executable,
    continued.child_preflight.args,
    { encoding: "utf8", env: value.env }
  ));
  assert.equal(preflight.seat_preflight_ready, true);
  assert.equal(preflight.immediate_intent, "validate");
});

test("seat continue binds deploy intent and its child preflight authorizes only deployment", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "continuation-deployer"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "candidate ready for isolated deployment\n");
  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base,
    "--intent", "deploy"
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  assert.equal(assignment.immediate_intent, "deploy");
  assert.equal(assignment.provenance_path.length > 0, true);
  assert.match(assignment.child_preflight_contract, /without authorizing source edits, Git mutation, database mutation, or a release claim/);

  const preflight = JSON.parse(execFileSync(
    continued.child_preflight.executable,
    continued.child_preflight.args,
    { encoding: "utf8", env: value.env }
  ));
  assert.equal(preflight.seat_preflight_ready, true);
  assert.equal(preflight.immediate_intent, "deploy");
  assert.equal(preflight.mutation_authorized_in_verified_worktree, false);
  assert.equal(preflight.deployment_authorized_in_verified_worktree, true);
  assert.deepEqual(preflight.context_acknowledgment.operations, ["deploy"]);
  assert.ok(preflight.delivered_modules.some((module) => module.id === "release"));
  assert.ok(preflight.delivered_modules.some((module) => module.id === "external-effects-and-supply-chain"));
  const grants = preflight.authorization_decision.grants;
  assert.ok(grants.includes("deployment"));
  for (const unauthorized of ["filesystem_mutation", "git_mutation", "database_mutation", "release"]) {
    assert.equal(grants.includes(unauthorized), false, `${unauthorized} must remain unauthorized`);
  }
  assert.equal(preflight.route_request_field.subagent_worktree_receipt, fs.realpathSync(preflight.route_request_field.subagent_worktree_receipt));

  const explained = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "explain", "--assignment", continued.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(explained.provenance.immediate_intent, "deploy");
  assert.equal(explained.provenance.assignment_package, fs.realpathSync(continued.assignment_package));

  const finalized = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", continued.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(finalized.command, "seat finalize");
  assert.match(finalized.completion_sentinel, /^ACG_SEAT_FINALIZED:/);

  const tampered = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  tampered.immediate_intent = "validate";
  fs.writeFileSync(continued.assignment_package, JSON.stringify(tampered));
  const rejected = spawnSync(process.execPath, continued.child_preflight.args, { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /content identity/);
});

test("continuation finalization rejects a later valid receipt substitution before recording candidate evidence", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "finalize-receipt-binding"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  const owned = path.join(original.worktree, "src", "owned.rs");
  fs.writeFileSync(owned, "first continuation state\n");
  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base,
    "--intent", "validate"
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  const provenanceBefore = fs.readFileSync(assignment.provenance_path, "utf8");

  fs.writeFileSync(owned, "later dirty change\n");
  const laterReceipt = JSON.parse(execFileSync(process.execPath, [
    helper, "continue",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base
  ], { encoding: "utf8", env: value.env }));
  assert.notEqual(laterReceipt.receipt_path, assignment.active_worktree_receipt);

  const rejected = spawnSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", continued.assignment_package,
    "--receipt", laterReceipt.receipt_path
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Finalize receipt must match the continuation receipt bound into the assignment/);
  assert.equal(fs.readFileSync(assignment.provenance_path, "utf8"), provenanceBefore);
});

test("continuation finalization accepts a canonical macOS-equivalent bound receipt override", { skip: process.platform !== "darwin" }, () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "finalize-canonical-receipt"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "continued\n");
  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  const privateSpelling = assignment.active_worktree_receipt.replace(/^\/var\//u, "/private/var/");
  assert.notEqual(privateSpelling, assignment.active_worktree_receipt);
  const finalized = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", continued.assignment_package,
    "--receipt", privateSpelling
  ], { encoding: "utf8", env: value.env }));
  assert.equal(finalized.command, "seat finalize");
  assert.match(finalized.completion_sentinel, /^ACG_SEAT_FINALIZED:/);
});

test("continuation provenance fails closed when missing or tampered", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "continuation-provenance"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "continued\n");
  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base,
    "--intent", "validate"
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  provenance.seat = "other";
  fs.writeFileSync(assignment.provenance_path, JSON.stringify(provenance));
  const tampered = spawnSync(process.execPath, [
    cli, "seat", "preflight", "--assignment", continued.assignment_package
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /Continuation provenance integrity is invalid/);

  fs.unlinkSync(assignment.provenance_path);
  const missing = spawnSync(process.execPath, [
    cli, "seat", "explain", "--assignment", continued.assignment_package
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /continuation provenance must be an existing absolute path/);
});

test("seat continue rejects unknown intent and preflight rejects a tampered continuation intent", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "continuation-intent-tamper"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "continued\n");
  const unknown = spawnSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base,
    "--intent", "unknown"
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /--intent must be one of: implementation, validate, deploy/);

  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base,
    "--intent", "validate"
  ], { encoding: "utf8", env: value.env }));
  const tampered = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  tampered.immediate_intent = "implementation";
  fs.writeFileSync(continued.assignment_package, JSON.stringify(tampered));
  const rejected = spawnSync(process.execPath, continued.child_preflight.args, { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /content identity/);
});

test("seat continue binds current receipt project and rejects a project mismatch", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "project-bound"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "continued\\n");
  const mismatched = spawnSync(process.execPath, [
    cli, "seat", "continue", "--project", "other-project",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /Continuation receipt project does not match --project/);
  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", original.active_worktree_receipt,
    "--expected-head", value.base
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  assert.deepEqual(assignment.project_provenance, { project: "fixture", provenance_class: "receipt_project_bound" });
  assert.equal(assignment.execution_evidence, "Unverified");
});

test("legacy receipt continuation requires unique project-profile provenance", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "legacy-project"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  const legacy = JSON.parse(fs.readFileSync(original.active_worktree_receipt, "utf8"));
  delete legacy.project;
  delete legacy.receipt_sha256;
  legacy.receipt_sha256 = `sha256:${crypto.createHash("sha256").update(JSON.stringify(legacy)).digest("hex")}`;
  const legacyReceipt = path.join(value.root, "legacy-receipt.json");
  fs.writeFileSync(legacyReceipt, JSON.stringify(legacy));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "continued\\n");
  const continued = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture", "--receipt", legacyReceipt,
    "--expected-head", value.base
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(continued.assignment_package, "utf8"));
  assert.deepEqual(assignment.project_provenance, { project: "fixture", provenance_class: "legacy_unique_project_profile" });

  const profile = JSON.parse(fs.readFileSync(value.env.ACG_MACHINE_PROFILE, "utf8"));
  profile.project_roots.alternate = [value.root];
  fs.writeFileSync(value.env.ACG_MACHINE_PROFILE, JSON.stringify(profile));
  const ambiguous = spawnSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture", "--receipt", legacyReceipt,
    "--expected-head", value.base
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /must resolve uniquely to the requested project profile/);
});

test("receipt verification accepts canonical macOS path equivalents", { skip: process.platform !== "darwin" }, () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "canonical-receipt"), {
    encoding: "utf8", env: value.env
  }));
  const assignment = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(assignment.worktree, "src", "owned.rs"), "continued\n");
  const continuation = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "continue", "--project", "fixture",
    "--receipt", assignment.active_worktree_receipt,
    "--expected-head", value.base
  ], { encoding: "utf8", env: value.env }));
  const packageValue = JSON.parse(fs.readFileSync(continuation.assignment_package, "utf8"));
  const privateSpelling = packageValue.active_worktree_receipt.replace(/^\/var\//u, "/private/var/");
  assert.notEqual(privateSpelling, packageValue.active_worktree_receipt);
  const overridden = { ...packageValue, active_worktree_receipt: privateSpelling };
  const identity = crypto.createHash("sha256").update(JSON.stringify(overridden)).digest("hex").slice(0, 16);
  const equivalentPackage = path.join(value.root, `assignment-${identity}.json`);
  fs.writeFileSync(equivalentPackage, JSON.stringify(overridden));
  const preflight = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "preflight", "--assignment", equivalentPackage
  ], { encoding: "utf8", env: value.env }));
  assert.equal(preflight.seat_preflight_ready, true);
  assert.equal(preflight.route_request_field.subagent_worktree_receipt, fs.realpathSync(privateSpelling));
});

test("seat recover copies only scoped files and records durable provenance", () => {
  const value = fixture();
  const source = path.join(value.worktrees, "source");
  git(value.repository, ["worktree", "add", "-b", "candidate", source, value.base]);
  fs.writeFileSync(path.join(source, "src", "owned.rs"), "candidate\n");
  fs.writeFileSync(path.join(source, "Cargo.lock"), "drift\n");
  const output = JSON.parse(execFileSync(process.execPath, [
    ...seatArgs(value, "recover", "proof"),
    "--source", source,
    "--copy", "src/owned.rs"
  ], { encoding: "utf8", env: value.env }));
  assert.equal(output.recovered, true);
  assert.equal(fs.readFileSync(path.join(output.worktree, "src", "owned.rs"), "utf8"), "candidate\n");
  assert.equal(fs.readFileSync(path.join(output.worktree, "Cargo.lock"), "utf8"), "clean\n");
  const assignment = JSON.parse(fs.readFileSync(output.assignment_package, "utf8"));
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  assert.equal(provenance.copied_files.length, 1);
  assert.equal(provenance.copied_files[0].source_digest, provenance.copied_files[0].destination_initial_digest);
});

test("assignment-derived recovery copies owned files and persists explicit untracked exclusions", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "assignment-recovery"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "preserved candidate\n");
  fs.mkdirSync(path.join(original.worktree, "runtime"));
  fs.writeFileSync(path.join(original.worktree, "runtime", "session.json"), "{}\n");

  const recovered = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "recover", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.assignment_derived, true);
  assert.notEqual(recovered.worktree, original.worktree);
  assert.equal(fs.readFileSync(path.join(recovered.worktree, "src", "owned.rs"), "utf8"), "preserved candidate\n");
  assert.equal(fs.existsSync(path.join(recovered.worktree, "runtime", "session.json")), false);
  assert.deepEqual(recovered.excluded_paths, [{
    path: "runtime/session.json",
    reason: "untracked_outside_original_scopes_not_recovered"
  }]);

  const assignment = JSON.parse(fs.readFileSync(recovered.assignment_package, "utf8"));
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  assert.equal(assignment.recovery_original_receipt, fs.realpathSync(original.active_worktree_receipt));
  assert.equal(provenance.original_assignment_receipt, assignment.recovery_original_receipt);
  assert.deepEqual(provenance.child_preflight, recovered.child_preflight);
  assert.deepEqual(provenance.excluded_paths, recovered.excluded_paths);
  const preflight = JSON.parse(execFileSync(
    recovered.child_preflight.executable,
    recovered.child_preflight.args,
    { encoding: "utf8", env: value.env }
  ));
  assert.equal(preflight.seat_preflight_ready, true);
  assert.equal(preflight.worktree, recovered.worktree);
});

test("assignment-derived recovery finalization rebinds legitimate post-recovery owned edits", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "recovery-finalize-success"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "recovered candidate\n");
  const recovered = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "recover", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env }));
  const assignment = JSON.parse(fs.readFileSync(recovered.assignment_package, "utf8"));
  fs.writeFileSync(path.join(assignment.worktree, "src", "owned.rs"), "worker post-recovery edit\n");

  const finalized = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", recovered.assignment_package
  ], { encoding: "utf8", env: value.env }));
  assert.equal(finalized.changed_paths, 1);
  const provenance = JSON.parse(fs.readFileSync(assignment.provenance_path, "utf8"));
  assert.deepEqual(provenance.final_changed_paths, ["src/owned.rs"]);
  const receipt = JSON.parse(fs.readFileSync(provenance.finalization_receipt, "utf8"));
  assert.equal(receipt.receipt_purpose, "continuation");
  assert.deepEqual(receipt.dirty_paths, ["src/owned.rs"]);
});

test("assignment-derived recovery finalization rejects undeclared and symbolic post-recovery edits", () => {
  const outOfScope = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(outOfScope, "assign", "recovery-finalize-outside"), {
    encoding: "utf8", env: outOfScope.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "recovered candidate\n");
  const recovered = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "recover", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: outOfScope.env }));
  const recoveryAssignment = JSON.parse(fs.readFileSync(recovered.assignment_package, "utf8"));
  const provenanceBefore = fs.readFileSync(recoveryAssignment.provenance_path, "utf8");
  fs.writeFileSync(path.join(recoveryAssignment.worktree, "Cargo.lock"), "undeclared worker edit\n");
  const outsideRejected = spawnSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", recovered.assignment_package
  ], { encoding: "utf8", env: outOfScope.env });
  assert.notEqual(outsideRejected.status, 0);
  assert.match(outsideRejected.stderr, /Dirty path is outside declared write scope: Cargo\.lock/u);
  assert.equal(fs.readFileSync(recoveryAssignment.provenance_path, "utf8"), provenanceBefore);

  const symbolic = fixture();
  const symbolicAssigned = JSON.parse(execFileSync(process.execPath, seatArgs(symbolic, "assign", "recovery-finalize-symlink"), {
    encoding: "utf8", env: symbolic.env
  }));
  const symbolicOriginal = JSON.parse(fs.readFileSync(symbolicAssigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(symbolicOriginal.worktree, "src", "owned.rs"), "recovered candidate\n");
  const symbolicRecovered = JSON.parse(execFileSync(process.execPath, [
    cli, "seat", "recover", "--assignment", symbolicAssigned.assignment_package
  ], { encoding: "utf8", env: symbolic.env }));
  const symbolicAssignment = JSON.parse(fs.readFileSync(symbolicRecovered.assignment_package, "utf8"));
  const symbolicProvenanceBefore = fs.readFileSync(symbolicAssignment.provenance_path, "utf8");
  const owned = path.join(symbolicAssignment.worktree, "src", "owned.rs");
  fs.unlinkSync(owned);
  fs.symlinkSync(path.join(symbolic.root, "missing-target"), owned);
  const symbolicRejected = spawnSync(process.execPath, [
    cli, "seat", "finalize", "--assignment", symbolicRecovered.assignment_package
  ], { encoding: "utf8", env: symbolic.env });
  assert.notEqual(symbolicRejected.status, 0);
  assert.match(symbolicRejected.stderr, /Finalized source output must not be a symbolic link: src\/owned\.rs/u);
  assert.equal(fs.readFileSync(symbolicAssignment.provenance_path, "utf8"), symbolicProvenanceBefore);
});

test("assignment-derived recovery rejects tracked exclusions before creating a worktree", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "recovery-tracked-reject"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "preserved candidate\n");
  fs.writeFileSync(path.join(original.worktree, "Cargo.lock"), "tracked outside scope\n");
  const before = fs.readdirSync(value.worktrees).sort();

  const rejected = spawnSync(process.execPath, [
    cli, "seat", "recover", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /cannot exclude a tracked dirty path outside original write scope: Cargo\.lock/u);
  assert.deepEqual(fs.readdirSync(value.worktrees).sort(), before);
});

test("assignment-derived recovery rejects ambiguous untracked exclusions", () => {
  const value = fixture();
  const assigned = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "recovery-ambiguous-reject"), {
    encoding: "utf8", env: value.env
  }));
  const original = JSON.parse(fs.readFileSync(assigned.assignment_package, "utf8"));
  fs.writeFileSync(path.join(original.worktree, "src", "owned.rs"), "preserved candidate\n");
  fs.symlinkSync(path.join(original.worktree, "src", "owned.rs"), path.join(original.worktree, "runtime-link"));

  const rejected = spawnSync(process.execPath, [
    cli, "seat", "recover", "--assignment", assigned.assignment_package
  ], { encoding: "utf8", env: value.env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Recovery untracked path must be a current regular file: runtime-link/u);
});

test("a prior seat receipt cannot authorize another seat target", () => {
  const value = fixture();
  const seatWorktree = path.join(value.worktrees, "authority-a");
  const prepared = JSON.parse(execFileSync(process.execPath, [
    helper, "prepare",
    "--project", "fixture",
    "--repository", value.repository,
    "--base", value.base,
    "--work-id", "authority",
    "--seat", "a",
    "--worktree", seatWorktree,
    "--write-scope", "src/owned.rs"
  ], { encoding: "utf8", env: value.env }));
  const outside = path.join(value.root, "..", `unapproved-${path.basename(value.root)}`);
  const priorProfile = process.env.ACG_MACHINE_PROFILE;
  process.env.ACG_MACHINE_PROFILE = path.join(value.root, "narrow-profile.json");
  fs.writeFileSync(process.env.ACG_MACHINE_PROFILE, JSON.stringify({
    schema_version: 1,
    approval_mode: "approve_for_me",
    approved_roots: [],
    project_roots: { fixture: [value.repository] },
    project_read_roots: {}
  }));
  try {
    assert.throws(() => resolveRoute({
      mode: "mutation",
      phase: "delegation",
      project: "fixture",
      operations: ["launch_mutating_subagent"],
      tools: ["subagent"],
      paths: [outside],
      risk_tags: [],
      mutation_authority: true,
      authorities: ["delegation_mutation"],
      subagent_worktree_receipt: prepared.receipt_path
    }, policyRoot), /outside approved roots/);
  } finally {
    if (priorProfile === undefined) delete process.env.ACG_MACHINE_PROFILE;
    else process.env.ACG_MACHINE_PROFILE = priorProfile;
  }
});

test("seat help exposes intent operations without requiring assignment JSON", () => {
  const result = spawnSync(process.execPath, [cli, "help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.seat.inspect, /seat inspect/);
  assert.match(output.seat.preflight, /seat preflight/);
  assert.match(output.seat.assign, /seat assign/);
  assert.match(output.seat.recover, /--assignment <governed-mutating-assignment-package>/);
  assert.match(output.seat.explain, /seat explain/);
  assert.match(output.metrics.report, /metrics report/);
});

test("telemetry failure cannot change a governed seat result", () => {
  const value = fixture();
  value.env.ACG_METRICS_LEDGER = value.root;
  const output = JSON.parse(execFileSync(process.execPath, seatArgs(value, "assign", "best-effort"), {
    encoding: "utf8",
    env: value.env
  }));
  assert.equal(output.seat_ready, true);
  assert.equal(output.status, "ready");
});
