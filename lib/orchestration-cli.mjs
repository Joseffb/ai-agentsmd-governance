import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORCHESTRATION_COMPOSER_VERSION,
  buildOrchestrationBundle,
  validateOrchestrationBundle
} from "./orchestration.mjs";

const MAX_FACTS_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 128 * 1024;
const LIFECYCLE_FIELDS = new Set([
  "schema_version",
  "bundle_type",
  "bundle_digest",
  "predecessor_digest",
  "release_identity",
  "project_identity",
  "immediate_intent",
  "classification",
  "seat0_decision",
  "rule_selection",
  "topology",
  "model_recommendation",
  "contracts",
  "native_fallback"
]);

const UNVERIFIED = "Unverified";
const COMPOSER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeIdentifier(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(normalized)) fail(`${label} is not a safe identifier`);
  return normalized;
}

function existingDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) fail(`${label} must be an absolute path`);
  const resolved = path.resolve(value);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail(`${label} does not exist`);
  }
  if (!stat.isDirectory()) fail(`${label} must be a directory`);
  return fs.realpathSync(resolved);
}

function privateDirectory(directory) {
  if (fs.existsSync(directory)) {
    if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) {
      fail("private orchestration directory is unsafe");
    }
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(directory, 0o700);
  return fs.realpathSync(directory);
}

function persistenceRoot() {
  const configured = process.env.ACG_ORCHESTRATION_BUNDLE_ROOT;
  if (configured !== undefined && !path.isAbsolute(configured)) {
    fail("ACG_ORCHESTRATION_BUNDLE_ROOT must be an absolute path");
  }
  return configured || path.join(os.homedir(), ".codex", "governance", "orchestration-bundles");
}

function privateBundleDirectory(projectRoot, project) {
  // Persist Agent System state outside the classified project. The project
  // root is used only as an identity input, never as an output location.
  const persistence = privateDirectory(persistenceRoot());
  const projectDirectory = privateDirectory(path.join(persistence, project));
  const projectDigest = crypto.createHash("sha256").update(projectRoot).digest("hex");
  return privateDirectory(path.join(projectDirectory, projectDigest));
}

function assertPrivateRegularFile(file, label) {
  if (typeof file !== "string" || !path.isAbsolute(file)) fail(`${label} must be an absolute path`);
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    fail(`${label} does not exist`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label} must be a regular file`);
  if ((stat.mode & 0o077) !== 0 || (stat.mode & 0o400) === 0) fail(`${label} must have private owner-only permissions`);
  return fs.realpathSync(resolved);
}

function readBoundedFile(file, label, maximum) {
  const resolved = assertPrivateRegularFile(file, label);
  if (fs.statSync(resolved).size > maximum) fail(`${label} exceeds the ${maximum}-byte limit`);
  return { path: resolved, text: fs.readFileSync(resolved, "utf8") };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function readRegularJsonIfPresent(file, label) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label} must be a regular file`);
  return parseJson(fs.readFileSync(file, "utf8"), label);
}

function systemVersion(value, label) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/iu.test(value)) {
    fail(`${label} has an invalid system version`);
  }
  return value;
}

/**
 * Resolves only identity packaged beside this composer. A source checkout uses
 * its package.json; an installed runtime uses the enclosing immutable
 * release.json. Neither is evidence that host interception is active.
 */
export function resolveOrchestrationReleaseIdentity(composerRoot = COMPOSER_ROOT) {
  const normalizedRoot = path.resolve(composerRoot);
  const packageMetadata = readRegularJsonIfPresent(path.join(normalizedRoot, "package.json"), "composer package.json");
  const releaseRoot = path.basename(normalizedRoot) === "policies" ? path.dirname(normalizedRoot) : null;
  const releaseMetadata = releaseRoot
    ? readRegularJsonIfPresent(path.join(releaseRoot, "release.json"), "immutable release.json")
    : null;
  let installedReleaseId = UNVERIFIED;
  let installedSystemVersion = UNVERIFIED;
  let installedReleaseEvidence = UNVERIFIED;
  if (releaseMetadata) {
    if (typeof releaseMetadata.release_id !== "string" ||
      !/^v1-[a-f0-9]{16,}$/u.test(releaseMetadata.release_id) ||
      path.basename(releaseRoot) !== releaseMetadata.release_id ||
      path.basename(path.dirname(releaseRoot)) !== "releases") {
      fail("immutable release.json identity is invalid");
    }
    installedReleaseId = releaseMetadata.release_id;
    installedSystemVersion = releaseMetadata.system_version === undefined
      ? UNVERIFIED
      : systemVersion(releaseMetadata.system_version, "immutable release.json");
    installedReleaseEvidence = "immutable_release_json";
  }
  return Object.freeze({
    composer_version: ORCHESTRATION_COMPOSER_VERSION,
    checkout_system_version: packageMetadata
      ? systemVersion(packageMetadata.version, "composer package.json")
      : UNVERIFIED,
    checkout_system_version_evidence: packageMetadata ? "package_json" : UNVERIFIED,
    installed_system_version: installedSystemVersion,
    installed_release_id: installedReleaseId,
    installed_release_evidence: installedReleaseEvidence,
    active_host_interception: UNVERIFIED
  });
}

function repositoryRootFor(projectRoot) {
  let current = projectRoot;
  for (;;) {
    const marker = path.join(current, ".git");
    if (fs.existsSync(marker)) {
      const stat = fs.lstatSync(marker);
      if (stat.isDirectory() || stat.isFile()) return fs.realpathSync(current);
    }
    const parent = path.dirname(current);
    if (parent === current) return projectRoot;
    current = parent;
  }
}

function projectIdentity(project, projectRoot, immediateIntent) {
  const repositoryRoot = repositoryRootFor(projectRoot);
  const subtree = path.relative(repositoryRoot, projectRoot).replaceAll("\\", "/") || ".";
  if (subtree === ".." || subtree.startsWith("../") || path.isAbsolute(subtree)) {
    fail("project root is outside the resolved repository root");
  }
  return Object.freeze({
    project,
    project_root: projectRoot,
    repository_root: repositoryRoot,
    subtree,
    immediate_intent: immediateIntent
  });
}

function assertFacts(facts) {
  if (!isPlainObject(facts)) fail("orchestration facts must be a JSON object");
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (LIFECYCLE_FIELDS.has(key)) fail(`orchestration facts may not contain raw lifecycle field: ${key}`);
      visit(child);
    }
  };
  visit(facts);
  return facts;
}

function persistedText(bundle) {
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_BUNDLE_BYTES) fail("orchestration bundle exceeds the private persistence limit");
  return text;
}

function writePrivateBundle(directory, bundle) {
  const destination = path.join(directory, `${bundle.bundle_digest.slice("sha256:".length)}.json`);
  const text = persistedText(bundle);
  if (fs.existsSync(destination)) {
    const existing = readPersistedBundle(destination, "existing orchestration bundle");
    if (existing.bundle_digest !== bundle.bundle_digest || JSON.stringify(existing) !== JSON.stringify(bundle)) {
      fail("existing orchestration bundle conflicts with its digest");
    }
    return destination;
  }
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.chmodSync(temporary, 0o600);
    try {
      fs.linkSync(temporary, destination);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readPersistedBundle(destination, "existing orchestration bundle");
      if (existing.bundle_digest !== bundle.bundle_digest || JSON.stringify(existing) !== JSON.stringify(bundle)) {
        fail("existing orchestration bundle conflicts with its digest");
      }
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return destination;
}

function actionFor(bundle) {
  switch (bundle.classification.classification) {
    case "seat0_owned":
      return `seat0_may_perform_${bundle.classification.seat0_activity}`;
    case "seat0_atomic_allowed":
      return "seat0_may_perform_one_atomic_source_mutation";
    case "worker_required":
      if (!bundle.topology) return "prepare_and_assign_a_mutating_worker_worktree";
      switch (bundle.topology.execution_class) {
        case "PARALLEL":
          return "prepare_and_assign_parallel_launch_stage_1_workers";
        case "PIPELINED":
          return "prepare_and_assign_only_available_pipeline_launch_stage_1_workers";
        case "SERIAL":
          return "prepare_and_assign_one_serial_coherent_chain_worker";
        case "EXPLORATORY":
          return "prepare_and_assign_one_bounded_discovery_worker_before_implementation";
        default:
          fail("orchestration topology has no deterministic execution class");
      }
    case "project_authority_required":
      return "obtain_project_authority_for_declared_effects";
    default:
      fail("orchestration bundle contains an unknown decision");
  }
}

function boundedReport(bundlePath, bundle, verified) {
  return Object.freeze({
    bundle_path: bundlePath,
    bundle_digest: bundle.bundle_digest,
    ...(verified ? { integrity: "verified" } : { persisted: true }),
    decision: bundle.classification.classification,
    exact_next_action: actionFor(bundle)
  });
}

/** Reads a bounded facts document or stdin without accepting raw lifecycle data. */
export async function readOrchestrationFacts(source) {
  let text;
  if (source === "-") {
    let total = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      total += Buffer.byteLength(chunk);
      if (total > MAX_FACTS_BYTES) fail(`orchestration facts exceeds the ${MAX_FACTS_BYTES}-byte limit`);
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8");
  } else {
    if (typeof source !== "string" || !source) fail("--facts requires a JSON file path or -");
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FACTS_BYTES) {
      fail(`orchestration facts exceeds the ${MAX_FACTS_BYTES}-byte limit or is not a regular file`);
    }
    text = fs.readFileSync(source, "utf8");
  }
  return assertFacts(parseJson(text, "orchestration facts"));
}

/** Reads, permission-checks, and validates a persisted bundle. */
export function readPersistedBundle(file, label = "orchestration bundle") {
  const input = readBoundedFile(file, label, MAX_BUNDLE_BYTES);
  const bundle = parseJson(input.text, label);
  validateOrchestrationBundle(bundle);
  return bundle;
}

/** Builds a JIT bundle, binds only an already-verified predecessor, and persists it privately. */
export function orchestrateNext({ project, root, intent, facts, priorBundle } = {}) {
  const normalizedProject = safeIdentifier(project, "project");
  const normalizedRoot = existingDirectory(root, "path");
  const normalizedIntent = safeIdentifier(intent, "intent");
  const normalizedFacts = assertFacts(facts);
  const predecessor = priorBundle ? readPersistedBundle(priorBundle, "prior bundle") : null;
  const identity = projectIdentity(normalizedProject, normalizedRoot, normalizedIntent);
  if (predecessor && (
    predecessor.project_identity.project !== identity.project ||
    predecessor.project_identity.project_root !== identity.project_root ||
    predecessor.project_identity.repository_root !== identity.repository_root ||
    predecessor.project_identity.subtree !== identity.subtree
  )) {
    fail("prior bundle belongs to a different project or repository identity");
  }
  if (predecessor && normalizedFacts.context_ledger !== undefined) {
    fail("context_ledger is inherited from the verified prior bundle");
  }
  const bundle = buildOrchestrationBundle({
    ...normalizedFacts,
    release_identity: resolveOrchestrationReleaseIdentity(),
    project_identity: identity,
    ...(predecessor ? { context_ledger: predecessor.rule_selection.context_ledger } : {}),
    immediate_intent: normalizedIntent,
    predecessor_digest: predecessor?.bundle_digest ?? null
  });
  const directory = privateBundleDirectory(normalizedRoot, normalizedProject);
  const bundlePath = writePrivateBundle(directory, bundle);
  return boundedReport(bundlePath, bundle, false);
}

/** Verifies private permissions and the content-addressed core integrity contract. */
export function verifyPersistedOrchestrationBundle(bundlePath) {
  const resolved = assertPrivateRegularFile(bundlePath, "bundle");
  const bundle = readPersistedBundle(resolved);
  return boundedReport(resolved, bundle, true);
}
