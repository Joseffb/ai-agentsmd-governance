import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { codeRoot, resolveRoute } from "../lib/core.mjs";

const helper = path.join(codeRoot, "skills", "govern-codex-policy", "scripts", "subagent-git.mjs");
const cli = path.join(codeRoot, "bin", "acg.mjs");
const policyRoot = path.join(codeRoot, "governance");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-subagent-route-"));
  const repository = path.join(root, "repository");
  const worktreeRoot = path.join(root, "worktrees");
  const worktree = path.join(worktreeRoot, "pascal");
  fs.mkdirSync(repository);
  fs.mkdirSync(worktreeRoot);
  execFileSync("git", ["init", "-q", repository]);
  git(repository, ["config", "user.email", "fixture@example.invalid"]);
  git(repository, ["config", "user.name", "Fixture"]);
  fs.writeFileSync(path.join(repository, "storage.rs"), "fixture\n");
  git(repository, ["add", "storage.rs"]);
  git(repository, ["commit", "-q", "-m", "fixture"]);
  const base = git(repository, ["rev-parse", "HEAD"]);
  const profile = path.join(root, "machine-profile.json");
  fs.writeFileSync(profile, JSON.stringify({
    schema_version: 1,
    project_roots: { "example-enterprise": [repository] }
  }));
  const prepared = JSON.parse(execFileSync(process.execPath, [
    helper, "prepare",
    "--project", "example-enterprise",
    "--repository", repository,
    "--base", base,
    "--work-id", "EXAMPLE-PROVIDER-STORAGE",
    "--seat", "Pascal",
    "--worktree", worktree,
    "--write-scope", "storage.rs",
    "--write-scope", "large-untracked.bin"
  ], { encoding: "utf8", env: { ...process.env, TMPDIR: root } }));
  return {
    root,
    repository,
    base,
    worktree,
    prepared,
    withProfile(run) {
      const previous = process.env.ACG_MACHINE_PROFILE;
      process.env.ACG_MACHINE_PROFILE = profile;
      try { return run(); }
      finally {
        if (previous === undefined) delete process.env.ACG_MACHINE_PROFILE;
        else process.env.ACG_MACHINE_PROFILE = previous;
      }
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function request(value, receipt = null) {
  return {
    mode: "mutation",
    phase: "implementation",
    project: "example-enterprise",
    operations: ["implementation"],
    tools: ["filesystem_write"],
    paths: [path.join(value.worktree, "storage.rs")],
    risk_tags: [],
    mutation_authority: true,
    ...(receipt ? { subagent_worktree_receipt: receipt } : {})
  };
}

test("verified assignment receipt grants the prepared worktree root", () => {
  const value = fixture();
  try {
    assert.throws(() => resolveRoute(request(value), policyRoot), /outside approved roots/);
    const routed = value.withProfile(() => resolveRoute(request(value, value.prepared.receipt_path), policyRoot));
    const capability = routed.resolution_receipt.authorization_decision.subagent_worktree_capability;
    assert.equal(capability.receipt_sha256, value.prepared.receipt_sha256);
    assert.equal(capability.worktree, fs.realpathSync(value.worktree));
    assert.equal(capability.branch, "codex/example-provider-storage/pascal");
    assert.equal(capability.authority, "receipt_bound_worktree");
  } finally {
    value.cleanup();
  }
});

test("a rehashed receipt cannot grant its worktree to a different request project", () => {
  const value = fixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(value.prepared.receipt_path, "utf8"));
    receipt.work_id = "rehash-does-not-rebind-project";
    const unsigned = { ...receipt };
    delete unsigned.receipt_sha256;
    receipt.receipt_sha256 = `sha256:${crypto.createHash("sha256").update(JSON.stringify(unsigned)).digest("hex")}`;
    fs.writeFileSync(value.prepared.receipt_path, JSON.stringify(receipt));
    assert.throws(
      () => value.withProfile(() => resolveRoute({ ...request(value, value.prepared.receipt_path), project: "other-project" }, policyRoot)),
      /Continuation receipt project does not match --project/
    );
  } finally {
    value.cleanup();
  }
});

test("a low-level helper cannot mint a project-B route capability over project-A lineage", () => {
  const value = fixture();
  try {
    const spoofed = JSON.parse(execFileSync(process.execPath, [
      helper, "prepare",
      "--project", "other-project",
      "--repository", value.repository,
      "--base", value.base,
      "--work-id", "PROJECT-B-SPOOF",
      "--seat", "attacker",
      "--worktree", path.join(value.root, "worktrees", "spoofed"),
      "--write-scope", "storage.rs"
    ], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
    const spoofedValue = { ...value, worktree: spoofed.worktree };
    assert.throws(
      () => value.withProfile(() => resolveRoute({
        ...request(spoofedValue, spoofed.receipt_path),
        project: "other-project"
      }, policyRoot)),
      /Repository belongs to unrelated project: example-enterprise/
    );
  } finally {
    value.cleanup();
  }
});

test("tampered receipt and branch mismatch fail closed", () => {
  const tampered = fixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(tampered.prepared.receipt_path, "utf8"));
    receipt.seat = "Other";
    fs.writeFileSync(tampered.prepared.receipt_path, JSON.stringify(receipt, null, 2) + "\n");
    assert.throws(() => tampered.withProfile(() => resolveRoute(request(tampered, tampered.prepared.receipt_path), policyRoot)), /receipt digest is invalid/);
  } finally {
    tampered.cleanup();
  }

  const wrongBranch = fixture();
  try {
    git(wrongBranch.worktree, ["switch", "-q", "-c", "wrong-branch"]);
    assert.throws(() => wrongBranch.withProfile(() => resolveRoute(request(wrongBranch, wrongBranch.prepared.receipt_path), policyRoot)), /branch mismatch/);
  } finally {
    wrongBranch.cleanup();
  }
});

test("router verifies bounded large continuation evidence and detects later source changes", () => {
  const value = fixture();
  try {
    fs.writeFileSync(path.join(value.worktree, "storage.rs"), "x".repeat(1024 * 1024 + 257));
    fs.writeFileSync(path.join(value.worktree, "large-untracked.bin"), "y".repeat(1024 * 1024 + 509));
    const continued = JSON.parse(execFileSync(process.execPath, [
      helper, "continue", "--receipt", value.prepared.receipt_path, "--expected-head", value.prepared.base_commit
    ], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
    assert.doesNotMatch(fs.readFileSync(continued.receipt_path, "utf8"), /xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/);
    const routed = value.withProfile(() => resolveRoute(request(value, continued.receipt_path), policyRoot));
    assert.equal(routed.resolution_receipt.authorization_decision.decision, "allow");
    fs.appendFileSync(path.join(value.worktree, "storage.rs"), "changed");
    assert.throws(() => value.withProfile(() => resolveRoute(request(value, continued.receipt_path), policyRoot)), /dirty state changed/);
  } finally {
    value.cleanup();
  }
});

test("router accepts generated-only continuation receipts without write_scope", () => {
  const value = fixture();
  try {
    const generated = path.join(value.worktree, "node_modules", "generated.bin");
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(generated, "g".repeat(1024 * 1024 + 31));
    const prepared = JSON.parse(execFileSync(process.execPath, [
      helper, "prepare", "--project", "example-enterprise", "--repository", path.join(value.root, "repository"),
      "--base", value.prepared.base_commit, "--work-id", "generated-only", "--seat", "generated",
      "--worktree", path.join(value.root, "worktrees", "generated"), "--generated-scope", "node_modules"
    ], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
    fs.mkdirSync(path.join(prepared.worktree, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(prepared.worktree, "node_modules", "generated.bin"), "g".repeat(1024 * 1024 + 31));
    const continued = JSON.parse(execFileSync(process.execPath, [helper, "continue", "--receipt", prepared.receipt_path, "--expected-head", value.prepared.base_commit], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
    const receipt = JSON.parse(fs.readFileSync(continued.receipt_path, "utf8"));
    delete receipt.write_scope;
    const unsigned = { ...receipt };
    delete unsigned.receipt_sha256;
    receipt.receipt_sha256 = `sha256:${crypto.createHash("sha256").update(JSON.stringify(unsigned)).digest("hex")}`;
    fs.writeFileSync(continued.receipt_path, JSON.stringify(receipt));
    const generatedRequest = { ...request({ ...value, worktree: prepared.worktree }, continued.receipt_path), paths: [prepared.worktree] };
    assert.equal(value.withProfile(() => resolveRoute(generatedRequest, policyRoot)).resolution_receipt.authorization_decision.decision, "allow");
    fs.rmSync(path.join(prepared.worktree, "node_modules"), { recursive: true, force: true });
    fs.symlinkSync(value.root, path.join(prepared.worktree, "node_modules"));
    assert.throws(() => value.withProfile(() => resolveRoute(generatedRequest, policyRoot)), /Generated output scope root must not be a symlink/);
  } finally {
    value.cleanup();
  }
});

test("top-level communication owns one lifecycle without stdin", () => {
  const value = fixture();
  try {
    const output = value.withProfile(() => JSON.parse(execFileSync(process.execPath, [
      cli,
      "communicate",
      "--project", "example-enterprise",
      "--target", "fixture-task",
      "--scope", value.worktree,
      "--subagent-worktree-receipt", value.prepared.receipt_path
    ], { encoding: "utf8" })));
    assert.equal(output.command, "communicate");
    assert.equal(output.communication_authorized, true);
    assert.equal(output.message_sent, false);
    assert.equal(output.routing.lifecycle_calls, 1);
    assert.equal(output.canonical_request.subagent_worktree_receipt, value.prepared.receipt_path);
    assert.ok(Object.values(output.routing).some((entry) => typeof entry === "string" && entry.startsWith("sha256:")));
  } finally {
    value.cleanup();
  }
});

test("medium-agent instructions do not reauthorize preapproved swarm communication", () => {
  const kernel = fs.readFileSync(path.join(codeRoot, "governance", "kernel", "AGENTS.md"), "utf8");
  const moduleText = fs.readFileSync(path.join(codeRoot, "governance", "modules", "subagent-git.md"), "utf8");
  const delegationText = fs.readFileSync(path.join(codeRoot, "governance", "modules", "delegation.md"), "utf8");
  const releaseText = fs.readFileSync(path.join(codeRoot, "governance", "modules", "release.md"), "utf8");
  const skill = fs.readFileSync(path.join(codeRoot, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  for (const text of [moduleText, skill]) assert.match(text, /route_request_field/);
  assert.match(skill, /Send explicitly user-approved task-to-task messages/);
  assert.match(skill, /Do not invoke a second route, delivery, acknowledgment/);
  assert.match(skill, /Keep project status, architecture, audit findings, and product failures/);
  assert.match(skill, /registered\/ambiguous\s+binding/);
  assert.match(skill, /not project work/);
  assert.match(skill, /self-service commands/);
  assert.match(releaseText, /Running tasks use their ledger release/);
  assert.match(delegationText, /Never pass a parent policy acknowledgment as a child's `prior_receipt`/);
  assert.match(delegationText, /Keep ledgers separate/);
  assert.doesNotMatch(kernel, /For task communication, use `node .*acg\.mjs communicate/);
  assert.doesNotMatch(skill, /Authorize an actual task-to-task message with/);
});

test("runtime-defect fallback blocks only the affected action and keeps repair private", () => {
  const delegation = fs.readFileSync(path.join(codeRoot, "governance", "modules", "delegation.md"), "utf8");
  const modelRouting = fs.readFileSync(path.join(codeRoot, "governance", "modules", "model-routing.md"), "utf8");
  const release = fs.readFileSync(path.join(codeRoot, "governance", "modules", "release.md"), "utf8");

  assert.match(delegation, /immediately\s+continues\s+through\s+existing\s+tools\s+or\s+native\s+tools\s+within\s+current\s+authority/);
  assert.match(delegation, /Agent\s+System\s+may\s+reject\s+an\s+improper\s+Seat\s+`0`\s+action\s+but\s+never\s+blocks\s+the\s+project/);
  assert.match(modelRouting, /accepting it is telemetry that this\s+path is not hook-gated/);
  assert.match(modelRouting, /Do\s+not repeat unchanged diagnostic launches or wait for Agent System\s+repair/);
  assert.match(modelRouting, /Block only that\s+action and continue unrelated work/i);
  assert.match(release, /may change only private Agent\s+System code, configuration, isolated worktrees, and private release lanes/);
  assert.match(release, /cannot mutate the reporting project, its worktrees or\s+continuity, or any public branch/);
  assert.match(release, /reporting project never waits\s+for that repair or activation/);
});
