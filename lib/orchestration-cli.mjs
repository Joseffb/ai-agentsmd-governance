import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORCHESTRATION_COMPOSER_VERSION,
  buildOrchestrationBundle,
  canonicalJson,
  sha256,
  validateOrchestrationBundle
} from "./orchestration.mjs";
import { recordEngineeringEventBestEffort } from "./engineering-metrics.mjs";

const MAX_FACTS_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 128 * 1024;
const MAX_LAUNCH_PACKAGE_BYTES = 192 * 1024;
const MODEL_ROUTING_GATE_PREFIX = "MODEL_ROUTING_GATE_V1 ";
const LIFECYCLE_FIELDS = new Set([
  "schema_version",
  "bundle_type",
  "bundle_digest",
  "predecessor_digest",
  "release_identity",
  "project_identity",
  "execution_id",
  "correlation_id",
  "causation_id",
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

function mintExecutionId() {
  return `execution-${sha256(crypto.randomUUID()).slice("sha256:".length, "sha256:".length + 32)}`;
}

function decisionEvent(bundle) {
  const decision = bundle.seat0_decision;
  return {
    type: "decision.material",
    project: bundle.project_identity.project,
    execution_id: bundle.execution_id,
    correlation_id: bundle.correlation_id,
    causation_id: bundle.causation_id,
    source: "scheduler",
    evidence_class: "observed",
    evidence_authority: "operator_record",
    coverage_status: "complete",
    decision_id: `decision-${bundle.bundle_digest.slice("sha256:".length, "sha256:".length + 32)}`,
    decision_scope: "execution",
    decision_type: "orchestration_classification",
    requested_action: bundle.immediate_intent,
    normal_path: decision.decision,
    decision_authority: "policy",
    authority_refs: ["external_user_or_project_authority_only"],
    evidence_refs: [bundle.bundle_digest],
    rule_refs: bundle.rule_selection.required_rule_ids.length ? bundle.rule_selection.required_rule_ids : ["no_rule_delta"],
    reason_summary: `classifier:${decision.decision}`,
    alternative_codes: [],
    risk_summary: `declared_effects:${bundle.classification.effects.length}`,
    expected_effect: "observational_execution_evidence_only",
    actor: "seat_0",
    decision_status: "recorded",
    decision_revision: "r1",
    decision_basis_ref: bundle.bundle_digest,
    decision_artifact_ref: bundle.bundle_digest,
    result_event_ids: []
  };
}

function recordCanonicalBundleEvidence(bundle, isFirstBundle) {
  if (isFirstBundle) {
    recordEngineeringEventBestEffort({
      type: "execution.queued",
      project: bundle.project_identity.project,
      execution_id: bundle.execution_id,
      correlation_id: bundle.correlation_id,
      causation_id: bundle.causation_id,
      source: "scheduler",
      evidence_class: "observed",
      evidence_authority: "operator_record",
      coverage_status: "complete"
    });
  }
  if (bundle.seat0_decision.material) recordEngineeringEventBestEffort(decisionEvent(bundle));
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

function privatePersistenceRoot() {
  const configured = persistenceRoot();
  let stat;
  try {
    stat = fs.lstatSync(configured);
  } catch {
    fail("private orchestration root does not exist");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    fail("private orchestration root must be an owner-only directory");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    fail("private orchestration root must be owned by the current user");
  }
  return fs.realpathSync(configured);
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
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) fail(`${label} must be owned by the current user`);
  return fs.realpathSync(resolved);
}

function privateBundleUnderPersistenceRoot(file) {
  const resolved = assertPrivateRegularFile(file, "bundle");
  const root = privatePersistenceRoot();
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("bundle must be inside the private orchestration root");
  }
  return resolved;
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

function writePrivateLaunchPackage(bundlePath, seat, launchPackage) {
  const destination = path.join(
    path.dirname(bundlePath),
    `${path.basename(bundlePath, ".json")}.seat-${seat}.launch.json`
  );
  const text = `${JSON.stringify(launchPackage, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_LAUNCH_PACKAGE_BYTES) {
    fail("orchestration launch package exceeds the private persistence limit");
  }
  if (fs.existsSync(destination)) {
    const existing = readBoundedFile(destination, "existing launch package", MAX_LAUNCH_PACKAGE_BYTES);
    const parsed = parseJson(existing.text, "existing launch package");
    if (canonicalJson(parsed) !== canonicalJson(launchPackage)) {
      fail("existing orchestration launch package conflicts with its bound assignment");
    }
    return destination;
  }
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.chmodSync(temporary, 0o600);
    fs.linkSync(temporary, destination);
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
    predecessor_digest: predecessor?.bundle_digest ?? null,
    execution_id: predecessor?.execution_id ?? mintExecutionId(),
    ...(predecessor ? {
      correlation_id: predecessor.correlation_id,
      // The successor's causation ID is deterministically derived from the
      // verified predecessor digest by the v6 bundle builder.
      causation_id: undefined
    } : {})
  });
  const directory = privateBundleDirectory(normalizedRoot, normalizedProject);
  const bundlePath = writePrivateBundle(directory, bundle);
  recordCanonicalBundleEvidence(bundle, !predecessor);
  return boundedReport(bundlePath, bundle, false);
}

/** Verifies private permissions and the content-addressed core integrity contract. */
export function verifyPersistedOrchestrationBundle(bundlePath) {
  const resolved = assertPrivateRegularFile(bundlePath, "bundle");
  const bundle = readPersistedBundle(resolved);
  return boundedReport(resolved, bundle, true);
}

/**
 * Verifies the optional high-level bridge from a canonical bundle into a seat
 * workflow.  It exposes only the identity and selected worker contract; it
 * neither grants project authority nor accepts caller-composed lifecycle data.
 */
export function bindOrchestrationBundleToSeat({ bundlePath, project, seat, repository, target } = {}) {
  if (bundlePath === undefined) return null;
  const resolvedBundlePath = privateBundleUnderPersistenceRoot(bundlePath);
  const bundle = readPersistedBundle(resolvedBundlePath);
  if (bundle.schema_version !== 6) {
    fail("orchestration bundle binding requires v6; remediation: run orchestrate next without --prior-bundle, then use its returned --bundle path");
  }
  if (bundle.classification.classification !== "worker_required" || !bundle.topology) {
    fail("orchestration bundle binding requires a worker-required bundle with topology");
  }
  if (bundle.project_identity.project !== project) fail("orchestration bundle project does not match seat project");
  if (repository !== undefined && bundle.project_identity.repository_root !== repository) {
    fail("orchestration bundle repository does not match seat repository");
  }
  if (target !== undefined && bundle.project_identity.project_root !== target) {
    fail("orchestration bundle project root does not match seat inspect target");
  }
  const workerSeatValue = workerSeat(String(seat));
  const worker = bundle.topology.workers.find((candidate) => candidate.seat === workerSeatValue);
  if (!worker) fail("orchestration bundle does not select the requested worker seat");
  return Object.freeze({
    bundle_path: resolvedBundlePath,
    bundle_digest: bundle.bundle_digest,
    worker_seat: workerSeatValue,
    worker_assignment_ids: Object.freeze([...worker.assignment_ids]),
    execution_id: bundle.execution_id,
    correlation_id: bundle.correlation_id,
    causation_id: bundle.causation_id
  });
}

function workerSeat(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    fail("--seat must be a canonical worker seat integer in the range 1..N");
  }
  const seat = Number(value);
  if (!Number.isSafeInteger(seat)) fail("--seat exceeds the supported worker-seat range");
  return seat;
}

function launchEnvelope(composerAssignment, seat) {
  return Object.freeze({
    schema_version: 1,
    seat_id: `seat-${seat}`,
    model_critical: true,
    reasoning_critical: false,
    attempt: 1,
    objective: "execute_composer_assignment",
    routing_reason: "composer_derived_worker_assignment",
    weaker_insufficient: "different_model_would_violate_composer_assignment",
    stronger_unnecessary: "composer_selected_lowest_reliable_model",
    composer_assignment: composerAssignment
  });
}

/**
 * Converts one fully validated private v6 worker assignment into an exact,
 * pass-verbatim native launch package. Normal callers never compose lifecycle
 * JSON, model routing metadata, or worker prompt data.
 */
export function orchestrateLaunch({ bundlePath, seat: seatValue } = {}) {
  const resolvedBundlePath = privateBundleUnderPersistenceRoot(bundlePath);
  const bundle = readPersistedBundle(resolvedBundlePath);
  if (bundle.schema_version !== 6) {
    fail("orchestrate launch requires v6; remediation: run orchestrate next without --prior-bundle, then launch the returned v6 --bundle");
  }
  if (bundle.classification.classification !== "worker_required" || !bundle.topology) {
    fail("orchestrate launch requires a worker-required bundle with topology");
  }
  const seat = workerSeat(seatValue);
  const worker = bundle.topology.workers.find((candidate) => candidate.seat === seat);
  if (!worker) fail("--seat does not identify a selected worker in this bundle");
  const sparkAvailability = bundle.model_recommendation.spark_gate.availability;
  if (["authoritatively_unavailable", "separate_pool_exhausted"].includes(sparkAvailability)) {
    fail(`Spark availability ${sparkAvailability} is Unverified; recompose with unknown_or_unexposed or provide a future supported host capability receipt`);
  }
  const promptEnvelopeDigest = sha256(canonicalJson(worker.prompt_envelope));
  const composerAssignment = Object.freeze({
    schema_version: 1,
    bundle_path: resolvedBundlePath,
    bundle_digest: bundle.bundle_digest,
    execution_id: bundle.execution_id,
    correlation_id: bundle.correlation_id,
    causation_id: bundle.causation_id,
    worker_seat: seat,
    worker_assignment_ids: worker.assignment_ids,
    worker_prompt_envelope_sha256: promptEnvelopeDigest,
    availability_evidence: UNVERIFIED,
    requested_model: worker.requested_model,
    requested_reasoning_raw: worker.requested_reasoning_raw,
    spark_gate: bundle.model_recommendation.spark_gate
  });
  const envelope = launchEnvelope(composerAssignment, seat);
  const quarantineMessage = `${MODEL_ROUTING_GATE_PREFIX}${JSON.stringify(envelope)}\n` +
    "MODEL_ROUTING_GATE_QUARANTINE_V1\nReply with exactly READY_FOR_NATIVE_ATTESTATION.";
  const assignmentCore = Object.freeze({
    schema_version: 1,
    bundle_path: resolvedBundlePath,
    bundle_digest: bundle.bundle_digest,
    execution_id: bundle.execution_id,
    correlation_id: bundle.correlation_id,
    causation_id: bundle.causation_id,
    worker_seat: seat,
    worker_assignment_ids: worker.assignment_ids,
    worker_prompt_envelope_sha256: promptEnvelopeDigest,
    worker_prompt_envelope: worker.prompt_envelope
  });
  const assignmentBinding = sha256(canonicalJson(assignmentCore));
  const resultSentinel = `ACG_ORCHESTRATION_WORKER_RESULT:${assignmentBinding.slice("sha256:".length, "sha256:".length + 24)}`;
  const admittedMessage = `ORCHESTRATION_WORKER_ASSIGNMENT_V1 ${JSON.stringify(assignmentCore)}\n` +
    `Return only bounded assignment evidence and finish with ${resultSentinel}`;
  const launchPackageCore = Object.freeze({
    schema_version: 1,
    bundle_path: resolvedBundlePath,
    bundle_digest: bundle.bundle_digest,
    execution_id: bundle.execution_id,
    correlation_id: bundle.correlation_id,
    causation_id: bundle.causation_id,
    worker_seat: seat,
    availability_evidence: UNVERIFIED,
    native_quarantine: Object.freeze({
      attempt: 1,
      pass_spawn_request_verbatim: true,
      spawn_request: Object.freeze({
        fork_context: false,
        model: worker.requested_model,
        reasoning_effort: worker.requested_reasoning_raw,
        message: quarantineMessage
      })
    }),
    native_quarantine_instruction: "Pass native_quarantine.spawn_request verbatim, wait for its exact completed initial response, then attest before sending the admitted assignment.",
    admitted_assignment: Object.freeze({
      starts_new_turn: true,
      pass_message_verbatim: true,
      message: admittedMessage,
      worker_prompt_envelope: worker.prompt_envelope,
      required_final_sentinel: resultSentinel,
      stale_notification_rule: "Completion without the required final sentinel is inadmissible.",
      close_rule: "Close only after a result carrying the required final sentinel."
    })
  });
  const launchPackage = Object.freeze({
    ...launchPackageCore,
    launch_package_digest: sha256(canonicalJson(launchPackageCore))
  });
  const launchPackagePath = writePrivateLaunchPackage(resolvedBundlePath, seat, launchPackage);
  return Object.freeze({
    launch_package_path: launchPackagePath,
    ...launchPackage
  });
}
