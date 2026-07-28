import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  acknowledgeDelivery,
  bindContinuationProject,
  codeRoot,
  deliverResolvedPolicy,
  resolveRoute,
  runAuditWorkflow
} from "./core.mjs";
import { recordEngineeringEventBestEffort } from "./engineering-metrics.mjs";
import { buildNativeQuarantineLaunch } from "./native-model-attestation.mjs";

const GIT_TEXT_MAX_BUFFER = 16 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim()) fail(`${name} is required`);
  return value;
}

function slug(value, label) {
  const normalized = required(value, label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || normalized.length > 64) fail(`${label} cannot form a safe identifier`);
  return normalized;
}

function workerSeat(value, label = "seat") {
  const seat = slug(value, label);
  if (seat === "0") fail("Seat 0 is reserved for the coordinator and cannot receive a worker assignment");
  return seat;
}

const CONTINUATION_INTENTS = Object.freeze({
  implementation: {
    phase: "implementation",
    operations: ["implementation"],
    tools: ["filesystem_write", "shell"],
    authorities: ["filesystem_mutation"],
    runtime_capabilities: { filesystem_read: true, filesystem_write: true, local_runtime: true },
    contract: "integrity-verifies the dirty continuation and owns implementation routing, delivery, and acknowledgment"
  },
  validate: {
    phase: "validation",
    operations: ["validate"],
    tools: ["shell"],
    authorities: [],
    runtime_capabilities: { filesystem_read: true, local_runtime: true },
    contract: "integrity-verifies the dirty continuation and owns validation routing, delivery, and acknowledgment"
  },
  deploy: {
    phase: "deployment",
    operations: ["deploy"],
    tools: ["deployment"],
    authorities: ["deployment"],
    runtime_capabilities: { filesystem_read: true, local_runtime: true, deployment: true },
    contract: "integrity-verifies the dirty continuation and owns deployment routing, delivery, and acknowledgment without authorizing source edits, Git mutation, database mutation, or a release claim"
  }
});

function continuationIntent(value, { defaultImplementation = false } = {}) {
  const intent = value === undefined && defaultImplementation ? "implementation" : value;
  if (typeof intent !== "string" || !Object.hasOwn(CONTINUATION_INTENTS, intent)) {
    fail(`--intent must be one of: ${Object.keys(CONTINUATION_INTENTS).join(", ")}`);
  }
  return intent;
}

function scopesOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function assertGeneratedScopes(writeScope, generatedOutputScope) {
  for (const generated of generatedOutputScope) {
    if (writeScope.some((written) => scopesOverlap(written, generated))) fail(`Generated output scope overlaps write scope: ${generated}`);
  }
}

function literalPathspec(scope) {
  return `:(top,literal)${scope}`;
}

function existingRoot(value, label) {
  const absolute = path.resolve(required(value, label));
  if (!path.isAbsolute(value) || !fs.existsSync(absolute)) fail(`${label} must be an existing absolute path`);
  return fs.realpathSync(absolute);
}

function normalizeRelative(value, label = "Path") {
  const normalized = required(value, label).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".git" ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith(".git/")
  ) {
    fail(`${label} must be a safe repository-relative path below the root: ${value}`);
  }
  return normalized;
}

function normalizeList(values, label) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(list.map((value) => normalizeRelative(value, label)))].sort();
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    // Worktree paths and status entries are metadata, but can exceed Node's
    // default 1 MiB buffer on a preserved candidate.
    maxBuffer: GIT_TEXT_MAX_BUFFER
  }).trim();
}

function commonGitDirectory(cwd) {
  const value = git(cwd, ["rev-parse", "--git-common-dir"]);
  return fs.realpathSync(path.isAbsolute(value) ? value : path.resolve(cwd, value));
}

function sha256File(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function digest(value) {
  const copy = structuredClone(value);
  delete copy.provenance_sha256;
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex")}`;
}

function jsonDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function assignmentBindingDigest(assignment) {
  const binding = structuredClone(assignment);
  for (const key of ["active_worktree_receipt", "continuation_parent_receipt", "provenance_path"]) {
    if (typeof binding[key] === "string" && path.isAbsolute(binding[key]) && fs.existsSync(binding[key])) {
      binding[key] = fs.realpathSync(binding[key]);
    }
  }
  return jsonDigest(binding);
}

function writePrivateJson(root, prefix, value) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const identity = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
  const file = path.join(root, `${prefix}-${identity}.json`);
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
  return file;
}

function readOnlyAssignmentCore(assignment) {
  const core = structuredClone(assignment);
  delete core.admitted_assignment;
  return core;
}

function readOnlyAssignmentIdentity(assignment) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(readOnlyAssignmentCore(assignment)))
    .digest("hex")
    .slice(0, 16);
}

function writeReadOnlyAssignment(root, assignment) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const identity = readOnlyAssignmentIdentity(assignment);
  const file = path.join(fs.realpathSync(root), `read-only-assignment-${identity}.json`);
  const persisted = {
    ...assignment,
    admitted_assignment: readOnlyAdmittedAssignment(assignment, file)
  };
  writePrivateJsonAt(file, persisted);
  return file;
}

function privateJsonPath(root, prefix) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return path.join(fs.realpathSync(root), `${prefix}-${crypto.randomUUID()}.json`);
}

function writePrivateJsonAt(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
  return file;
}

function readWorktreeReceipt(receiptPath, label) {
  const receiptFile = existingRoot(receiptPath, label);
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
  const claimed = receipt.receipt_sha256;
  const unsigned = { ...receipt };
  delete unsigned.receipt_sha256;
  if (
    receipt.schema_version !== 1 ||
    receipt.receipt_type !== "subagent_worktree_assignment" ||
    claimed !== jsonDigest(unsigned)
  ) {
    fail(`${label} integrity is invalid`);
  }
  return { path: receiptFile, receipt, receipt_sha256: claimed };
}

function splitNul(value) {
  return value.split("\0").filter(Boolean).sort();
}

function isWithinScope(relative, scopes) {
  return scopes.some((scope) => relative === scope || relative.startsWith(`${scope}/`));
}

function assertCurrentRegularFile(root, relative, label) {
  const file = path.join(root, ...relative.split("/"));
  if (!fs.existsSync(file)) fail(`${label} is deleted or missing: ${relative}`);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label} must be a current regular file: ${relative}`);
  const resolved = fs.realpathSync(file);
  const escaped = path.relative(root, resolved);
  if (escaped === ".." || escaped.startsWith(`..${path.sep}`) || path.isAbsolute(escaped)) {
    fail(`${label} escapes the source worktree: ${relative}`);
  }
  return file;
}

function readMutatingAssignmentPackage(packageInput, label = "assignment package") {
  const packagePath = existingRoot(packageInput, label);
  if (!fs.statSync(packagePath).isFile()) fail(`${label} must be a regular file`);
  let assignment;
  try {
    assignment = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (assignment.package_type !== "governed_seat_assignment") fail(`${label} is not a governed mutating seat assignment`);
  const identity = path.basename(packagePath).match(/^assignment-([a-f0-9]{16})\.json$/)?.[1];
  const expected = crypto.createHash("sha256").update(JSON.stringify(assignment)).digest("hex").slice(0, 16);
  if (!identity || identity !== expected) fail(`${label} content identity does not match its filename`);
  return { packagePath, assignment, identity };
}

function assignmentRecoverySource(options) {
  const parent = readMutatingAssignmentPackage(options.assignment, "recovery assignment package");
  const assignment = parent.assignment;
  const original = readWorktreeReceipt(
    required(assignment.active_worktree_receipt, "recovery assignment receipt"),
    "recovery original receipt"
  );
  const receipt = original.receipt;
  const repository = existingRoot(receipt.repository, "recovery repository");
  const source = existingRoot(receipt.worktree, "recovery source worktree");
  const writeScope = normalizeList(receipt.write_scope, "recovery write scope");
  const generatedOutputScope = normalizeList(receipt.generated_output_scope, "recovery generated output scope");
  assertGeneratedScopes(writeScope, generatedOutputScope);
  const bindings = {
    project: receipt.project,
    repository,
    worktree: source,
    base_commit: receipt.base_commit,
    seat: receipt.seat,
    work_id: receipt.work_id,
    write_scope: writeScope,
    generated_output_scope: generatedOutputScope
  };
  for (const [key, value] of Object.entries(bindings)) {
    const assignmentValue = key === "worktree" || key === "repository"
      ? existingRoot(assignment[key], `recovery assignment ${key}`)
      : assignment[key];
    if (JSON.stringify(assignmentValue) !== JSON.stringify(value)) {
      fail(`Recovery assignment does not bind original receipt ${key}`);
    }
  }
  if (commonGitDirectory(source) !== commonGitDirectory(repository)) fail("Recovery source belongs to another repository");
  if (fs.realpathSync(git(source, ["rev-parse", "--show-toplevel"])) !== source) fail("Recovery source must be a Git worktree root");
  if (git(source, ["rev-parse", "HEAD"]).toLowerCase() !== receipt.base_commit) {
    fail("Recovery source HEAD moved from the original receipt base");
  }
  if (git(source, ["branch", "--show-current"]) !== receipt.branch) {
    fail("Recovery source branch does not match the original receipt");
  }
  const model = required(assignment.requested_model, "recovery requested model");
  const reasoning = required(assignment.requested_reasoning_raw, "recovery requested reasoning");
  if (model === "Unverified" || reasoning === "Unverified") {
    fail("Recovery requires an assignment carrying exact requested model and reasoning");
  }
  return {
    ...parent,
    original,
    receipt,
    repository,
    source,
    writeScope,
    generatedOutputScope,
    model,
    reasoning
  };
}

function recoverySourceState(source, writeScope, generatedOutputScope) {
  const trackedPaths = splitNul(git(source, ["diff", "--name-only", "-z", "HEAD", "--"]));
  const untrackedPaths = splitNul(git(source, ["ls-files", "--others", "--exclude-standard", "-z", "--"]));
  const copiedPaths = [];
  const excludedPaths = [];
  for (const relative of trackedPaths) {
    if (!isWithinScope(relative, writeScope)) {
      fail(`Recovery cannot exclude a tracked dirty path outside original write scope: ${relative}`);
    }
    assertCurrentRegularFile(source, relative, "Recovery tracked path");
    copiedPaths.push(relative);
  }
  for (const relative of untrackedPaths) {
    assertCurrentRegularFile(source, relative, "Recovery untracked path");
    if (isWithinScope(relative, writeScope)) {
      copiedPaths.push(relative);
    } else {
      excludedPaths.push({
        path: relative,
        reason: isWithinScope(relative, generatedOutputScope)
          ? "runtime_output_in_original_generated_scope"
          : "untracked_outside_original_scopes_not_recovered"
      });
    }
  }
  const copies = [...new Set(copiedPaths)].sort();
  if (!copies.length) fail("Recovery found no current regular files within the original write scope");
  return {
    copies,
    excludedPaths: excludedPaths.sort((left, right) => left.path.localeCompare(right.path))
  };
}

function copyRecoveryFiles(source, prepared, copies) {
  const copiedFiles = [];
  for (const relative of copies) {
    if (!isWithinScope(relative, prepared.writeScope)) {
      fail(`Copy path is outside declared write scope: ${relative}`);
    }
    const sourceFile = assertCurrentRegularFile(source, relative, "Recovery copy");
    const targetFile = path.join(prepared.worktree, ...relative.split("/"));
    const baseDigest = fs.existsSync(targetFile) && fs.lstatSync(targetFile).isFile() ? sha256File(targetFile) : null;
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
    fs.chmodSync(targetFile, fs.statSync(sourceFile).mode & 0o777);
    const sourceDigest = sha256File(sourceFile);
    const destinationDigest = sha256File(targetFile);
    if (sourceDigest !== destinationDigest) fail(`Copied file digest mismatch: ${relative}`);
    copiedFiles.push({
      path: relative,
      base_digest: baseDigest,
      source_digest: sourceDigest,
      destination_initial_digest: destinationDigest
    });
  }
  return copiedFiles;
}

function continuationProvenance(assignment, packagePath) {
  const provenancePath = existingRoot(assignment.provenance_path, "continuation provenance");
  let provenance;
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  } catch {
    fail("Continuation provenance is not valid JSON");
  }
  if (provenance.receipt_type !== "seat_continuation_provenance" || provenance.provenance_sha256 !== digest(provenance)) {
    fail("Continuation provenance integrity is invalid");
  }
  const original = readWorktreeReceipt(assignment.continuation_parent_receipt, "original assignment receipt");
  const active = readWorktreeReceipt(assignment.active_worktree_receipt, "continuation receipt");
  const expected = {
    project: assignment.project,
    project_provenance: assignment.project_provenance,
    seat: assignment.seat,
    work_id: assignment.work_id,
    repository: existingRoot(assignment.repository, "assignment repository"),
    worktree: existingRoot(assignment.worktree, "assignment worktree"),
    base_commit: assignment.base_commit,
    immediate_intent: assignment.immediate_intent,
    original_assignment_receipt: original.path,
    original_assignment_receipt_sha256: original.receipt_sha256,
    continuation_receipt: active.path,
    continuation_receipt_sha256: active.receipt_sha256,
    assignment_package_sha256: assignmentBindingDigest(assignment)
  };
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(provenance[key]) !== JSON.stringify(value)) {
      fail(`Continuation provenance does not bind ${key}`);
    }
  }
  if (active.receipt.parent_receipt_sha256 !== original.receipt_sha256) {
    fail("Continuation provenance receipt chain is invalid");
  }
  return { provenancePath, provenance };
}

function recoveryProvenance(assignment, packagePath) {
  const provenancePath = existingRoot(assignment.provenance_path, "recovery provenance");
  let provenance;
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  } catch {
    fail("Recovery provenance is not valid JSON");
  }
  if (
    provenance.receipt_type !== "seat_assignment_recovery_provenance" ||
    provenance.provenance_sha256 !== digest(provenance)
  ) {
    fail("Recovery provenance integrity is invalid");
  }
  const parent = readMutatingAssignmentPackage(
    assignment.recovery_parent_assignment,
    "recovery parent assignment"
  );
  const original = readWorktreeReceipt(
    assignment.recovery_original_receipt,
    "recovery original assignment receipt"
  );
  const persistedChildPreflight = provenance.child_preflight;
  const args = persistedChildPreflight?.args;
  if (
    typeof persistedChildPreflight?.executable !== "string" ||
    !path.isAbsolute(persistedChildPreflight.executable) ||
    !Array.isArray(args) ||
    args.length !== 5 ||
    existingRoot(args[0], "recovery child CLI") !== existingRoot(childCliPath(), "current child CLI") ||
    JSON.stringify(args.slice(1, 4)) !== JSON.stringify(["seat", "preflight", "--assignment"]) ||
    existingRoot(args[4], "recovery child assignment") !== packagePath ||
    persistedChildPreflight.shell !== false ||
    persistedChildPreflight.success_field !== "seat_preflight_ready" ||
    persistedChildPreflight.completion_sentinel_prefix !== "ACG_MUTATING_SEAT_PREFLIGHT:"
  ) {
    fail("Recovery provenance child preflight is invalid");
  }
  const expected = {
    recovery_parent_assignment: parent.packagePath,
    recovery_parent_assignment_sha256: jsonDigest(parent.assignment),
    original_assignment_receipt: original.path,
    original_assignment_receipt_sha256: original.receipt_sha256,
    assignment_package: packagePath,
    assignment_package_sha256: jsonDigest(assignment),
    child_preflight: persistedChildPreflight,
    excluded_paths: assignment.recovery_excluded_paths
  };
  for (const [key, value] of Object.entries(expected)) {
    const pathBinding = [
      "recovery_parent_assignment",
      "original_assignment_receipt",
      "assignment_package"
    ].includes(key);
    const matches = pathBinding
      ? existingRoot(provenance[key], `recovery provenance ${key}`) === value
      : JSON.stringify(provenance[key]) === JSON.stringify(value);
    if (!matches) {
      fail(`Recovery provenance does not bind ${key}`);
    }
  }
  if (
    assignment.recovery_parent_assignment_sha256 !== expected.recovery_parent_assignment_sha256 ||
    assignment.recovery_original_receipt_sha256 !== original.receipt_sha256 ||
    existingRoot(parent.assignment.active_worktree_receipt, "recovery parent receipt") !== original.path
  ) {
    fail("Recovery assignment does not bind its original receipt");
  }
  return { provenancePath, provenance, childPreflight: persistedChildPreflight };
}

function helperPath(policyRoot) {
  const source = path.join(codeRoot, "skills", "govern-codex-policy", "scripts", "subagent-git.mjs");
  if (fs.existsSync(source)) return source;
  const runtime = path.join(path.dirname(policyRoot), "skills", "govern-codex-policy", "scripts", "subagent-git.mjs");
  if (fs.existsSync(runtime)) return runtime;
  fail("The active release does not contain the subagent Git helper");
}

function runHelper(policyRoot, args) {
  const result = spawnSync(process.execPath, [helperPath(policyRoot), ...args], {
    encoding: "utf8",
    env: process.env,
    // Continuation metadata may legitimately contain many scoped paths. Keep
    // the high-level helper boundary bounded instead of inheriting Node's 1 MiB
    // default, while binary diff evidence remains file-hashed by the helper.
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) fail(result.stderr?.trim() || result.stdout?.trim() || "Subagent Git helper failed");
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("Subagent Git helper returned invalid JSON");
  }
}

function lifecycle(options, repository, worktree, policyRoot) {
  const prior = options.priorReceipt?.context_acknowledgment ?? options.priorReceipt ?? null;
  const route = resolveRoute({
    mode: "mutation",
    phase: "delegation",
    project: required(options.project, "project"),
    operations: ["launch_mutating_subagent"],
    tools: ["subagent"],
    paths: [repository, worktree],
    risk_tags: Array.isArray(options.riskTags) ? [...new Set(options.riskTags)] : [],
    mutation_authority: true,
    authorities: ["delegation_mutation"],
    prior_receipt: prior
  }, policyRoot);
  const delivery = deliverResolvedPolicy(route, policyRoot);
  const acknowledgment = acknowledgeDelivery(delivery, policyRoot);
  return { route, delivery, acknowledgment };
}

function readOnlyLifecycle(options, target, policyRoot) {
  const prior = options.priorReceipt?.context_acknowledgment ?? options.priorReceipt ?? null;
  const route = resolveRoute({
    mode: "delegation",
    phase: "delegation",
    project: required(options.project, "project"),
    operations: ["launch_subagent"],
    tools: ["subagent"],
    paths: [target],
    risk_tags: [],
    mutation_authority: false,
    authorities: ["delegation"],
    runtime_capabilities: {
      filesystem_read: true,
      local_runtime: true,
      thread_coordination: true
    },
    prior_receipt: prior
  }, policyRoot);
  const delivery = deliverResolvedPolicy(route, policyRoot);
  const acknowledgment = acknowledgeDelivery(delivery, policyRoot);
  return { route, delivery, acknowledgment };
}

function resolveWorktree(options, repository, workId, seat) {
  if (options.worktree) return path.resolve(options.worktree);
  const root = options.worktreeRoot || process.env.ACG_WORKTREE_ROOT;
  if (!root) fail("Provide --worktree-root or configure ACG_WORKTREE_ROOT");
  const absoluteRoot = existingRoot(root, "worktree root");
  const repositoryName = slug(path.basename(repository), "repository");
  return path.join(absoluteRoot, `${repositoryName}-${workId}-${seat}`);
}

function privateRoot(options) {
  return path.resolve(
    options.provenanceRoot ||
    process.env.ACG_PROVENANCE_ROOT ||
    path.join(os.homedir(), ".codex", "governance", "seat-assignments")
  );
}

function childCliPath() {
  const invoked = process.argv[1] && path.isAbsolute(process.argv[1])
    ? path.resolve(process.argv[1])
    : null;
  if (invoked && path.basename(invoked) === "acg.mjs" && fs.existsSync(invoked)) {
    return fs.realpathSync(invoked);
  }
  const bundled = path.join(codeRoot, "bin", "acg.mjs");
  if (fs.existsSync(bundled)) return fs.realpathSync(bundled);
  fail("Unable to resolve the current high-level governance CLI");
}

function activeManifestSha256(policyRoot) {
  const lock = JSON.parse(fs.readFileSync(path.join(policyRoot, "policy.lock.json"), "utf8"));
  const value = lock?.manifest?.sha256;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    fail("Active policy lock manifest digest is invalid");
  }
  return value;
}

function readOnlyAssignment(options) {
  const packagePath = existingRoot(options.assignment, "assignment package");
  if (!fs.statSync(packagePath).isFile()) fail("Assignment package must be a regular file");
  let assignment;
  try {
    assignment = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    fail("Assignment package is not valid JSON");
  }
  if (assignment.package_type !== "governed_read_only_seat_assignment" || assignment.read_only !== true) {
    fail("Assignment package is not a governed read-only seat assignment");
  }
  const identity = path.basename(packagePath).match(/^read-only-assignment-([a-f0-9]{16})\.json$/)?.[1];
  if (!identity) fail("Read-only assignment package filename is invalid");
  // New packages persist an admitted assignment whose exact message includes
  // this package path. That derived field is intentionally excluded from the
  // filename identity and recomputed below; legacy packages signed their full
  // payload and remain readable when their original identity still matches.
  const expectedIdentity = assignment.admitted_assignment === undefined
    ? crypto.createHash("sha256").update(JSON.stringify(assignment)).digest("hex").slice(0, 16)
    : readOnlyAssignmentIdentity(assignment);
  if (identity !== expectedIdentity) fail("Read-only assignment package content identity does not match its filename");

  const project = required(assignment.project, "assignment project").trim();
  const seat = workerSeat(assignment.seat, "assignment seat");
  const target = existingRoot(assignment.target, "assignment target");
  if (target !== assignment.target) fail("Assignment target is not canonical");
  const expectedPreflight = {
    executable: assignment.child_preflight?.executable,
    args: [
      childCliPath(),
      "audit",
      "--project", project,
      "--path", target
    ],
    shell: false,
    success_field: "audit_ready",
    completion_sentinel_prefix: "ACG_AUDIT_READY:"
  };
  const expectedNativeQuarantine = buildNativeQuarantineLaunch({
    seatId: seat,
    model: required(assignment.requested_model, "assignment model"),
    reasoning: required(assignment.requested_reasoning_raw, "assignment reasoning"),
    attempt: assignment.native_quarantine?.attempt
  });
  if (
    typeof assignment.child_preflight?.executable !== "string" ||
    !path.isAbsolute(assignment.child_preflight.executable) ||
    JSON.stringify(assignment.child_preflight) !== JSON.stringify(expectedPreflight)
  ) {
    fail("Read-only assignment child preflight contract is invalid");
  }
  if (JSON.stringify(assignment.native_quarantine) !== JSON.stringify(expectedNativeQuarantine)) {
    fail("Read-only assignment native quarantine contract is invalid; run a fresh seat inspect");
  }
  if (
    typeof assignment.result_sentinel !== "string" ||
    !/^ACG_READ_ONLY_SEAT_RESULT:[a-f0-9]{16}$/u.test(assignment.result_sentinel)
  ) {
    fail("Read-only assignment result sentinel is invalid; run a fresh seat inspect");
  }
  const admittedAssignment = readOnlyAdmittedAssignment(assignment, packagePath);
  if (
    assignment.admitted_assignment !== undefined &&
    JSON.stringify(assignment.admitted_assignment) !== JSON.stringify(admittedAssignment)
  ) {
    fail("Read-only assignment admitted payload is invalid");
  }
  return { packagePath, assignment, identity, project, seat, target, admittedAssignment };
}

function shellToken(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function childAssignmentMessage({ childPreflight, objective, resultSentinel }) {
  const command = [childPreflight.executable, ...childPreflight.args].map(shellToken).join(" ");
  return [
    "Run this exact child preflight command once before doing anything else:",
    command,
    "",
    `Continue only if it returns ${childPreflight.success_field}:true and the expected ${childPreflight.completion_sentinel_prefix} sentinel. Run no other governance command.`,
    "",
    `Objective: ${objective}`,
    "",
    `Append this exact sentinel on its own final line: ${resultSentinel}`
  ].join("\n");
}

function readOnlyAdmittedAssignment(assignment, packagePath) {
  const childPreflight = {
    executable: process.execPath,
    args: [
      childCliPath(),
      "seat",
      "preflight",
      "--assignment", packagePath
    ],
    shell: false,
    success_field: "seat_preflight_ready",
    completion_sentinel_prefix: "ACG_READ_ONLY_SEAT_PREFLIGHT:"
  };
  return {
    starts_new_turn: true,
    message: childAssignmentMessage({
      childPreflight,
      objective: assignment.objective || "Perform the bounded read-only inspection in the assignment package.",
      resultSentinel: assignment.result_sentinel
    }),
    pass_message_verbatim: true,
    required_final_sentinel: assignment.result_sentinel,
    stale_notification_rule: "Any completion without the required final sentinel is pre-admission, stale, or inadmissible.",
    close_rule: "Close only after the post-admission result carrying the required final sentinel is received."
  };
}

function prepare(options, policyRoot) {
  const repositoryInput = existingRoot(options.repository, "repository");
  const repository = fs.realpathSync(git(repositoryInput, ["rev-parse", "--show-toplevel"]));
  const base = required(options.base, "base").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(base)) fail("base must be an exact 40-character commit");
  if (git(repository, ["rev-parse", "--verify", `${base}^{commit}`]).toLowerCase() !== base) fail("base did not resolve exactly");
  const seat = workerSeat(options.seat, "seat");
  const workId = slug(options.workId || seat, "work ID");
  const writeScope = normalizeList(options.writeScopes, "write scope");
  const generatedOutputScope = normalizeList(options.generatedScopes, "generated output scope");
  if (writeScope.length === 0 && generatedOutputScope.length === 0) fail("At least one --write-scope or --generated-scope is required");
  assertGeneratedScopes(writeScope, generatedOutputScope);
  for (const generated of generatedOutputScope) {
    if (git(repository, ["ls-tree", "-r", "--name-only", base, "--", literalPathspec(generated)])) fail(`Generated output scope contains tracked files at the prepared base and cannot be declared: ${generated}`);
  }
  const worktree = resolveWorktree(options, repository, workId, seat);
  const policy = lifecycle(options, repository, worktree, policyRoot);
  const project = slug(options.project, "project");
  if (required(options.project, "project").trim() !== project) fail(`project must be the stable slug: ${project}`);
  const helperArgs = [
    "prepare",
    "--project", project,
    "--repository", repository,
    "--base", base,
    "--work-id", workId,
    "--seat", seat,
    "--worktree", worktree
  ];
  for (const scope of writeScope) helperArgs.push("--write-scope", scope);
  for (const scope of generatedOutputScope) helperArgs.push("--generated-scope", scope);
  const gitAssignment = runHelper(policyRoot, helperArgs);
  return {
    repository,
    base,
    seat,
    workId,
    worktree,
    writeScope,
    generatedOutputScope,
    policy,
    gitAssignment
  };
}

function assignmentPackage(options, prepared, activeReceipt, provenancePath, recovered) {
  const model = required(options.model, "model");
  const reasoning = required(options.reasoning, "reasoning");
  return {
    schema_version: 1,
    package_type: "governed_seat_assignment",
    created_at: new Date().toISOString(),
    project: slug(options.project, "project"),
    project_provenance: { project: slug(options.project, "project"), provenance_class: "receipt_project_bound" },
    objective: options.objective || null,
    thread_id: options.thread || null,
    seat: prepared.seat,
    work_id: prepared.workId,
    repository: prepared.repository,
    worktree: prepared.worktree,
    base_commit: prepared.base,
    write_scope: prepared.writeScope,
    generated_output_scope: prepared.generatedOutputScope,
    source_recovery: recovered,
    requested_model: model,
    requested_reasoning_raw: reasoning,
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified",
    active_worktree_receipt: activeReceipt,
    child_preflight_contract: "seat preflight --assignment <assignment-package>; it verifies worktree integrity and owns implementation route, delivery, and acknowledgment",
    child_ledger: "fresh_no_parent_receipt",
    provenance_path: provenancePath,
    policy_lifecycle: {
      resolution_receipt: prepared.policy.route,
      delivery_receipt: prepared.policy.delivery,
      context_acknowledgment: prepared.policy.acknowledgment.context_acknowledgment
    },
    operator_reporting: "Report routine governance as one concise status. Surface receipts or routing detail only for a blocker, decision, safety issue, or explicit operator request."
  };
}

function compactResult(command, prepared, packagePath, activeReceipt, recovered) {
  return {
    schema_version: 1,
    command,
    visibility: "normal",
    status: "ready",
    seat_ready: true,
    task: prepared.seat,
    owner: prepared.seat,
    seat: prepared.seat,
    worktree: prepared.worktree,
    scope_count: prepared.writeScope.length,
    generated_scope_count: prepared.generatedOutputScope.length,
    base: prepared.base.slice(0, 8),
    source: recovered ? "scoped recovery candidate" : "clean base",
    recovered,
    assignment_package: packagePath,
    operator_summary: `${prepared.seat} started with ${prepared.writeScope.length} scoped path(s) from ${recovered ? "a recovery candidate" : "the clean base"}.`,
    completion_sentinel: `ACG_SEAT_READY:${path.basename(packagePath).match(/[a-f0-9]{16}/)?.[0] ?? "verified"}`
  };
}

export function inspectSeat(options, policyRoot) {
  const project = required(options.project, "project").trim();
  const target = existingRoot(options.path, "read-only target");
  const seat = workerSeat(options.seat, "seat");
  const model = required(options.model, "model");
  const reasoning = required(options.reasoning, "reasoning");
  const policy = readOnlyLifecycle(options, target, policyRoot);
  const childCli = childCliPath();
  const nativeQuarantine = buildNativeQuarantineLaunch({
    seatId: seat,
    model,
    reasoning,
    attempt: options.attempt ?? 1
  });
  const resultSentinel = `ACG_READ_ONLY_SEAT_RESULT:${crypto.randomBytes(8).toString("hex")}`;
  const packageValue = {
    schema_version: 1,
    package_type: "governed_read_only_seat_assignment",
    created_at: new Date().toISOString(),
    project,
    objective: options.objective || null,
    thread_id: options.thread || null,
    seat,
    read_only: true,
    target,
    requested_model: model,
    requested_reasoning_raw: reasoning,
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified",
    native_quarantine: nativeQuarantine,
    result_sentinel: resultSentinel,
    child_ledger: "fresh_no_parent_receipt",
    child_preflight: {
      executable: process.execPath,
      args: [
        childCli,
        "audit",
        "--project", project,
        "--path", target
      ],
      shell: false,
      success_field: "audit_ready",
      completion_sentinel_prefix: "ACG_AUDIT_READY:"
    },
    retry_contract: {
      corrected_retries: 1,
      follow_structured_remediation: true,
      catalog_discovery: "only_when_the_error_explicitly_requires_list_all",
      reuse_same_seat_when: [
        "objective_project_target_model_reasoning_and_authority_remain_valid",
        "the_child_context_and_governance_release_are_current"
      ],
      replace_or_stop_when: [
        "the_assignment_contract_changed",
        "the_child_context_or_governance_release_is_stale",
        "the_single_corrected_retry_failed"
      ],
      forbidden_discovery: [
        "raw_route_delivery_or_acknowledgment",
        "unsupported_command_specific_help",
        "shell_wrappers_or_reserved_shell_variables"
      ]
    },
    policy_lifecycle: {
      resolution_receipt: policy.route,
      delivery_receipt: policy.delivery,
      context_acknowledgment: policy.acknowledgment.context_acknowledgment
    },
    operator_reporting: "Report the audit result or a material blocker. Keep routine lifecycle internals silent."
  };
  const packagePath = writeReadOnlyAssignment(privateRoot(options), packageValue);
  const admittedAssignment = readOnlyAdmittedAssignment(packageValue, packagePath);
  const childPreflight = {
    executable: process.execPath,
    args: [childCli, "seat", "preflight", "--assignment", packagePath],
    shell: false,
    success_field: "seat_preflight_ready",
    completion_sentinel_prefix: "ACG_READ_ONLY_SEAT_PREFLIGHT:"
  };
  recordEngineeringEventBestEffort({
    type: "seat.prepared",
    project,
    thread_id: options.thread,
    seat_id: seat,
    source: "seat_workflow"
  });
  return {
    schema_version: 1,
    command: "seat inspect",
    visibility: "normal",
    status: "ready",
    seat_ready: true,
    read_only: true,
    task: seat,
    owner: seat,
    seat,
    target,
    assignment_package: packagePath,
    native_quarantine: nativeQuarantine,
    native_quarantine_instruction: "Pass native_quarantine.spawn_request verbatim, wait for its exact completed initial response, then attest before sending the admitted assignment.",
    child_preflight: childPreflight,
    admitted_assignment: admittedAssignment,
    child_instruction: "After successful attestation, pass admitted_assignment.message verbatim using a runtime input that starts a new turn; the child runs it exactly once.",
    operator_summary: `${seat} is ready for a read-only audit of the approved target. Pass its exact one-command child preflight.`,
    completion_sentinel: `ACG_READ_ONLY_SEAT_READY:${path.basename(packagePath).match(/[a-f0-9]{16}/)?.[0] ?? "verified"}`
  };
}

export function preflightSeat(options, policyRoot) {
  const packagePath = existingRoot(options.assignment, "assignment package");
  const raw = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (raw.package_type === "governed_seat_assignment") return preflightMutatingSeat(packagePath, raw, policyRoot);
  const value = readOnlyAssignment(options);
  const audit = runAuditWorkflow({
    project: value.project,
    path: value.target
  }, policyRoot);
  const assignmentManifest = value.assignment.policy_lifecycle?.context_acknowledgment?.manifest?.sha256;
  if (
    typeof assignmentManifest !== "string" ||
    assignmentManifest !== audit.context_acknowledgment?.manifest?.sha256
  ) {
    fail("Read-only assignment governance release is stale; prepare a fresh seat inspect assignment");
  }
  return {
    ...audit,
    command: "seat preflight",
    seat_preflight_ready: true,
    read_only: true,
    seat: value.seat,
    objective: value.assignment.objective || null,
    assignment_package: value.packagePath,
    preflight_contract_verified: true,
    source_inspection_authorized: true,
    governance_command_contract: "No additional governance command is permitted for this assignment.",
    audit_completion_sentinel: audit.completion_sentinel,
    completion_sentinel: `ACG_READ_ONLY_SEAT_PREFLIGHT:${value.identity}`
  };
}

function preflightMutatingSeat(packagePath, assignment, policyRoot) {
  if (!fs.statSync(packagePath).isFile()) fail("Assignment package must be a regular file");
  const identity = path.basename(packagePath).match(/^assignment-([a-f0-9]{16})\.json$/)?.[1];
  const expected = crypto.createHash("sha256").update(JSON.stringify(assignment)).digest("hex").slice(0, 16);
  if (!identity || identity !== expected) fail("Mutating assignment package content identity does not match its filename");
  if (assignment.package_type !== "governed_seat_assignment") fail("Assignment package is not a governed mutating seat assignment");
  const seat = workerSeat(assignment.seat, "assignment seat");
  const repository = existingRoot(assignment.repository, "assignment repository");
  const worktree = existingRoot(assignment.worktree, "assignment worktree");
  if (seat === "0") fail("Seat 0 is reserved for the coordinator and cannot receive a worker assignment");
  const verified = runHelper(policyRoot, ["verify", "--receipt", required(assignment.active_worktree_receipt, "assignment receipt")]);
  if (verified.worktree !== worktree || verified.repository !== repository || verified.seat !== seat) fail("Mutating assignment integrity does not match verified worktree receipt");
  const receipt = JSON.parse(fs.readFileSync(verified.receipt_path, "utf8"));
  const projectProvenance = bindContinuationProject({
    project: required(assignment.project, "assignment project"),
    receiptProject: receipt.project,
    repository,
    worktree
  });
  if (JSON.stringify(assignment.project_provenance) !== JSON.stringify(projectProvenance)) {
    fail("Mutating assignment project provenance is invalid");
  }
  if (assignment.continuation_parent_receipt !== undefined) {
    continuationProvenance(assignment, packagePath);
  }
  if (assignment.recovery_parent_assignment !== undefined) {
    recoveryProvenance(assignment, packagePath);
  }
  const intent = continuationIntent(assignment.immediate_intent, { defaultImplementation: true });
  const intentRoute = CONTINUATION_INTENTS[intent];
  const sourceMutationAuthorized = intent !== "deploy";
  const route = resolveRoute({
    mode: "mutation", phase: intentRoute.phase, project: required(assignment.project, "assignment project"),
    operations: intentRoute.operations, tools: intentRoute.tools, paths: [worktree], risk_tags: [],
    mutation_authority: sourceMutationAuthorized, authorities: intentRoute.authorities,
    runtime_capabilities: intentRoute.runtime_capabilities,
    subagent_worktree_receipt: verified.receipt_path
  }, policyRoot);
  const delivery = deliverResolvedPolicy(route, policyRoot);
  const acknowledgment = acknowledgeDelivery(delivery, policyRoot);
  const manifest = assignment.policy_lifecycle?.context_acknowledgment?.manifest?.sha256;
  if (typeof manifest !== "string" || manifest !== acknowledgment.context_acknowledgment?.manifest?.sha256) fail("Mutating assignment governance release is stale; prepare a fresh seat assign assignment");
  return {
    schema_version: 1, command: "seat preflight", seat_preflight_ready: true, read_only: false, seat,
    objective: assignment.objective || null, immediate_intent: intent, assignment_package: packagePath, preflight_contract_verified: true,
    mutation_authorized_in_verified_worktree: sourceMutationAuthorized,
    deployment_authorized_in_verified_worktree: intent === "deploy",
    worktree, route_request_field: verified.route_request_field,
    // The child must receive the verified policy text it is acknowledging, not
    // merely a receipt which says a delivery occurred.
    delivered_modules: delivery.delivered_modules,
    context_acknowledgment: acknowledgment.context_acknowledgment,
    authorization_decision: route.authorization_decision,
    governance_command_contract: "No additional governance command is permitted for this assignment.",
    completion_sentinel: `ACG_MUTATING_SEAT_PREFLIGHT:${identity}`
  };
}

export function assignSeat(options, policyRoot) {
  const prepared = prepare(options, policyRoot);
  const provenance = {
    schema_version: 1,
    receipt_type: "seat_source_provenance",
    created_at: new Date().toISOString(),
    project: options.project,
    seat: prepared.seat,
    repository: prepared.repository,
    base_commit: prepared.base,
    target_worktree: prepared.worktree,
    source_worktree: null,
    copied_files: [],
    assignment_receipt_sha256: prepared.gitAssignment.receipt_sha256
  };
  provenance.provenance_sha256 = digest(provenance);
  const root = privateRoot(options);
  const provenancePath = writePrivateJson(root, "provenance", provenance);
  const packageValue = assignmentPackage(
    options,
    prepared,
    prepared.gitAssignment.receipt_path,
    provenancePath,
    false
  );
  const packagePath = writePrivateJson(root, "assignment", packageValue);
  recordEngineeringEventBestEffort({
    type: "seat.prepared",
    project: options.project,
    thread_id: options.thread,
    work_id: prepared.workId,
    seat_id: prepared.seat,
    source: "seat_workflow"
  });
  const result = compactResult("seat assign", prepared, packagePath, prepared.gitAssignment.receipt_path, false);
  result.child_preflight = { executable: process.execPath, args: [childCliPath(), "seat", "preflight", "--assignment", packagePath], shell: false, success_field: "seat_preflight_ready", completion_sentinel_prefix: "ACG_MUTATING_SEAT_PREFLIGHT:" };
  result.child_instruction = "Pass child_preflight verbatim; the child runs it once before mutation and must not construct raw lifecycle JSON.";
  return result;
}

function recoverSeatFromAssignment(options, policyRoot) {
  for (const [key, label] of [
    ["source", "--source"],
    ["repository", "--repository"],
    ["base", "--base"],
    ["seat", "--seat"],
    ["workId", "--work-id"],
    ["worktree", "--worktree"],
    ["worktreeRoot", "--worktree-root"],
    ["writeScopes", "--write-scope"],
    ["generatedScopes", "--generated-scope"],
    ["copyPaths", "--copy"],
    ["model", "--model"],
    ["reasoning", "--reasoning"],
    ["project", "--project"]
  ]) {
    if (options[key] !== undefined) fail(`${label} cannot override assignment-derived recovery`);
  }
  const source = assignmentRecoverySource(options);
  const state = recoverySourceState(source.source, source.writeScope, source.generatedOutputScope);
  const recoveryIdentity = source.identity;
  const derivedOptions = {
    provenanceRoot: options.provenanceRoot,
    riskTags: options.riskTags,
    project: source.receipt.project,
    repository: source.repository,
    base: source.receipt.base_commit,
    seat: source.receipt.seat,
    workId: `recovery-${recoveryIdentity}`,
    worktree: path.join(
      path.dirname(source.source),
      `${path.basename(source.source)}-recovery-${recoveryIdentity}`
    ),
    writeScopes: source.writeScope,
    generatedScopes: source.generatedOutputScope,
    model: source.model,
    reasoning: source.reasoning,
    objective: source.assignment.objective || null,
    thread: source.assignment.thread_id || null,
    priorReceipt: source.assignment.policy_lifecycle?.context_acknowledgment ?? null
  };
  const prepared = prepare(derivedOptions, policyRoot);
  const copiedFiles = copyRecoveryFiles(source.source, prepared, state.copies);
  const continuation = runHelper(policyRoot, [
    "continue",
    "--receipt", prepared.gitAssignment.receipt_path,
    "--expected-head", prepared.base
  ]);
  const root = privateRoot(options);
  const provenancePath = privateJsonPath(root, "provenance");
  const packageValue = {
    ...assignmentPackage(
      derivedOptions,
      prepared,
      continuation.receipt_path,
      provenancePath,
      true
    ),
    recovery_parent_assignment: source.packagePath,
    recovery_parent_assignment_sha256: jsonDigest(source.assignment),
    recovery_original_receipt: source.original.path,
    recovery_original_receipt_sha256: source.original.receipt_sha256,
    recovery_excluded_paths: state.excludedPaths
  };
  const packagePath = writePrivateJson(root, "assignment", packageValue);
  const childPreflight = {
    executable: process.execPath,
    args: [childCliPath(), "seat", "preflight", "--assignment", packagePath],
    shell: false,
    success_field: "seat_preflight_ready",
    completion_sentinel_prefix: "ACG_MUTATING_SEAT_PREFLIGHT:"
  };
  const provenance = {
    schema_version: 1,
    receipt_type: "seat_assignment_recovery_provenance",
    created_at: packageValue.created_at,
    project: prepared.policy.acknowledgment.context_acknowledgment.project,
    seat: prepared.seat,
    work_id: prepared.workId,
    repository: prepared.repository,
    base_commit: prepared.base,
    source_worktree: source.source,
    source_head: source.receipt.base_commit,
    target_worktree: prepared.worktree,
    recovery_parent_assignment: source.packagePath,
    recovery_parent_assignment_sha256: jsonDigest(source.assignment),
    original_assignment_receipt: source.original.path,
    original_assignment_receipt_sha256: source.original.receipt_sha256,
    target_assignment_receipt: prepared.gitAssignment.receipt_path,
    target_assignment_receipt_sha256: prepared.gitAssignment.receipt_sha256,
    continuation_receipt: continuation.receipt_path,
    continuation_receipt_sha256: continuation.receipt_sha256,
    assignment_package: packagePath,
    assignment_package_sha256: jsonDigest(packageValue),
    child_preflight: childPreflight,
    copied_files: copiedFiles,
    excluded_paths: state.excludedPaths
  };
  provenance.provenance_sha256 = digest(provenance);
  writePrivateJsonAt(provenancePath, provenance);
  recordEngineeringEventBestEffort({
    type: "seat.recovered",
    project: derivedOptions.project,
    thread_id: derivedOptions.thread,
    work_id: prepared.workId,
    seat_id: prepared.seat,
    source: "seat_workflow"
  });
  const result = compactResult("seat recover", prepared, packagePath, continuation.receipt_path, true);
  result.assignment_derived = true;
  result.excluded_path_count = state.excludedPaths.length;
  result.excluded_paths = state.excludedPaths;
  result.child_preflight = childPreflight;
  result.child_instruction = "Pass the persisted child_preflight verbatim; the child runs it exactly once before mutation.";
  return result;
}

export function recoverSeat(options, policyRoot) {
  if (options.assignment !== undefined) return recoverSeatFromAssignment(options, policyRoot);
  const source = existingRoot(options.source, "source worktree");
  const prepared = prepare(options, policyRoot);
  if (commonGitDirectory(source) !== commonGitDirectory(prepared.repository)) fail("Source worktree belongs to another repository");
  if (fs.realpathSync(git(source, ["rev-parse", "--show-toplevel"])) !== source) fail("Source must be a Git worktree root");
  const sourceHead = git(source, ["rev-parse", "HEAD"]).toLowerCase();
  const ancestry = spawnSync("git", ["-C", source, "merge-base", "--is-ancestor", prepared.base, sourceHead]);
  if (ancestry.status !== 0) fail("The clean base is not an ancestor of the source candidate");

  runHelper(policyRoot, ["verify", "--receipt", prepared.gitAssignment.receipt_path]);
  const copies = normalizeList(options.copyPaths?.length ? options.copyPaths : prepared.writeScope, "copy path");
  const copiedFiles = copyRecoveryFiles(source, prepared, copies);

  const continuation = runHelper(policyRoot, [
    "continue",
    "--receipt", prepared.gitAssignment.receipt_path,
    "--expected-head", prepared.base
  ]);
  const provenance = {
    schema_version: 1,
    receipt_type: "seat_source_provenance",
    created_at: new Date().toISOString(),
    project: options.project,
    seat: prepared.seat,
    repository: prepared.repository,
    base_commit: prepared.base,
    source_worktree: source,
    source_head: sourceHead,
    source_dirty: Boolean(git(source, ["status", "--porcelain=v1", "--untracked-files=all"])),
    target_worktree: prepared.worktree,
    assignment_receipt_sha256: prepared.gitAssignment.receipt_sha256,
    continuation_receipt_sha256: continuation.receipt_sha256,
    copied_files: copiedFiles
  };
  provenance.provenance_sha256 = digest(provenance);
  const root = privateRoot(options);
  const provenancePath = writePrivateJson(root, "provenance", provenance);
  const packageValue = assignmentPackage(
    options,
    prepared,
    continuation.receipt_path,
    provenancePath,
    true
  );
  const packagePath = writePrivateJson(root, "assignment", packageValue);
  recordEngineeringEventBestEffort({
    type: "seat.recovered",
    project: options.project,
    thread_id: options.thread,
    work_id: prepared.workId,
    seat_id: prepared.seat,
    source: "seat_workflow"
  });
  return compactResult("seat recover", prepared, packagePath, continuation.receipt_path, true);
}

export function continueSeat(options, policyRoot) {
  const receipt = existingRoot(options.receipt, "assignment receipt");
  const expectedHead = required(options.expectedHead, "expected head");
  const project = required(options.project, "project").trim();
  const stableProject = slug(project, "project");
  if (project !== stableProject) fail(`project must be the stable slug: ${stableProject}`);
  const intent = continuationIntent(options.intent, { defaultImplementation: true });
  const continuation = runHelper(policyRoot, [
    "continue",
    "--receipt", receipt,
    "--expected-head", expectedHead
  ]);
  const continuationReceipt = JSON.parse(fs.readFileSync(continuation.receipt_path, "utf8"));
  const projectProvenance = bindContinuationProject({
    project: stableProject,
    receiptProject: continuationReceipt.project,
    repository: continuation.repository,
    worktree: continuation.worktree
  });
  const originalReceipt = readWorktreeReceipt(receipt, "original assignment receipt");
  const activeReceipt = readWorktreeReceipt(continuation.receipt_path, "continuation receipt");
  const root = privateRoot(options);
  const provenancePath = privateJsonPath(root, "continuation-provenance");
  const canonicalRoot = path.dirname(provenancePath);
  const packageValue = {
    schema_version: 1,
    package_type: "governed_seat_assignment",
    created_at: new Date().toISOString(),
    project: stableProject,
    project_provenance: projectProvenance,
    objective: options.objective || null,
    thread_id: options.thread || null,
    seat: continuation.seat,
    work_id: continuation.work_id,
    repository: continuation.repository,
    worktree: continuation.worktree,
    base_commit: continuation.base_commit,
    write_scope: JSON.parse(fs.readFileSync(continuation.receipt_path, "utf8")).write_scope ?? [],
    generated_output_scope: JSON.parse(fs.readFileSync(continuation.receipt_path, "utf8")).generated_output_scope ?? [],
    source_recovery: false,
    requested_model: "Unverified",
    requested_reasoning_raw: "Unverified",
    actual_model: "Unverified",
    actual_reasoning_raw: "Unverified",
    active_worktree_receipt: continuation.receipt_path,
    continuation_parent_receipt: receipt,
    dirty_paths: continuation.dirty_paths,
    immediate_intent: intent,
    provenance_path: provenancePath,
    child_preflight_contract: `seat preflight --assignment <assignment-package>; it ${CONTINUATION_INTENTS[intent].contract}`,
    child_ledger: "verified_dirty_continuation",
    policy_lifecycle: {
      context_acknowledgment: { manifest: { sha256: activeManifestSha256(policyRoot) } }
    },
    operator_reporting: "Report routine governance as one concise status. Surface receipts or routing detail only for a blocker, decision, safety issue, or explicit operator request."
  };
  const packageIdentity = crypto.createHash("sha256").update(JSON.stringify(packageValue)).digest("hex").slice(0, 16);
  const packagePath = path.join(canonicalRoot, `assignment-${packageIdentity}.json`);
  const provenance = {
    schema_version: 1,
    receipt_type: "seat_continuation_provenance",
    created_at: packageValue.created_at,
    project: stableProject,
    project_provenance: projectProvenance,
    seat: continuation.seat,
    work_id: continuation.work_id,
    repository: continuation.repository,
    worktree: continuation.worktree,
    base_commit: continuation.base_commit,
    immediate_intent: intent,
    original_assignment_receipt: originalReceipt.path,
    original_assignment_receipt_sha256: originalReceipt.receipt_sha256,
    continuation_receipt: activeReceipt.path,
    continuation_receipt_sha256: activeReceipt.receipt_sha256,
    assignment_package: packagePath,
    assignment_package_sha256: assignmentBindingDigest(packageValue),
    copied_files: []
  };
  provenance.provenance_sha256 = digest(provenance);
  writePrivateJsonAt(provenancePath, provenance);
  writePrivateJsonAt(packagePath, packageValue);
  const childPreflight = {
    executable: process.execPath,
    args: [childCliPath(), "seat", "preflight", "--assignment", packagePath],
    shell: false,
    success_field: "seat_preflight_ready",
    completion_sentinel_prefix: "ACG_MUTATING_SEAT_PREFLIGHT:"
  };
  const update = {
    schema_version: 1,
    package_type: "governed_seat_continuation",
    created_at: packageValue.created_at,
    dirty_paths: continuation.dirty_paths,
    immediate_intent: intent,
    project: stableProject,
    project_provenance: projectProvenance,
    active_worktree_receipt: continuation.receipt_path,
    assignment_package: packagePath
  };
  const updatePath = writePrivateJson(canonicalRoot, "continuation", update);
  if (options.project && options.seat) {
    recordEngineeringEventBestEffort({
      type: "seat.continued",
      project: options.project,
      thread_id: options.thread,
      work_id: options.workId,
      seat_id: options.seat,
      source: "seat_workflow"
    });
  }
  return {
    schema_version: 1,
    command: "seat continue",
    visibility: "normal",
    status: "ready",
    continuation_ready: true,
    scope_count: continuation.dirty_paths.length,
    immediate_intent: intent,
    continuation_package: updatePath,
    assignment_package: packagePath,
    child_preflight: childPreflight,
    child_instruction: "Pass child_preflight verbatim; the replacement runs it exactly once before its bound implementation, validation, or deployment operation and must not construct raw lifecycle JSON.",
    operator_summary: "The seat's expected owned changes are bound for continuation.",
    completion_sentinel: continuation.completion_sentinel
  };
}

export function finalizeSeat(options, policyRoot) {
  const packagePath = existingRoot(options.assignment, "assignment package");
  const assignment = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (assignment.package_type !== "governed_seat_assignment") fail("Invalid assignment package");
  workerSeat(assignment.seat, "assignment seat");
  let receipt;
  if (assignment.continuation_parent_receipt !== undefined) {
    continuationProvenance(assignment, packagePath);
    const boundReceipt = existingRoot(assignment.active_worktree_receipt, "continuation receipt");
    if (options.receipt !== undefined && existingRoot(options.receipt, "finalize receipt") !== boundReceipt) {
      fail("Finalize receipt must match the continuation receipt bound into the assignment");
    }
    receipt = boundReceipt;
  } else {
    let recovery = null;
    if (assignment.recovery_parent_assignment !== undefined) {
      recovery = recoveryProvenance(assignment, packagePath);
    }
    const boundReceipt = existingRoot(assignment.active_worktree_receipt, "assignment receipt");
    if (options.receipt !== undefined && existingRoot(options.receipt, "finalize receipt") !== boundReceipt) {
      fail("Finalize receipt must match the receipt bound into the assignment");
    }
    const originalReceipt = readWorktreeReceipt(
      boundReceipt,
      "finalize assignment receipt"
    );
    const worktree = existingRoot(assignment.worktree, "assignment worktree");
    const dirty = Boolean(git(worktree, ["status", "--porcelain=v1", "--untracked-files=all"]));
    if (dirty && recovery !== null) {
      const recoveryBaseReceipt = readWorktreeReceipt(
        recovery.provenance.target_assignment_receipt,
        "recovery target assignment receipt"
      );
      if (
        recovery.provenance.target_assignment_receipt_sha256 !== recoveryBaseReceipt.receipt_sha256 ||
        recoveryBaseReceipt.receipt.receipt_purpose === "continuation" ||
        recoveryBaseReceipt.receipt.repository !== assignment.repository ||
        recoveryBaseReceipt.receipt.worktree !== assignment.worktree ||
        recoveryBaseReceipt.receipt.branch !== originalReceipt.receipt.branch ||
        recoveryBaseReceipt.receipt.base_commit !== assignment.base_commit ||
        JSON.stringify(recoveryBaseReceipt.receipt.write_scope ?? []) !== JSON.stringify(assignment.write_scope) ||
        JSON.stringify(recoveryBaseReceipt.receipt.generated_output_scope ?? []) !== JSON.stringify(assignment.generated_output_scope)
      ) {
        fail("Recovery provenance target receipt does not bind the recovered assignment");
      }
      const continuation = runHelper(policyRoot, [
        "continue",
        "--receipt", recoveryBaseReceipt.path,
        "--expected-head", assignment.base_commit
      ]);
      receipt = continuation.receipt_path;
    } else if (dirty && originalReceipt.receipt.receipt_purpose !== "continuation") {
      const continuation = runHelper(policyRoot, [
        "continue",
        "--receipt", originalReceipt.path,
        "--expected-head", assignment.base_commit
      ]);
      receipt = continuation.receipt_path;
    } else {
      receipt = originalReceipt.path;
    }
  }
  const verifiedFinalization = runHelper(policyRoot, ["verify", "--receipt", receipt]);
  const worktree = existingRoot(assignment.worktree, "assignment worktree");
  const finalizationReceipt = readWorktreeReceipt(
    verifiedFinalization.receipt_path,
    "verified finalization receipt"
  );
  const receiptPaths = [...new Set([
    ...(verifiedFinalization.dirty_paths ?? []),
    ...(finalizationReceipt.receipt.generated_output_scope_roots ?? [])
  ])].sort();
  const writeScope = normalizeList(assignment.write_scope, "assignment write scope");
  const generatedOutputScope = normalizeList(assignment.generated_output_scope, "assignment generated output scope");
  assertGeneratedScopes(writeScope, generatedOutputScope);
  const changedPaths = [];
  const generatedPaths = [];
  for (const candidate of receiptPaths) {
    const inWriteScope = isWithinScope(candidate, writeScope);
    const inGeneratedScope = isWithinScope(candidate, generatedOutputScope);
    if (inWriteScope && inGeneratedScope) {
      fail(`Finalized path ambiguously overlaps write and generated-output scopes: ${candidate}`);
    }
    if (inWriteScope) changedPaths.push(candidate);
    else if (inGeneratedScope) generatedPaths.push(candidate);
    else fail(`Finalized path is outside declared write and generated-output scopes: ${candidate}`);
  }
  for (const candidate of changedPaths) {
    const file = path.join(worktree, ...candidate.split("/"));
    let stat = null;
    try {
      stat = fs.lstatSync(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat?.isSymbolicLink()) {
      fail(`Finalized source output must not be a symbolic link: ${candidate}`);
    }
  }
  const provenancePath = existingRoot(assignment.provenance_path, "provenance");
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  provenance.finalized_at = new Date().toISOString();
  provenance.final_head = git(worktree, ["rev-parse", "HEAD"]).toLowerCase();
  provenance.finalization_receipt = verifiedFinalization.receipt_path;
  provenance.finalization_receipt_sha256 = verifiedFinalization.receipt_sha256;
  provenance.final_changed_paths = changedPaths;
  provenance.final_files = changedPaths.map((relative) => {
    const file = path.join(worktree, ...relative.split("/"));
    return {
      path: relative,
      final_digest: fs.existsSync(file) && fs.lstatSync(file).isFile() ? sha256File(file) : null,
      deleted: !fs.existsSync(file)
    };
  });
  provenance.final_generated_paths = generatedPaths;
  provenance.final_generated_files = generatedPaths.map((relative) => {
    const file = path.join(worktree, ...relative.split("/"));
    const exists = fs.existsSync(file);
    const stat = exists ? fs.lstatSync(file) : null;
    if (stat?.isSymbolicLink() || (stat && !stat.isFile() && !stat.isDirectory())) {
      fail(`Finalized generated output must be a regular file or directory: ${relative}`);
    }
    return {
      path: relative,
      type: !exists ? null : stat.isFile() ? "file" : "directory",
      final_digest: stat?.isFile() ? sha256File(file) : null,
      deleted: !exists
    };
  });
  for (const copied of provenance.copied_files) {
    copied.final_digest = provenance.final_files.find((entry) => entry.path === copied.path)?.final_digest ?? null;
    copied.modified_after_copy = copied.final_digest !== copied.destination_initial_digest;
  }
  provenance.provenance_sha256 = digest(provenance);
  const temporary = `${provenancePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(provenance, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, provenancePath);
  recordEngineeringEventBestEffort({
    type: "seat.finalized",
    project: assignment.project,
    thread_id: assignment.thread_id || undefined,
    work_id: assignment.work_id,
    seat_id: assignment.seat,
    source: "seat_workflow"
  });
  return {
    schema_version: 1,
    command: "seat finalize",
    visibility: "normal",
    status: "recorded",
    changed_paths: changedPaths.length,
    generated_paths: generatedPaths.length,
    provenance: provenancePath,
    operator_summary: `Seat evidence recorded for ${changedPaths.length} integrable path(s) and ${generatedPaths.length} generated-output path(s).`,
    completion_sentinel: `ACG_SEAT_FINALIZED:${provenance.provenance_sha256.slice(7, 23)}`
  };
}

export function explainSeat(options) {
  const packagePath = existingRoot(options.assignment, "assignment package");
  const assignment = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (
    assignment.package_type !== "governed_seat_assignment" &&
    assignment.package_type !== "governed_read_only_seat_assignment"
  ) {
    fail("Invalid assignment package");
  }
  if (assignment.package_type === "governed_read_only_seat_assignment") {
    const value = readOnlyAssignment(options);
    return {
      schema_version: 1,
      command: "seat explain",
      visibility: "diagnostic",
      assignment_package: packagePath,
      read_only: true,
      assignment: value.assignment,
      admitted_assignment: value.admittedAssignment,
      provenance: null
    };
  }
  if (assignment.continuation_parent_receipt !== undefined) {
    continuationProvenance(assignment, packagePath);
  }
  if (assignment.recovery_parent_assignment !== undefined) {
    recoveryProvenance(assignment, packagePath);
  }
  const provenancePath = existingRoot(assignment.provenance_path, "provenance");
  return {
    schema_version: 1,
    command: "seat explain",
    visibility: "diagnostic",
    assignment_package: packagePath,
    read_only: false,
    assignment,
    provenance: JSON.parse(fs.readFileSync(provenancePath, "utf8"))
  };
}
