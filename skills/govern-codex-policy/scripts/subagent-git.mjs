#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const GIT_TEXT_MAX_BUFFER = 16 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    // Path/status metadata is bounded; binary diffs are streamed to a
    // temporary evidence file and incrementally hashed below.
    maxBuffer: GIT_TEXT_MAX_BUFFER
  }).trim();
}

// Receipts bind hashes, not binary patch contents.  Sending a potentially huge
// diff through spawnSync's stdout buffer previously raised ENOBUFS.
function gitEvidenceDigest(cwd, args) {
  const evidence = path.join(os.tmpdir(), `acg-git-evidence-${process.pid}-${crypto.randomUUID()}`);
  const out = fs.openSync(evidence, "wx", 0o600);
  try {
    const result = spawnSync("git", ["-C", cwd, ...args], { stdio: ["ignore", out, "pipe"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    if (result.status !== 0) fail(result.stderr?.toString().trim() || "Unable to collect Git evidence");
    return hashFile(evidence);
  } finally { fs.closeSync(out); fs.rmSync(evidence, { force: true }); }
}

function hashFile(file) {
  const hash = crypto.createHash("sha256");
  const input = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) { const count = fs.readSync(input, buffer, 0, buffer.length, null); if (!count) break; hash.update(buffer.subarray(0, count)); }
  } finally { fs.closeSync(input); }
  return `sha256:${hash.digest("hex")}`;
}

function parse(argv) {
  const command = argv[2];
  const values = {};
  for (let index = 3; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`Invalid argument near ${flag ?? "<end>"}`);
    const key = flag.slice(2);
    if (key === "write-scope" || key === "generated-scope") values[key] = [...(values[key] ?? []), value];
    else {
      if (values[key] !== undefined) fail(`Duplicate --${key}`);
      values[key] = value;
    }
  }
  return { command, values };
}

function required(values, name) {
  const value = values[name];
  if (!value) fail(`Missing required --${name}`);
  return value;
}

function existingAbsolute(value, label) {
  if (!path.isAbsolute(value)) fail(`${label} must be absolute: ${value}`);
  if (!fs.existsSync(value)) fail(`${label} is unreadable: ${value}`);
  return fs.realpathSync(value);
}

function newAbsolute(value, label) {
  if (!path.isAbsolute(value)) fail(`${label} must be absolute: ${value}`);
  const absolute = path.resolve(value);
  if (fs.existsSync(absolute)) fail(`${label} already exists: ${absolute}`);
  const parent = path.dirname(absolute);
  if (!fs.existsSync(parent)) fail(`${label} parent is unreadable; create and authorize it first: ${parent}`);
  return path.join(fs.realpathSync(parent), path.basename(absolute));
}

function slug(value, label) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized || normalized.length > 64) fail(`${label} cannot form a safe Git branch segment`);
  return normalized;
}

function workerSeat(value, label) {
  const seat = slug(value, label);
  if (seat === "0") fail("Seat 0 is reserved for the coordinator and cannot receive a worker assignment");
  return seat;
}

function project(value) {
  const requested = required({ project: value }, "project").trim();
  const stable = slug(requested, "Project");
  if (requested !== stable) fail(`Project must be the stable slug: ${stable}`);
  return stable;
}

function within(candidate, parent) {
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

function commonGitDirectory(cwd) {
  const value = git(cwd, ["rev-parse", "--git-common-dir"]);
  const absolute = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return fs.realpathSync(absolute);
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizeScope(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized === "." || normalized === ".git" || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized.startsWith(".git/")) {
    fail(`Write scope must be a safe repository-relative path below the root: ${value}`);
  }
  return normalized;
}

function scopes(values) {
  return [...new Set((values["write-scope"] ?? []).map(normalizeScope))].sort();
}

function generatedScopes(values) {
  return [...new Set((values["generated-scope"] ?? []).map(normalizeScope))].sort();
}

function overlaps(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function assertDistinctScopes(writeScope, generatedScope) {
  for (const generated of generatedScope) {
    if (writeScope.some((written) => overlaps(written, generated))) {
      fail(`Generated output scope overlaps write scope: ${generated}`);
    }
  }
}

function isWithinScope(relative, scope) {
  return relative === scope || relative.startsWith(`${scope}/`);
}

function literalPathspec(scope) {
  return `:(top,literal)${scope}`;
}

function literalExcludePathspec(scope) {
  return `:(top,exclude,literal)${scope}`;
}

function splitNul(value) {
  return value.split("\0").filter(Boolean).sort();
}

function dirtyState(worktree, generatedScope = []) {
  const trackedDiff = gitEvidenceDigest(worktree, ["diff", "--binary", "HEAD", "--"]);
  const trackedPaths = splitNul(git(worktree, ["diff", "--name-only", "-z", "HEAD", "--"]));
  for (const tracked of trackedPaths) {
    if (generatedScope.some((scope) => isWithinScope(tracked, scope))) {
      fail(`Generated output scope contains tracked changes and is non-integrable: ${tracked}`);
    }
  }
  const exclusions = generatedScope.map(literalExcludePathspec);
  const untrackedPaths = splitNul(git(worktree, ["ls-files", "--others", "--exclude-standard", "-z", "--", ":(top,literal)", ...exclusions]));
  const dirtyPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  const untracked = untrackedPaths.map((relative) => {
    const absolute = path.join(worktree, ...relative.split("/"));
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return { path: relative, type: "symlink", value: fs.readlinkSync(absolute) };
    if (stat.isFile()) return { path: relative, type: "file", size: stat.size, sha256: hashFile(absolute) };
    fail(`Unsupported untracked path type: ${relative}`);
  });
  return {
    dirty_paths: dirtyPaths,
    generated_output_scope_roots: generatedScope.filter((scope) => {
      const root = path.join(worktree, ...scope.split("/"));
      if (!fs.existsSync(root)) return false;
      const stat = fs.lstatSync(root);
      if (stat.isSymbolicLink()) fail(`Generated output scope root must not be a symlink: ${scope}`);
      if (!stat.isFile() && !stat.isDirectory()) fail(`Generated output scope root must be a regular file or directory: ${scope}`);
      if (!within(fs.realpathSync(root), worktree)) fail(`Generated output scope root escapes assigned worktree: ${scope}`);
      return true;
    }),
    worktree_state_digest: digest({ tracked_diff_sha256: trackedDiff, untracked })
  };
}

function writeReceipt(value, prefix = "worktree") {
  const receiptSha256 = digest(value);
  const receipt = { ...value, receipt_sha256: receiptSha256 };
  const receiptPath = path.join(os.tmpdir(), `acg-subagent-${prefix}-${receiptSha256.slice(7, 23)}.json`);
  const temporary = `${receiptPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, receiptPath);
  return { receipt, receiptPath };
}

function readReceipt(receiptPath) {
  const absoluteReceipt = existingAbsolute(receiptPath, "Receipt");
  const receipt = JSON.parse(fs.readFileSync(absoluteReceipt, "utf8"));
  const claimed = receipt.receipt_sha256;
  const unsigned = { ...receipt };
  delete unsigned.receipt_sha256;
  if (receipt.schema_version !== 1 || receipt.receipt_type !== "subagent_worktree_assignment") fail("Receipt type or version is invalid");
  if (digest(unsigned) !== claimed) fail("Receipt digest is invalid");
  return { absoluteReceipt, receipt, claimed };
}

function verifyIdentity(receipt) {
  workerSeat(receipt.seat, "Receipt seat");
  const repository = existingAbsolute(receipt.repository, "Receipt repository");
  const worktree = existingAbsolute(receipt.worktree, "Receipt worktree");
  if (commonGitDirectory(repository) !== commonGitDirectory(worktree)) fail("Assigned worktree belongs to a different repository");
  if (fs.realpathSync(git(worktree, ["rev-parse", "--show-toplevel"])) !== worktree) fail("Assigned path is not the worktree root");
  if (git(worktree, ["branch", "--show-current"]) !== receipt.branch) fail("Assigned worktree is on the wrong branch");
  const head = git(worktree, ["rev-parse", "HEAD"]).toLowerCase();
  if (head !== receipt.base_commit) fail("Assigned worktree moved from the verified base; prepare a new isolated seat");
  return { repository, worktree, head };
}

function verifyContinuationState(receipt, worktree) {
  const allowedScopes = Array.isArray(receipt.write_scope) ? receipt.write_scope.map(normalizeScope) : [];
  const generatedScope = Array.isArray(receipt.generated_output_scope) ? receipt.generated_output_scope.map(normalizeScope) : [];
  if (receipt.receipt_purpose !== "continuation" || (allowedScopes.length === 0 && generatedScope.length === 0)) fail("Continuation receipt is missing declared owned or generated scope");
  const state = dirtyState(worktree, generatedScope);
  if (state.dirty_paths.length === 0 && state.generated_output_scope_roots.length === 0) fail("Continuation requires expected owned dirty state or declared generated output");
  for (const dirtyPath of state.dirty_paths) {
    if (!allowedScopes.some((scope) => dirtyPath === scope || dirtyPath.startsWith(scope + "/"))) fail(`Dirty path is outside declared write scope: ${dirtyPath}`);
  }
  if (JSON.stringify(state.dirty_paths) !== JSON.stringify(receipt.dirty_paths) || JSON.stringify(state.generated_output_scope_roots) !== JSON.stringify(receipt.generated_output_scope_roots ?? []) || state.worktree_state_digest !== receipt.worktree_state_digest) {
    fail("Continuation dirty state changed after receipt creation");
  }
  return state;
}

function verifyReceipt(receiptPath) {
  const { absoluteReceipt, receipt, claimed } = readReceipt(receiptPath);
  const identity = verifyIdentity(receipt);
  let continuation = false;
  let state = { dirty_paths: [] };
  if (receipt.receipt_purpose === "continuation") {
    continuation = true;
    state = verifyContinuationState(receipt, identity.worktree);
  } else if (git(identity.worktree, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    fail("Assigned worktree is not clean before mutation; use continue for expected same-seat dirty state");
  }
  return {
    schema_version: 1,
    command: "subagent-git verify",
    verified: true,
    continuation,
    mutation_allowed_in_assigned_worktree: true,
    repository: identity.repository,
    worktree: identity.worktree,
    branch: receipt.branch,
    base_commit: receipt.base_commit,
    work_id: receipt.work_id,
    seat: receipt.seat,
    dirty_paths: state.dirty_paths,
    receipt_path: absoluteReceipt,
    receipt_sha256: claimed,
    route_request_field: { subagent_worktree_receipt: absoluteReceipt },
    completion_sentinel: `ACG_SUBAGENT_${continuation ? "CONTINUATION" : "WORKTREE"}_VERIFIED:${claimed.slice(7, 23)}`
  };
}

function prepare(values) {
  const repositoryInput = existingAbsolute(required(values, "repository"), "Repository");
  const repository = fs.realpathSync(git(repositoryInput, ["rev-parse", "--show-toplevel"]));
  const baseInput = required(values, "base").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(baseInput)) fail("--base must be an exact 40-character commit SHA");
  const baseCommit = git(repository, ["rev-parse", "--verify", `${baseInput}^{commit}`]).toLowerCase();
  if (baseCommit !== baseInput) fail("--base did not resolve to the exact requested commit");

  const workId = required(values, "work-id");
  const projectSlug = project(values.project);
  const seat = workerSeat(required(values, "seat"), "Seat");
  const writeScope = scopes(values);
  const generatedOutputScope = generatedScopes(values);
  assertDistinctScopes(writeScope, generatedOutputScope);
  for (const generated of generatedOutputScope) {
    if (splitNul(git(repository, ["ls-tree", "-r", "-z", "--name-only", baseCommit, "--", literalPathspec(generated)])).length > 0) {
      fail(`Generated output scope contains tracked files and cannot be declared: ${generated}`);
    }
  }
  const branch = `codex/${slug(workId, "Work ID")}/${seat}`;
  const worktree = newAbsolute(required(values, "worktree"), "Worktree");
  if (within(worktree, repository)) fail("Worktree must be outside the repository of record");

  const branchCheck = spawnSync("git", ["-C", repository, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (branchCheck.status === 0) fail(`Assigned branch already exists: ${branch}`);
  if (![0, 1].includes(branchCheck.status)) fail(`Unable to inspect assigned branch: ${branch}`);

  execFileSync("git", ["-C", repository, "worktree", "add", "-b", branch, worktree, baseCommit], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const assignment = {
    schema_version: 1,
    receipt_type: "subagent_worktree_assignment",
    created_at: new Date().toISOString(),
    project: projectSlug,
    repository,
    worktree,
    branch,
    base_commit: baseCommit,
    work_id: workId,
    seat,
    write_scope: writeScope,
    generated_output_scope: generatedOutputScope,
    fork_context_provides_git_isolation: false
  };
  const { receipt, receiptPath } = writeReceipt(assignment, "worktree");
  const verified = verifyReceipt(receiptPath);
  return {
    schema_version: 1,
    command: "subagent-git prepare",
    prepared: true,
    repository,
    worktree,
    branch,
    base_commit: baseCommit,
    work_id: workId,
    seat,
    write_scope: assignment.write_scope,
    receipt_path: receiptPath,
    receipt_sha256: receipt.receipt_sha256,
    route_request_field: { subagent_worktree_receipt: receiptPath },
    fork_context_provides_git_isolation: false,
    agent_preflight: `node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs verify --receipt ${JSON.stringify(receiptPath)}`,
    required_workdir: worktree,
    completion_sentinel: verified.completion_sentinel.replace("VERIFIED", "PREPARED")
  };
}

function continueSeat(values) {
  const { receipt: parent, claimed } = readReceipt(required(values, "receipt"));
  if (parent.receipt_purpose === "continuation") fail("Use the original assignment receipt to create a continuation");
  const identity = verifyIdentity(parent);
  if (parent.project !== undefined) project(parent.project);
  const expectedHead = required(values, "expected-head").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedHead) || expectedHead !== identity.head) fail("--expected-head must equal the unchanged prepared 40-character HEAD");
  const writeScope = Array.isArray(parent.write_scope) ? [...new Set(parent.write_scope.map(normalizeScope))].sort() : [];
  const generatedOutputScope = Array.isArray(parent.generated_output_scope) ? [...new Set(parent.generated_output_scope.map(normalizeScope))].sort() : [];
  if (writeScope.length === 0 && generatedOutputScope.length === 0) fail("Original assignment has no write scope or generated output scope; prepare a new seat with declared scope");
  assertDistinctScopes(writeScope, generatedOutputScope);
  const state = dirtyState(identity.worktree, generatedOutputScope);
  if (state.dirty_paths.length === 0 && state.generated_output_scope_roots.length === 0) fail("Continuation requires expected owned dirty state or declared generated output");
  for (const dirtyPath of state.dirty_paths) {
    if (!writeScope.some((scope) => dirtyPath === scope || dirtyPath.startsWith(scope + "/"))) fail(`Dirty path is outside declared write scope: ${dirtyPath}`);
  }
  const unsigned = { ...parent };
  delete unsigned.receipt_sha256;
  const continuation = {
    ...unsigned,
    receipt_purpose: "continuation",
    continued_at: new Date().toISOString(),
    current_head: identity.head,
    write_scope: writeScope,
    generated_output_scope: generatedOutputScope,
    dirty_paths: state.dirty_paths,
    generated_output_scope_roots: state.generated_output_scope_roots,
    worktree_state_digest: state.worktree_state_digest,
    parent_receipt_sha256: claimed
  };
  const { receipt, receiptPath } = writeReceipt(continuation, "continuation");
  const verified = verifyReceipt(receiptPath);
  return {
    ...verified,
    command: "subagent-git continue",
    continuation: true,
    receipt_path: receiptPath,
    receipt_sha256: receipt.receipt_sha256,
    route_request_field: { subagent_worktree_receipt: receiptPath }
  };
}

function help() {
  return {
    commands: {
      prepare: "prepare --project <stable-slug> --repository <absolute> --base <40-char-sha> --work-id <id> --seat <seat> --worktree <absolute-new-path> [--write-scope <repository-relative-path>]... [--generated-scope <repository-relative-path>]...",
      verify: "verify --receipt <absolute-receipt>",
      continue: "continue --receipt <original-assignment-receipt> --expected-head <40-char-sha>"
    },
    rule: "Prepare before spawn_agent; verify once before first mutation; use continue for expected same-seat dirty state; fork_context is not Git isolation."
  };
}

try {
  const { command, values } = parse(process.argv);
  const output = command === "prepare"
    ? prepare(values)
    : command === "verify"
      ? verifyReceipt(required(values, "receipt"))
      : command === "continue"
        ? continueSeat(values)
        : command === "--help" || command === "help" || command === undefined
          ? help()
          : fail(`Unknown command: ${command}`);
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
} catch (error) {
  process.stderr.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    failed_closed: true
  }, null, 2) + "\n");
  process.exitCode = 1;
}
