import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const helper = path.resolve("skills/govern-codex-policy/scripts/subagent-git.mjs");

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-continuation-"));
  const repository = path.join(root, "repo");
  const worktree = path.join(root, "seat");
  fs.mkdirSync(path.join(repository, "docs"), { recursive: true });
  git(repository, ["init"]);
  git(repository, ["config", "user.email", "acg@example.invalid"]);
  git(repository, ["config", "user.name", "ACG Test"]);
  fs.writeFileSync(path.join(repository, "docs", "ROADMAP.md"), "before\n");
  fs.writeFileSync(path.join(repository, "outside.txt"), "before\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "fixture"]);
  const base = git(repository, ["rev-parse", "HEAD"]);
  const prepared = JSON.parse(execFileSync(process.execPath, [helper, "prepare", "--project", "fixture", "--repository", repository, "--base", base, "--work-id", "roadmap", "--seat", "writer", "--worktree", worktree, "--write-scope", "docs/ROADMAP.md"], { encoding: "utf8", env: { ...process.env, TMPDIR: root } }));
  return { root, repository, worktree, base, receipt: prepared.receipt_path };
}

function run(args, root) {
  return spawnSync(process.execPath, [helper, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: { ...process.env, TMPDIR: root } });
}

test("same seat can bind and verify expected scoped dirty state", () => {
  const item = fixture();
  fs.writeFileSync(path.join(item.worktree, "docs", "ROADMAP.md"), "after\n");
  const continued = run(["continue", "--receipt", item.receipt, "--expected-head", item.base], item.root);
  assert.equal(continued.status, 0, continued.stderr);
  const output = JSON.parse(continued.stdout);
  assert.deepEqual(output.dirty_paths, ["docs/ROADMAP.md"]);
  assert.match(output.completion_sentinel, /^ACG_SUBAGENT_CONTINUATION_VERIFIED:/);
  const verified = run(["verify", "--receipt", output.receipt_path], item.root);
  assert.equal(verified.status, 0, verified.stderr);
  const verifiedOutput = JSON.parse(verified.stdout);
  assert.equal(verifiedOutput.continuation, true);
  assert.equal(verifiedOutput.completion_sentinel, output.completion_sentinel);
});

test("initial verification remains clean-only", () => {
  const item = fixture();
  const clean = run(["verify", "--receipt", item.receipt], item.root);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(JSON.parse(clean.stdout).completion_sentinel, /^ACG_SUBAGENT_WORKTREE_VERIFIED:/);
  fs.writeFileSync(path.join(item.worktree, "docs", "ROADMAP.md"), "after\n");
  const verified = run(["verify", "--receipt", item.receipt], item.root);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /use continue/);
});

test("continuation rejects an outside-scope dirty path", () => {
  const item = fixture();
  fs.writeFileSync(path.join(item.worktree, "docs", "ROADMAP.md"), "after\n");
  fs.writeFileSync(path.join(item.worktree, "outside.txt"), "after\n");
  const continued = run(["continue", "--receipt", item.receipt, "--expected-head", item.base], item.root);
  assert.notEqual(continued.status, 0);
  assert.match(continued.stderr, /outside declared write scope/);
});

test("continuation receipt fails after dirty state changes", () => {
  const item = fixture();
  fs.writeFileSync(path.join(item.worktree, "docs", "ROADMAP.md"), "after\n");
  const continued = JSON.parse(run(["continue", "--receipt", item.receipt, "--expected-head", item.base], item.root).stdout);
  fs.appendFileSync(path.join(item.worktree, "docs", "ROADMAP.md"), "changed again\n");
  const verified = run(["verify", "--receipt", continued.receipt_path], item.root);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /dirty state changed/);
});

test("continuation bounds large dirty path-list metadata without capturing binary diff output", () => {
  const item = fixture();
  const prepared = JSON.parse(run([
    "prepare", "--project", "fixture", "--repository", item.repository, "--base", item.base,
    "--work-id", "large-path-list", "--seat", "path-writer",
    "--worktree", path.join(item.root, "path-seat"), "--write-scope", "docs"
  ], item.root).stdout);
  const name = "p".repeat(210);
  for (let index = 0; index < 6000; index += 1) {
    fs.writeFileSync(path.join(prepared.worktree, "docs", `${name}-${String(index).padStart(5, "0")}`), "x\n");
  }
  git(prepared.worktree, ["add", "docs"]);
  const continued = run(["continue", "--receipt", prepared.receipt_path, "--expected-head", item.base], item.root);
  assert.equal(continued.status, 0, continued.stderr);
  const output = JSON.parse(continued.stdout);
  assert.equal(output.dirty_paths.length, 6000);
  assert.match(output.completion_sentinel, /^ACG_SUBAGENT_CONTINUATION_VERIFIED:/);
});

test("declared generated output is omitted from continuation payloads without hiding tracked changes", () => {
  const item = fixture();
  const generated = path.join(item.worktree, "node_modules", "large");
  fs.mkdirSync(generated, { recursive: true });
  fs.writeFileSync(path.join(generated, "payload.bin"), "generated\n");
  fs.writeFileSync(path.join(item.worktree, "docs", "ROADMAP.md"), "after\n");
  const generatedReceipt = JSON.parse(execFileSync(process.execPath, [helper, "prepare", "--project", "fixture", "--repository", item.repository, "--base", item.base, "--work-id", "generated", "--seat", "writer-generated", "--worktree", path.join(item.root, "generated-seat"), "--write-scope", "docs/ROADMAP.md", "--generated-scope", "node_modules"], { encoding: "utf8", env: { ...process.env, TMPDIR: item.root } }));
  fs.mkdirSync(path.join(generatedReceipt.worktree, "node_modules", "large"), { recursive: true });
  fs.writeFileSync(path.join(generatedReceipt.worktree, "node_modules", "large", "payload.bin"), "generated\n");
  fs.writeFileSync(path.join(generatedReceipt.worktree, "docs", "ROADMAP.md"), "after\n");
  const continued = JSON.parse(run(["continue", "--receipt", generatedReceipt.receipt_path, "--expected-head", item.base], item.root).stdout);
  assert.deepEqual(continued.dirty_paths, ["docs/ROADMAP.md"]);
  assert.equal(JSON.parse(fs.readFileSync(continued.receipt_path, "utf8")).generated_output_scope[0], "node_modules");
});

test("generated-only continuation binds roots but never generated contents", () => {
  const item = fixture();
  const prepared = JSON.parse(run([
    "prepare", "--project", "fixture", "--repository", item.repository, "--base", item.base,
    "--work-id", "frozen", "--seat", "frozen-writer",
    "--worktree", path.join(item.root, "frozen-seat"),
    "--generated-scope", "node_modules"
  ], item.root).stdout);
  const payload = path.join(prepared.worktree, "node_modules", "package", "payload.bin");
  fs.mkdirSync(path.dirname(payload), { recursive: true });
  fs.writeFileSync(payload, "first generated payload\n");
  const continued = JSON.parse(run(["continue", "--receipt", prepared.receipt_path, "--expected-head", item.base], item.root).stdout);
  const receiptText = fs.readFileSync(continued.receipt_path, "utf8");
  assert.deepEqual(continued.dirty_paths, []);
  assert.deepEqual(JSON.parse(receiptText).generated_output_scope_roots, ["node_modules"]);
  assert.doesNotMatch(receiptText, /first generated payload|payload\.bin/);
  fs.writeFileSync(payload, "changed generated payload\n");
  const verified = run(["verify", "--receipt", continued.receipt_path], item.root);
  assert.equal(verified.status, 0, verified.stderr);
  assert.doesNotMatch(fs.readFileSync(continued.receipt_path, "utf8"), /changed generated payload/);
});

test("tracked changes inside generated scope fail closed", () => {
  const item = fixture();
  const prepared = JSON.parse(run([
    "prepare", "--project", "fixture", "--repository", item.repository, "--base", item.base,
    "--work-id", "generated-tracked", "--seat", "tracked-writer",
    "--worktree", path.join(item.root, "tracked-seat"),
    "--generated-scope", "node_modules"
  ], item.root).stdout);
  const payload = path.join(prepared.worktree, "node_modules", "payload.bin");
  fs.mkdirSync(path.dirname(payload), { recursive: true });
  fs.writeFileSync(payload, "tracked generated payload\n");
  git(prepared.worktree, ["add", "-f", "node_modules/payload.bin"]);
  const continued = run(["continue", "--receipt", prepared.receipt_path, "--expected-head", item.base], item.root);
  assert.notEqual(continued.status, 0);
  assert.match(continued.stderr, /Generated output scope contains tracked changes/);
});

test("seat zero is rejected before a worker worktree is created", () => {
  const item = fixture();
  const result = run(["prepare", "--project", "fixture", "--repository", item.repository, "--base", item.base, "--work-id", "zero", "--seat", "0", "--worktree", path.join(item.root, "zero-seat"), "--write-scope", "docs/ROADMAP.md"], item.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Seat 0 is reserved/);
  assert.equal(fs.existsSync(path.join(item.root, "zero-seat")), false);
});
