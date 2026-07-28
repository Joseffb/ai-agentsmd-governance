import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import {
  acceptHandoffWorkflow,
  authorizeHandoffCommunication,
  codeRoot,
  formatGovernanceError,
  listPolicyCatalog,
  resolveRoute,
  verifyHandoffWorkflow
} from "../lib/core.mjs";

const policyRoot = path.join(codeRoot, "governance");
const cli = path.join(codeRoot, "bin", "acg.mjs");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function workingTreeDigest(root) {
  const records = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) records.push([path.relative(root, absolute), fs.readFileSync(absolute, "utf8")]);
    }
  }
  visit(root);
  return JSON.stringify(records);
}

function fixture({ mode = "project_managed", projection = false, continuityOverride = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-handoff-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "Fixture"]);
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-q", "-m", "fixture"]);
  git(repo, ["switch", "-q", "-c", "codex/handoff-test"]);
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const handoff = path.join(root, "handoff.md");
  fs.writeFileSync(handoff, [
    "# Fixture Handoff",
    "",
    "## End Goal",
    "",
    "Resume the bounded fixture objective.",
    "",
    "## Repository And Candidate",
    "",
    `- Repository of record: \`${repo}\``,
    `- Worktree: \`${repo}\``,
    "- Branch: `codex/handoff-test`",
    `- Handoff candidate: \`${commit}\``,
    "- Work ID: `FIX-1`",
    "",
    "## Validation",
    "",
    "- `node --test`: passed",
    "",
    "## Blockers",
    "",
    "- none",
    "",
    "## Open Work",
    "",
    "- finish the fixture",
    "",
    "Next action: accept the verified fixture.",
    ""
  ].join("\n"));
  const pointer = path.join(root, "pointer.md");
  fs.writeFileSync(pointer, `Fixture pointer: \`${handoff}\`\n`);
  const eventLog = path.join(repo, ".codex", "project-memory.jsonl");
  const projectionFile = projection ? path.join(repo, ".codex", "PROJECT-STATE.md") : null;
  const continuity = continuityOverride ?? {
    mode,
    ...(mode === "project_managed" ? { event_log: eventLog, projection: projectionFile } : {})
  };
  const profile = path.join(root, "machine-profile.json");
  fs.writeFileSync(profile, JSON.stringify({
    approved_roots: [root, codeRoot],
    project_roots: { "fixture-project": [root] },
    handoff_projects: {
      "fixture-project": {
        repository: repo,
        continuity
      }
    }
  }, null, 2));
  const previousProfile = process.env.ACG_MACHINE_PROFILE;
  process.env.ACG_MACHINE_PROFILE = profile;
  return {
    root,
    repo,
    handoff,
    pointer,
    eventLog,
    projectionFile,
    restore() {
      if (previousProfile === undefined) delete process.env.ACG_MACHINE_PROFILE;
      else process.env.ACG_MACHINE_PROFILE = previousProfile;
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function verifyOptions(value) {
  return {
    project: "fixture-project",
    handoff: value.handoff,
    pointer: value.pointer
  };
}

test("one-command handoff verification succeeds without writes or communication", { concurrency: false }, () => {
  const value = fixture();
  try {
    const before = workingTreeDigest(value.root);
    const output = JSON.parse(execFileSync(process.execPath, [
      cli,
      "handoff",
      "verify",
      "--project", "fixture-project",
      "--handoff", value.handoff,
      "--pointer", value.pointer
    ], { encoding: "utf8", env: process.env }));
    assert.equal(output.verified, true);
    assert.equal(output.routing.lifecycle_calls, 1);
    assert.deepEqual(output.verification_receipt.context_acknowledgment.operations, ["read_file", "resume_work"]);
    assert.equal(output.verification_receipt.context_acknowledgment.operations.includes("communicate"), false);
    assert.equal(output.purity.passed, true);
    assert.equal(workingTreeDigest(value.root), before);
  } finally {
    value.restore();
  }
});

test("pre-existing dirty state is unchanged and reported", { concurrency: false }, () => {
  const value = fixture();
  try {
    fs.appendFileSync(path.join(value.repo, "README.md"), "dirty\n");
    const before = git(value.repo, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const result = verifyHandoffWorkflow(verifyOptions(value), policyRoot);
    assert.equal(result.purity.repositories[0].pre_existing_dirty, true);
    assert.ok(result.purity.repositories[0].pre_existing_changes.some((entry) => entry.includes("README.md")));
    assert.equal(git(value.repo, ["status", "--porcelain=v1", "--untracked-files=all"]), before);
  } finally {
    value.restore();
  }
});

test("a change introduced during verification fails the purity check", { concurrency: false }, () => {
  const value = fixture();
  try {
    assert.throws(
      () => verifyHandoffWorkflow(verifyOptions(value), policyRoot, {
        afterRouting: () => fs.writeFileSync(path.join(value.repo, "introduced.txt"), "unexpected\n")
      }),
      /Read-only purity check failed/
    );
  } finally {
    value.restore();
  }
});

test("invalid project and handoff paths fail clearly", { concurrency: false }, () => {
  const value = fixture();
  try {
    assert.throws(() => verifyHandoffWorkflow({ ...verifyOptions(value), project: "INVALID PROJECT" }, policyRoot), /lowercase slug/);
    assert.throws(() => verifyHandoffWorkflow({ ...verifyOptions(value), handoff: path.join(value.root, "missing.md") }, policyRoot), /Handoff is unreadable/);
  } finally {
    value.restore();
  }
});

test("full receipt acceptance appends exactly one concise event", { concurrency: false }, () => {
  const value = fixture();
  try {
    const verification = verifyHandoffWorkflow(verifyOptions(value), policyRoot);
    const result = acceptHandoffWorkflow({
      verification,
      authorizeMemoryWrite: true
    }, policyRoot);
    assert.equal(result.accepted, true);
    const lines = fs.readFileSync(value.eventLog, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.event, "resumed");
    assert.equal(event.work_id, "FIX-1");
    assert.equal(Object.hasOwn(event, "raw_prompt"), false);
    assert.throws(
      () => acceptHandoffWorkflow({ verification, authorizeMemoryWrite: true }, policyRoot),
      /already accepted/
    );
  } finally {
    value.restore();
  }
});

test("receipt digest alone and mismatched projects are rejected", { concurrency: false }, () => {
  const value = fixture();
  try {
    const verification = verifyHandoffWorkflow(verifyOptions(value), policyRoot);
    assert.throws(
      () => acceptHandoffWorkflow({ verification: verification.verification_receipt.receipt_sha256 }, policyRoot),
      /full handoff verification receipt object/
    );
    assert.throws(
      () => acceptHandoffWorkflow({ verification, project: "another-project", authorizeMemoryWrite: true }, policyRoot),
      /project mismatch/
    );
  } finally {
    value.restore();
  }
});

test("projection is updated only when configured", { concurrency: false }, () => {
  const withProjection = fixture({ projection: true });
  try {
    const verification = verifyHandoffWorkflow(verifyOptions(withProjection), policyRoot);
    acceptHandoffWorkflow({ verification, authorizeMemoryWrite: true }, policyRoot);
    assert.equal(fs.existsSync(withProjection.projectionFile), true);
  } finally {
    withProjection.restore();
  }
  const withoutProjection = fixture();
  try {
    const verification = verifyHandoffWorkflow(verifyOptions(withoutProjection), policyRoot);
    acceptHandoffWorkflow({ verification, authorizeMemoryWrite: true }, policyRoot);
    assert.equal(withoutProjection.projectionFile, null);
    assert.equal(fs.existsSync(path.join(withoutProjection.repo, ".codex", "PROJECT-STATE.md")), false);
  } finally {
    withoutProjection.restore();
  }
});

test("global ad-hoc memory is never canonical continuity", { concurrency: false }, () => {
  const value = fixture({
    continuityOverride: {
      mode: "project_managed",
      event_log: path.join(os.homedir(), ".codex", "memories", "extensions", "ad_hoc", "notes", "example-project.jsonl")
    }
  });
  try {
    assert.throws(() => verifyHandoffWorkflow(verifyOptions(value), policyRoot), /Global ad-hoc memory cannot be selected/);
  } finally {
    value.restore();
  }
});

test("non-writing continuity modes accept without filesystem mutation", { concurrency: false }, () => {
  for (const mode of ["read_only", "not_applicable", "non_repository", "externally_managed"]) {
    const value = fixture({ mode });
    try {
      const before = workingTreeDigest(value.root);
      const verification = verifyHandoffWorkflow(verifyOptions(value), policyRoot);
      const result = acceptHandoffWorkflow({ verification }, policyRoot);
      assert.equal(result.continuity.written, false);
      assert.equal(fs.existsSync(value.eventLog), false);
      assert.equal(workingTreeDigest(value.root), before);
    } finally {
      value.restore();
    }
  }
});

test("communication helper supplies communication authority", { concurrency: false }, () => {
  const value = fixture({ mode: "read_only" });
  try {
    const result = authorizeHandoffCommunication({
      project: "fixture-project",
      target: "task-123",
      scope: value.repo
    }, policyRoot);
    assert.deepEqual(result.canonical_request.authorities, ["communication"]);
    assert.equal(result.message_sent, false);
  } finally {
    value.restore();
  }
});

test("catalog and structured errors require one-step correction", () => {
  const catalog = listPolicyCatalog("all", policyRoot);
  assert.ok(catalog.catalogs.operations);
  assert.ok(catalog.catalogs.tools);
  assert.ok(catalog.catalogs["risk-tags"]);
  assert.ok(catalog.catalogs.authorities);
  let enumError;
  try {
    resolveRoute({ mode: "default", phase: "handoff", project: "fixture-project", operations: ["read_file"] }, policyRoot);
  } catch (error) {
    enumError = formatGovernanceError(error, "route");
  }
  assert.equal(enumError.code, "invalid_enum");
  assert.match(enumError.error, /Valid values/);
  let typeError;
  try {
    resolveRoute({ mode: "read_only", phase: "handoff", project: "fixture-project", operations: ["read_file"], mutation_authority: [] }, policyRoot);
  } catch (error) {
    typeError = formatGovernanceError(error, "route");
  }
  assert.equal(typeError.code, "invalid_type");
  assert.match(typeError.error, /expected boolean/);
});

test("skill documents the high-level handoff workflow", () => {
  const skill = fs.readFileSync(path.join(codeRoot, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  assert.match(skill, /handoff verify/);
  assert.match(skill, /handoff accept/);
  assert.match(skill, /handoff communicate/);
  assert.match(skill, /list all/);
  assert.match(skill, /Global ad-hoc memory notes are supplementary/);
});
