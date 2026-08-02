import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const helper = fileURLToPath(new URL("../skills/govern-codex-policy/scripts/subagent-git.mjs", import.meta.url));
const kernel = new URL("../governance/kernel/AGENTS.md", import.meta.url);
const moduleFile = new URL("../governance/modules/subagent-git.md", import.meta.url);
const skill = new URL("../skills/govern-codex-policy/SKILL.md", import.meta.url);

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-subagent-git-"));
  const repository = path.join(root, "repository");
  const worktrees = path.join(root, "worktrees");
  fs.mkdirSync(repository);
  fs.mkdirSync(worktrees);
  execFileSync("git", ["init", "-q", repository]);
  git(repository, ["config", "user.email", "fixture@example.invalid"]);
  git(repository, ["config", "user.name", "Fixture"]);
  fs.writeFileSync(path.join(repository, "README.md"), "fixture\n");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "-q", "-m", "fixture"]);
  const base = git(repository, ["rev-parse", "HEAD"]);
  return {
    root,
    repository,
    worktrees,
    base,
    worktree: path.join(worktrees, "hegels-seat"),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function prepare(value) {
  return JSON.parse(execFileSync(process.execPath, [
    helper,
    "prepare",
    "--project", "fixture",
    "--repository", value.repository,
    "--base", value.base,
    "--work-id", "EXAMPLE-SEC",
    "--seat", "Hegel",
    "--worktree", value.worktree
  ], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
}

test("prepare creates and proves an isolated mutating-seat worktree", () => {
  const value = fixture();
  try {
    const before = git(value.repository, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const output = prepare(value);
    assert.equal(output.prepared, true);
    assert.equal(output.fork_context_provides_git_isolation, false);
    assert.equal(output.branch, "codex/example-sec/hegel");
    assert.equal(fs.realpathSync(output.worktree), fs.realpathSync(value.worktree));
    assert.equal(git(value.worktree, ["rev-parse", "HEAD"]), value.base);
    assert.equal(git(value.worktree, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
    assert.equal(git(value.repository, ["status", "--porcelain=v1", "--untracked-files=all"]), before);
    assert.ok(fs.existsSync(output.receipt_path));

    const verified = JSON.parse(execFileSync(process.execPath, [
      helper, "verify", "--receipt", output.receipt_path
    ], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
    assert.equal(verified.verified, true);
    assert.equal(verified.mutation_allowed_in_assigned_worktree, true);
    assert.match(verified.completion_sentinel, /^ACG_SUBAGENT_WORKTREE_VERIFIED:/);
  } finally {
    value.cleanup();
  }
});

test("verification fails closed if the seat worktree changed before preflight", () => {
  const value = fixture();
  try {
    const output = prepare(value);
    fs.writeFileSync(path.join(value.worktree, "unexpected.txt"), "changed\n");
    assert.throws(() => execFileSync(process.execPath, [
      helper, "verify", "--receipt", output.receipt_path
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /Assigned worktree is not clean before mutation/);
  } finally {
    value.cleanup();
  }
});

test("prepare rejects ambiguous bases and unsafe worktree targets", () => {
  const value = fixture();
  try {
    assert.throws(() => execFileSync(process.execPath, [
      helper, "prepare",
      "--project", "fixture",
      "--repository", value.repository,
      "--base", value.base.slice(0, 12),
      "--work-id", "EXAMPLE-SEC",
      "--seat", "Hegel",
      "--worktree", value.worktree
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /exact 40-character commit SHA/);

    assert.throws(() => execFileSync(process.execPath, [
      helper, "prepare",
      "--project", "fixture",
      "--repository", value.repository,
      "--base", value.base,
      "--work-id", "EXAMPLE-SEC",
      "--seat", "Hegel",
      "--worktree", path.join(value.repository, "nested-worktree")
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /outside the repository of record/);
  } finally {
    value.cleanup();
  }
});

test("prepare rejects an unregistered copy that forges a registered worktree's Git metadata", () => {
  const value = fixture();
  try {
    const registered = path.join(value.worktrees, "registered");
    const forged = path.join(value.worktrees, "forged");
    git(value.repository, ["worktree", "add", "-b", "codex/existing-fake/writer", registered, value.base]);
    fs.cpSync(registered, forged, { recursive: true });
    assert.throws(() => execFileSync(process.execPath, [
      helper, "prepare",
      "--project", "fixture",
      "--repository", value.repository,
      "--base", value.base,
      "--work-id", "existing-fake",
      "--seat", "writer",
      "--worktree", forged,
      "--allow-existing-clean-worktree", "yes",
      "--write-scope", "README.md"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /not registered by the canonical repository/);
  } finally {
    value.cleanup();
  }
});

test("invalid generated declarations leave no branch or worktree", () => {
  const value = fixture();
  try {
    assert.throws(() => execFileSync(process.execPath, [
      helper, "prepare",
      "--project", "fixture",
      "--repository", value.repository,
      "--base", value.base,
      "--work-id", "invalid-generated",
      "--seat", "writer",
      "--worktree", value.worktree,
      "--write-scope", "README.md",
      "--generated-scope", "README.md"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /overlaps write scope/);
    assert.equal(fs.existsSync(value.worktree), false);
    assert.notEqual(spawnSync("git", ["-C", value.repository, "show-ref", "--verify", "--quiet", "refs/heads/codex/invalid-generated/writer"]).status, 0);
  } finally {
    value.cleanup();
  }
});

test("continue accepts new untracked files beneath a declared top-level write scope", () => {
  const value = fixture();
  try {
    const prepared = JSON.parse(execFileSync(process.execPath, [
      helper, "prepare",
      "--project", "fixture",
      "--repository", value.repository,
      "--base", value.base,
      "--work-id", "top-level-untracked",
      "--seat", "writer",
      "--worktree", value.worktree,
      "--write-scope", "app"
    ], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
    fs.mkdirSync(path.join(value.worktree, "app"));
    fs.writeFileSync(path.join(value.worktree, "app", "new-file.txt"), "new\n");

    const continued = JSON.parse(execFileSync(process.execPath, [
      helper, "continue",
      "--receipt", prepared.receipt_path,
      "--expected-head", value.base
    ], { encoding: "utf8", env: { ...process.env, TMPDIR: value.root } }));
    assert.equal(continued.continuation, true);
    assert.deepEqual(continued.dirty_paths, ["app/new-file.txt"]);
  } finally {
    value.cleanup();
  }
});

test("kernel, module, and skill explain the medium-agent workflow explicitly", () => {
  const kernelText = fs.readFileSync(kernel, "utf8");
  const moduleText = fs.readFileSync(moduleFile, "utf8");
  const skillText = fs.readFileSync(skill, "utf8");
  assert.match(kernelText, /delegation/);
  for (const text of [moduleText, skillText]) {
    assert.match(text, /fork_context/);
    assert.match(text, /before launch|before `spawn_agent`|before mutation/i);
    assert.match(text, /subagent-git\.mjs/);
    assert.match(text, /workdir/);
  }
});
