import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acknowledgeDelivery,
  activateRelease,
  addMachineProjectRoot,
  bundleDigest,
  canonicalJson,
  classifyVersionBump,
  compareSystemVersions,
  codeRoot,
  configureApprovalMode,
  configureAgentSystemProfile,
  deliverResolvedPolicy,
  readAgentSystemProfile,
  recordLocalAgentSystemIssue,
  removeMachineProjectRoot,
  receiptDigest,
  readJson,
  resolveRoute,
  runAuditWorkflow,
  sha256,
  parseSystemVersion,
  verifyRelease,
  validateReleaseVersionTransition
} from "../lib/core.mjs";

const policyRoot = path.join(codeRoot, "governance");

function makeActivationRelease(root, options = {}) {
  const source = path.join(root, "source");
  const release = path.join(source, ".runtime", "releases", ".staging");
  fs.mkdirSync(path.join(release, "policies"), { recursive: true });
  fs.copyFileSync(path.join(codeRoot, "governance", "kernel", "AGENTS.md"), path.join(release, "AGENTS.md"));
  for (const name of ["modules", "schemas", "profiles"]) fs.cpSync(path.join(codeRoot, "governance", name), path.join(release, "policies", name), { recursive: true });
  for (const name of ["manifest.json", "policy.lock.json"]) fs.copyFileSync(path.join(codeRoot, "governance", name), path.join(release, "policies", name));
  fs.copyFileSync(path.join(codeRoot, "governance", "overlay-targets.json"), path.join(release, "overlay-targets.json"));
  fs.cpSync(path.join(codeRoot, "skills", "govern-codex-policy"), path.join(release, "skills", "govern-codex-policy"), { recursive: true });
  fs.cpSync(path.join(codeRoot, "plugins"), path.join(release, "plugins"), { recursive: true });
  const digest = bundleDigest(release);
  const lock = readJson(path.join(codeRoot, "governance", "policy.lock.json"));
  const version = {
    system_version: options.systemVersion ?? "3.0.0-rc.1",
    previous_system_version: options.previousSystemVersion ?? "2.2.2",
    version_bump: options.versionBump ?? "major",
    ...(options.omitDisplayChannel ? {} : { display_channel: "RC-3.0" }),
    bundled_source_plugins: ["jit-orchestration-governor", "model-routing-gate"],
    host_plugin_activation: "Unverified"
  };
  const payload = { schema_version: 1, manifest: lock.manifest, ...version, source_commit: "0".repeat(40), source_branch: "main", source_remote_commit: "0".repeat(40), remote_verified_at: "2026-07-28T00:00:00.000Z", bundle_sha256: `sha256:${digest.sha256}`, files: digest.records, integrity_claim: "tamper_detection_not_tamper_prevention", activation_scope: ["filesystem"], new_context_activation: "requires_fresh_context_acknowledgment", existing_context_activation: "Unverified" };
  const contentSha = sha256(canonicalJson(payload));
  const releaseId = `v1-${contentSha.slice(0, 16)}`;
  fs.writeFileSync(path.join(release, "release.json"), `${JSON.stringify({ release_id: releaseId, content_sha256: `sha256:${contentSha}`, ...payload }, null, 2)}\n`);
  fs.renameSync(release, path.join(source, ".runtime", "releases", releaseId));
  return { source, releaseId };
}

test("semantic version changes are classified", () => {
  assert.equal(classifyVersionBump("1.0.0", "1.0.1"), "patch");
  assert.equal(classifyVersionBump("1.0.0", "1.1.0"), "minor");
  assert.equal(classifyVersionBump("1.0.0", "2.0.0"), "major");
  assert.equal(classifyVersionBump("1.0.0", "1.0.0"), "none");
  assert.equal(classifyVersionBump("2.2.2", "3.0.0-rc.1"), "major");
  assert.equal(classifyVersionBump("3.0.0-rc.1", "3.0.0-rc.2"), "prerelease");
  assert.equal(classifyVersionBump("3.0.0-rc.1", "3.0.0"), "stable");
  assert.equal(compareSystemVersions("3.0.0-rc.10", "3.0.0-rc.2"), 1);
  assert.throws(() => classifyVersionBump("3.0.0", "3.0.0-rc.2"), /cannot decrease/);
  assert.throws(() => classifyVersionBump("3.0.0-rc.2", "3.0.0-rc.1"), /cannot decrease/);
});

test("RC-3 public compatibility matrix retains diagnostic interfaces until major 4", () => {
  const matrix = fs.readFileSync(path.join(codeRoot, "docs", "compatibility.md"), "utf8");
  for (const name of ["acg orchestrate next", "acg orchestrate verify", "seat inspect", "metrics report", "handoff verify", "profile agent-system", "profile add-root", "profile remove-root", "route", "deliver", "acknowledge"]) {
    assert.equal(matrix.includes(`\`${name}\``), true, name);
  }
  assert.match(matrix, /major 3 \| major 4/);
  assert.match(matrix, /host hook enforcement/);
  assert.match(matrix, /Unverified/);
});

test("system versions use strict SemVer prerelease syntax", () => {
  assert.deepEqual(parseSystemVersion("3.0.0-rc.1+build.7").prerelease, ["rc", "1"]);
  for (const invalid of ["3.0", "03.0.0", "3.0.0-", "3.0.0-rc.01", "3.0.0-rc..1", "3.0.0+"]) {
    assert.throws(() => parseSystemVersion(invalid), /Invalid governance system version/);
  }
});

test("RC-3 release metadata verifies channel and bundled plugin provenance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-rc3-release-"));
  const valid = makeActivationRelease(path.join(root, "valid"));
  const metadata = verifyRelease(path.join(valid.source, ".runtime", "releases", valid.releaseId));
  assert.equal(metadata.display_channel, "RC-3.0");
  assert.deepEqual(metadata.bundled_source_plugins, ["jit-orchestration-governor", "model-routing-gate"]);
  assert.equal(metadata.host_plugin_activation, "Unverified");

  const stable = makeActivationRelease(path.join(root, "stable"), {
    systemVersion: "3.0.0",
    previousSystemVersion: "3.0.0-rc.1",
    versionBump: "stable"
  });
  assert.equal(
    verifyRelease(path.join(stable.source, ".runtime", "releases", stable.releaseId)).version_bump,
    "stable"
  );

  const missingChannel = makeActivationRelease(path.join(root, "missing-channel"), { omitDisplayChannel: true });
  assert.throws(
    () => verifyRelease(path.join(missingChannel.source, ".runtime", "releases", missingChannel.releaseId)),
    /omits the display channel/
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("release transition requires both content and version change", () => {
  assert.throws(
    () => validateReleaseVersionTransition({
      previousVersion: "1.0.0",
      nextVersion: "1.0.0",
      previousBundleSha256: "sha256:old",
      nextBundleSha256: "sha256:new"
    }),
    /without a system-version advance/
  );
  assert.throws(
    () => validateReleaseVersionTransition({
      previousVersion: "1.0.0",
      nextVersion: "1.1.0",
      previousBundleSha256: "sha256:same",
      nextBundleSha256: "sha256:same"
    }),
    /without a bundled governance change/
  );
  assert.equal(
    validateReleaseVersionTransition({
      previousVersion: "1.0.0",
      nextVersion: "1.1.0",
      previousBundleSha256: "sha256:old",
      nextBundleSha256: "sha256:new"
    }).version_bump,
    "minor"
  );
});

test("high-level audit owns one policy lifecycle", () => {
  const result = runAuditWorkflow({ project: "ai-codex-governance", path: codeRoot }, policyRoot);
  assert.equal(result.audit_ready, true);
  assert.equal(result.routing.lifecycle_calls, 1);
  assert.ok(result.active_modules.some((module) => module.id === "deep-audit"));
  assert.ok(result.delivered_modules.length > 0);
  for (const module of result.delivered_modules) {
    assert.equal(typeof module.content, "string");
    assert.equal(`sha256:${sha256(Buffer.from(module.content))}`, module.digest);
  }
  assert.match(result.completion_sentinel, /^ACG_AUDIT_READY:[0-9a-f]{16}$/);
});

test("legacy intent is retained in compact canonical owners", () => {
  const kernel = fs.readFileSync(path.join(policyRoot, "kernel", "AGENTS.md"), "utf8");
  const findings = fs.readFileSync(path.join(policyRoot, "modules", "findings.md"), "utf8");
  const release = fs.readFileSync(path.join(policyRoot, "modules", "release.md"), "utf8");
  assert.match(kernel, /fix the in-scope failure class/);
  assert.match(kernel, /decision-grade depth/);
  assert.match(kernel, /approval_mode/);
  assert.match(kernel, /approve_for_me/);
  assert.match(findings, /Developer Experience/);
  assert.match(release, /canonical semantic version/);
  assert.match(release, /changed bundled governance without a system-version advance/);
});

test("public onboarding stays portable and private data is ignored", () => {
  const readme = fs.readFileSync(path.join(codeRoot, "README.md"), "utf8");
  const ignore = fs.readFileSync(path.join(codeRoot, ".gitignore"), "utf8");
  const profile = JSON.parse(fs.readFileSync(path.join(codeRoot, "fixtures", "machine-profile.example.json"), "utf8"));
  assert.match(readme, /unofficial community project/i);
  assert.match(readme, /Agent Setup Protocol/);
  assert.match(readme, /governance-machine-profile\.json/);
  assert.match(readme, /Do not load all policy modules/);
  assert.match(readme, /approve_for_me/);
  assert.match(readme, /Normal feature pull requests target `beta`, not `main`/);
  assert.match(readme, /CI runs on pull\s+requests into `beta` and on pushes to both `beta` and `main`/);
  assert.match(readme, /Public beta candidates normally soak until Friday/);
  assert.match(readme, /does not create an automatic scheduler/);
  assert.equal(profile.approval_mode, "ask");
  for (const privatePath of ["governance/legacy/", "governance/organizations/", "governance/overlays/"]) {
    assert.match(ignore, new RegExp(privatePath.replaceAll("/", "\\/")));
  }
});

test("delegation mode exposes an advisory context target without mutation authority", () => {
  const policyRoot = path.join(codeRoot, "governance");
  const result = resolveRoute({
    mode: "delegation",
    phase: "delegation",
    project: "ai-codex-governance",
    operations: ["launch_subagent"],
    tools: ["subagent"],
    paths: [codeRoot],
    risk_tags: [],
    authorities: ["delegation"],
    mutation_authority: false,
    runtime_capabilities: { filesystem_read: true, thread_coordination: true }
  }, policyRoot);

  assert.equal(result.policy_context_target, 16000);
  assert.equal(result.policy_context_enforcement, "advisory_only");
  assert.equal(result.rollover_required, false);
  assert.equal(result.authorization_decision.grants.includes("filesystem_mutation"), false);
});

test("audit preserves prior context accounting and rejects a stale ledger", () => {
  const policyRoot = path.join(codeRoot, "governance");
  const route = resolveRoute({
    mode: "read_only",
    phase: "planning",
    project: "ai-codex-governance",
    operations: ["plan"],
    tools: ["filesystem_read"],
    paths: [codeRoot],
    risk_tags: [],
    mutation_authority: false,
    runtime_capabilities: { filesystem_read: true }
  }, policyRoot);
  const delivery = deliverResolvedPolicy(route, policyRoot);
  const acknowledgment = acknowledgeDelivery(delivery, policyRoot);
  const prior = acknowledgment.context_acknowledgment;
  const result = runAuditWorkflow({
    project: "ai-codex-governance",
    path: codeRoot,
    priorReceipt: prior
  }, policyRoot);

  assert.equal(result.context_acknowledgment.receipt_type, "context_acknowledgment");
  assert.ok(result.context_acknowledgment.accumulated_policy_tokens >= prior.accumulated_policy_tokens);

  const stale = structuredClone(prior);
  stale.context_ledger["govern-codex-policy"].digest = `sha256:${"0".repeat(64)}`;
  stale.receipt_sha256 = receiptDigest(stale);
  assert.throws(
    () => runAuditWorkflow({ project: "ai-codex-governance", path: codeRoot, priorReceipt: stale }, policyRoot),
    /Context ledger differs for govern-codex-policy/
  );
});

test("machine profile bootstrap is explicit, idempotent, and private", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acg-profile-"));
  const profileFile = path.join(temporaryRoot, "machine-profile.json");
  const projectRoot = path.join(temporaryRoot, "project");
  const nestedRoot = path.join(projectRoot, "nested");
  const memoryPath = path.join(temporaryRoot, "agent-system.md");
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(nestedRoot);
  fs.writeFileSync(memoryPath, "# Agent System\n");

  assert.throws(
    () => addMachineProjectRoot({ project: "example", path: projectRoot }, profileFile),
    /authorize-profile-write|profile write/i
  );
  assert.equal(addMachineProjectRoot({
    project: "example",
    path: projectRoot,
    authorizeProfileWrite: true
  }, profileFile).changed, true);
  assert.equal(addMachineProjectRoot({
    project: "example",
    path: projectRoot,
    authorizeProfileWrite: true
  }, profileFile).changed, false);
  assert.equal(addMachineProjectRoot({
    project: "example",
    path: nestedRoot,
    authorizeProfileWrite: true
  }, profileFile).changed, true);
  assert.throws(
    () => removeMachineProjectRoot({ project: "example", path: nestedRoot }, profileFile),
    /authorize-profile-write|profile write/i
  );
  assert.equal(removeMachineProjectRoot({
    project: "example",
    path: nestedRoot,
    authorizeProfileWrite: true
  }, profileFile).changed, true);
  const retainedRoots = JSON.parse(fs.readFileSync(profileFile, "utf8")).project_roots.example;
  assert.deepEqual(retainedRoots, [fs.realpathSync(projectRoot)]);
  assert.equal(removeMachineProjectRoot({
    project: "example",
    path: nestedRoot,
    authorizeProfileWrite: true
  }, profileFile).changed, false);
  assert.throws(
    () => configureApprovalMode({ mode: "approve_for_me" }, profileFile),
    /authorize-profile-write|profile write/i
  );
  assert.throws(
    () => configureApprovalMode({ mode: "unsupported", authorizeProfileWrite: true }, profileFile),
    /Approval mode is invalid/
  );
  assert.equal(configureApprovalMode({
    mode: "approve_for_me",
    authorizeProfileWrite: true
  }, profileFile).changed, true);
  assert.equal(configureApprovalMode({
    mode: "approve_for_me",
    authorizeProfileWrite: true
  }, profileFile).changed, false);
  assert.equal(JSON.parse(fs.readFileSync(profileFile, "utf8")).approval_mode, "approve_for_me");

  configureAgentSystemProfile({
    label: "Agent System",
    memoryPath,
    persistentTask: true,
    automaticDefectReport: true,
    reportedDefectAction: "log_only",
    acknowledgeTokenCost: true,
    authorizeProfileWrite: true
  }, profileFile);
  const profile = readAgentSystemProfile(profileFile);
  assert.equal(profile.agent_system.label, "Agent System");
  assert.equal(profile.agent_system.match_field, "title");
  assert.equal(profile.agent_system.match_mode, "exact_non_archived");
  assert.equal(profile.legacy_thread_id_ignored, false);
  assert.equal(Object.hasOwn(profile.agent_system, "thread_id"), false);
  assert.equal(profile.agent_system.memory_path, fs.realpathSync(memoryPath));
  assert.equal(profile.agent_system.auto_create, true);
  assert.equal(profile.agent_system.auto_report, true);
  assert.equal(profile.consent.source, "explicit");
  assert.equal(profile.consent.automatic_defect_reports, "granted");
  assert.equal(profile.consent.reported_defect_action, "log_only");
  assert.equal(profile.consent.token_cost_acknowledged, true);
  assert.equal(fs.statSync(profileFile).mode & 0o777, 0o600);
  assert.equal(profile.reporting_contract.automatic_reporting_enabled, true);
  assert.equal(profile.reporting_contract.automatic_kpi_reporting_enabled, false);
  assert.equal(profile.reporting_contract.disposition.repair_authorization, "none");
  assert.match(profile.reporting_contract.disposition.continuation, /without_waiting_for_agent_system/);
  assert.match(profile.reporting_contract.caller_action, /exact_non_archived_label_match/);
  assert.equal(profile.reporting_contract.target_lookup.label, "Agent System");
  assert.equal(profile.reporting_contract.target_lookup.runtime_field, "title");
  assert.equal(profile.reporting_contract.target_lookup.candidate_filter, "non_archived");
  assert.equal(profile.reporting_contract.target_lookup.singleton_rule, "exactly_one_non_archived_canonical_label");
  assert.match(profile.reporting_contract.target_lookup.multiple_matches, /continue_safe_in_scope_project_work/);
  assert.equal(profile.reporting_contract.target_lookup.thread_id_semantics, "ephemeral_delivery_handle_returned_by_runtime_lookup_only");
  assert.equal(profile.reporting_contract.target_lookup.replacement_workflow.stage_new_title, "Agent System - Incoming");
  assert.equal(profile.reporting_contract.target_lookup.replacement_workflow.rename_previous_title_prefix, "Agent System - Old");
  assert.equal(profile.reporting_contract.target_lookup.replacement_workflow.unpin_previous_task, true);
  assert.equal(profile.reporting_contract.target_lookup.replacement_workflow.pin_replacement_task, true);
  assert.equal(profile.reporting_contract.target_lookup.replacement_workflow.verify_exact_non_archived_match_count, 1);
  assert.match(profile.reporting_contract.target_lookup.replacement_workflow.pinned_ordering, /unverified/);
  assert.equal(profile.reporting_contract.local_cli_transport, "agent-system record-issue --delivery-unavailable");
  assert.equal(profile.reporting_contract.delivery_unavailable.flag, "agent_system_delivery_unavailable");
  assert.equal(profile.reporting_contract.delivery_unavailable.disposition, "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work");
  assert.equal(profile.reporting_contract.persistent_task_creation.attempt_limit, 1);
  assert.equal(profile.reporting_contract.persistent_task_creation.exact_label, "Agent System");
  assert.equal(profile.reporting_contract.host_interception, "Unverified");
  assert.match(profile.reporting_contract.enforcement, /caller_required/);

  const legacyProfile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
  legacyProfile.agent_system = {
    title: "Agent System",
    thread_id: "00000000-0000-4000-8000-000000000000",
    memory_path: fs.realpathSync(memoryPath),
    auto_create: true,
    auto_report: true
  };
  fs.writeFileSync(profileFile, `${JSON.stringify(legacyProfile, null, 2)}\n`);
  const legacyRead = readAgentSystemProfile(profileFile);
  assert.equal(legacyRead.agent_system.label, "Agent System");
  assert.equal(legacyRead.legacy_thread_id_ignored, true);
  assert.equal(legacyRead.consent.persistent_task, "granted");
  assert.equal(Object.hasOwn(legacyRead.agent_system, "thread_id"), false);
  assert.equal(legacyRead.reporting_contract.target_lookup.current_task_rule, "resolve_at_delivery_time");

  const legacyNoCreateProfile = structuredClone(legacyProfile);
  legacyNoCreateProfile.agent_system.auto_create = false;
  legacyNoCreateProfile.agent_system.auto_report = true;
  fs.writeFileSync(profileFile, `${JSON.stringify(legacyNoCreateProfile, null, 2)}\n`);
  const legacyNoCreate = readAgentSystemProfile(profileFile);
  assert.equal(legacyNoCreate.consent.persistent_task, "granted");
  assert.equal(legacyNoCreate.consent.automatic_defect_reports, "granted");
  assert.equal(legacyNoCreate.consent.reported_defect_action, "log_only");
  assert.equal(legacyNoCreate.consent.migration, "legacy_automatic_report_migrated_to_log_only");
  assert.equal(legacyNoCreate.reporting_contract.mode, "active");
  assert.equal(legacyNoCreate.reporting_contract.target_lookup.label, "Agent System");
  assert.equal(legacyNoCreate.reporting_contract.target_lookup.no_match, "record_private_delivery_unavailable_and_continue_safe_in_scope_project_work");

  const legacyConsentProfile = structuredClone(legacyProfile);
  legacyConsentProfile.agent_system.consent = {
    persistent_task: "granted",
    automatic_reports: "granted",
    reported_defect_action: "auto_correct",
    token_cost_acknowledged: true
  };
  fs.writeFileSync(profileFile, `${JSON.stringify(legacyConsentProfile, null, 2)}\n`);
  const legacyConsent = readAgentSystemProfile(profileFile);
  assert.equal(legacyConsent.consent.source, "legacy_consent_migrated");
  assert.equal(legacyConsent.consent.reported_defect_action, "log_only");
  assert.equal(legacyConsent.reporting_contract.disposition.repair_authorization, "none");

  const contradictoryConsentProfile = structuredClone(legacyProfile);
  contradictoryConsentProfile.agent_system.consent = {
    persistent_task: "declined",
    automatic_defect_reports: "granted",
    reported_defect_action: "log_only",
    token_cost_acknowledged: true
  };
  fs.writeFileSync(profileFile, `${JSON.stringify(contradictoryConsentProfile, null, 2)}\n`);
  assert.throws(
    () => readAgentSystemProfile(profileFile),
    /Automatic defect reports require persistent Agent System task consent/
  );

  const invalidLegacyProfile = structuredClone(legacyProfile);
  invalidLegacyProfile.agent_system.title = " Agent System ";
  fs.writeFileSync(profileFile, `${JSON.stringify(invalidLegacyProfile, null, 2)}\n`);
  assert.throws(
    () => readAgentSystemProfile(profileFile),
    /label must be 1-80 trimmed characters/
  );
  fs.writeFileSync(profileFile, `${JSON.stringify(legacyProfile, null, 2)}\n`);

  const legacyWrite = configureAgentSystemProfile({
    label: "Agent System",
    threadId: "00000000-0000-4000-8000-000000000000",
    memoryPath,
    persistentTask: true,
    automaticDefectReport: true,
    reportedDefectAction: "auto_correct",
    acknowledgeTokenCost: true,
    authorizeProfileWrite: true
  }, profileFile);
  assert.equal(legacyWrite.provided_thread_id_ignored, true);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(profileFile, "utf8")).agent_system, "thread_id"), false);
  assert.throws(
    () => configureAgentSystemProfile({
      label: " Agent System ",
      memoryPath,
      persistentTask: true,
      automaticDefectReport: false,
      acknowledgeTokenCost: true,
      authorizeProfileWrite: true
    }, profileFile),
    /label must be 1-80 trimmed characters/
  );

  const cli = path.join(codeRoot, "bin", "acg.mjs");
  const cliEnvironment = { ...process.env, ACG_MACHINE_PROFILE: profileFile };
  const cliWrite = JSON.parse(execFileSync(process.execPath, [
    cli,
    "profile",
    "agent-system",
    "--label",
    "Agent System Current",
    "--memory",
    memoryPath,
    "--persistent-task",
    "yes",
    "--automatic-defect-report",
    "yes",
    "--reported-defect-action",
    "log_only",
    "--acknowledge-agent-system-token-cost",
    "--authorize-profile-write"
  ], { encoding: "utf8", env: cliEnvironment }));
  assert.equal(cliWrite.agent_system.label, "Agent System Current");
  assert.equal(cliWrite.provided_thread_id_ignored, false);
  assert.equal(Object.hasOwn(cliWrite.agent_system, "thread_id"), false);

  const cliRead = JSON.parse(execFileSync(process.execPath, [
    cli,
    "profile",
    "agent-system"
  ], { encoding: "utf8", env: cliEnvironment }));
  assert.equal(cliRead.reporting_contract.target_lookup.label, "Agent System Current");
  assert.equal(cliRead.reporting_contract.target_lookup.current_task_rule, "resolve_at_delivery_time");

  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("Agent System requires explicit consent and records inactive issues privately", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acg-agent-system-consent-"));
  const profileFile = path.join(temporaryRoot, "machine-profile.json");
  const inactive = readAgentSystemProfile(profileFile);
  assert.equal(inactive.configured, false);
  assert.equal(inactive.consent.decision_required, true);
  assert.equal(inactive.consent.persistent_task, "undecided");
  assert.equal(inactive.reporting_contract.mode, "inactive_local_only");
  assert.equal(inactive.reporting_contract.runtime_task_message_action, null);
  assert.equal(inactive.reporting_contract.target_lookup, null);
  assert.equal(inactive.reporting_contract.local_cli_transport, "agent-system record-issue");
  assert.match(inactive.reporting_contract.caller_action, /do not list, create, wake, or message any task/);

  fs.writeFileSync(profileFile, `${JSON.stringify({
    schema_version: 1,
    agent_system: {
      label: "Agent System",
      auto_create: false,
      auto_report: true,
      consent: {
        persistent_task: "declined",
        automatic_defect_reports: "declined",
        reported_defect_action: null,
        token_cost_acknowledged: true
      }
    }
  }, null, 2)}\n`);
  const declined = readAgentSystemProfile(profileFile);
  assert.equal(declined.reporting_contract.mode, "inactive_local_only");
  assert.equal(declined.reporting_contract.automatic_reporting_enabled, false);
  assert.equal(recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-declined", severity: "P3", summary: "declined reporting stays local" }, profileFile).recorded, true);
  fs.rmSync(path.join(temporaryRoot, "agent-system-local-issues.jsonl"));

  const record = recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-1", severity: "P2", summary: "Bounded local issue with token cost" }, profileFile);
  assert.equal(record.recorded, true);
  assert.equal(record.deduplicated, false);
  assert.equal(fs.statSync(record.local_ledger).mode & 0o777, 0o600);
  const rows = fs.readFileSync(record.local_ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, "Bounded local issue with token cost");
  assert.match(rows[0].event_id, /^[0-9a-f-]{36}$/);
  assert.equal(rows[0].project, "governance");
  assert.equal(rows[0].issue_id, "OPT-IN-1");
  assert.equal(rows[0].severity, "P2");
  assert.equal(Object.hasOwn(record, "runtime_task_message_action"), false);
  const duplicate = recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-1", severity: "P2", summary: "Bounded local issue with token cost" }, profileFile);
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.deduplicated, true);
  assert.throws(
    () => recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-2", severity: "P2", summary: "Bearer secret-value" }, profileFile),
    /prohibited/
  );
  assert.throws(
    () => recordLocalAgentSystemIssue({ project: "governance\nattack", issueId: "OPT-IN-3", severity: "P2", summary: "safe" }, profileFile),
    /control characters/
  );
  assert.equal(recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-phrase", severity: "P3", summary: "source root mismatch; prompt injection defense; model output redaction" }, profileFile).recorded, true);
  assert.throws(
    () => recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-raw", severity: "P2", summary: "prompt: raw untrusted content" }, profileFile),
    /prohibited raw-content/
  );
  assert.throws(
    () => recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-evidence", severity: "P2", summary: "evidence requires class", evidence: "Observed runtime condition" }, profileFile),
    /Evidence class is required/
  );

  const cli = path.join(codeRoot, "bin", "acg.mjs");
  const environment = { ...process.env, ACG_MACHINE_PROFILE: profileFile };
  const quiet = execFileSync(process.execPath, [cli, "agent-system", "record-issue", "--project", "governance", "--issue-id", "OPT-IN-4", "--severity", "P3", "--summary", "quiet local write"], { encoding: "utf8", env: environment });
  assert.equal(quiet, "");
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, authorizeProfileWrite: true }, profileFile),
    /acknowledge-agent-system-token-cost/
  );
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: false, automaticDefectReport: true, reportedDefectAction: "log_only", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile),
    /require persistent/
  );
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile),
    /requires --reported-defect-action log_only or auto_correct/
  );
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, reportedDefectAction: "log_only", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile),
    /only allowed when automatic defect reporting is enabled/
  );
  const autoCorrect = configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, reportedDefectAction: "auto_correct", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  assert.equal(autoCorrect.reporting_contract.disposition.repair_authorization, "bounded_private_agent_system_repair_only");
  assert.deepEqual(autoCorrect.reporting_contract.disposition.prohibited, ["reporting_project_mutation", "public_publication", "destructive_operation", "architecture_change", "schedules", "automatic_kpi_reporting"]);
  const activeNoReport = configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  assert.equal(activeNoReport.agent_system.memory_path, null);
  assert.equal(activeNoReport.reporting_contract.mode, "active_without_automatic_reports");
  assert.equal(activeNoReport.reporting_contract.target_lookup, null);
  assert.equal(activeNoReport.reporting_contract.local_cli_transport, "agent-system record-issue");
  assert.equal(recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-5", severity: "P4", summary: "active local record" }, profileFile).recorded, true);
  configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, reportedDefectAction: "log_only", memoryPath: path.join(codeRoot, "README.md"), acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  assert.equal(readAgentSystemProfile(profileFile).reporting_contract.local_cli_transport, "agent-system record-issue --delivery-unavailable");
  const fallback = recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-6-fallback", severity: "P1", summary: "task delivery unavailable", deliveryUnavailable: true }, profileFile);
  assert.equal(fallback.mode, "delivery_unavailable_local_fallback");
  assert.equal(fallback.delivery_unavailable, true);
  assert.equal(fallback.disposition, "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work");
  assert.throws(
    () => recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-6", severity: "P1", summary: "automatic mode must reject" }, profileFile),
    /automatic reporting/
  );
  assert.throws(
    () => execFileSync(process.execPath, [cli, "profile", "agent-system", "--persistent-task", "maybe"], { encoding: "utf8", env: environment }),
    /persistent-task must be yes or no/
  );
  assert.throws(
    () => execFileSync(process.execPath, [cli, "profile", "agent-system", "--automatic-defect-report", "maybe"], { encoding: "utf8", env: environment }),
    /automatic-defect-report must be yes or no/
  );
  for (const deprecatedFlag of ["--automatic-report", "--auto-create", "--auto-report"]) {
    assert.throws(
      () => execFileSync(process.execPath, [cli, "profile", "agent-system", deprecatedFlag], { encoding: "utf8", env: environment }),
      /deprecated; use --persistent-task yes\|no and --automatic-defect-report yes\|no/
    );
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("activation surfaces current machine-profile consent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-activation-consent-"));
  const home = path.join(root, "home");
  const profileFile = path.join(root, "explicit-profile.json");
  const { source, releaseId } = makeActivationRelease(root);
  const previousProfile = process.env.ACG_MACHINE_PROFILE;
  process.env.ACG_MACHINE_PROFILE = profileFile;
  try {
    const undecided = activateRelease(source, releaseId, home);
    assert.equal(undecided.agent_system_activation.status, "decision_required");
    assert.equal(undecided.agent_system_activation.mode, "inactive_local_only");
    configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
    const configured = activateRelease(source, releaseId, home);
    assert.equal(configured.agent_system_activation.status, "configured");
    assert.equal(configured.agent_system_activation.mode, "active_without_automatic_reports");
  } finally {
    if (previousProfile === undefined) delete process.env.ACG_MACHINE_PROFILE;
    else process.env.ACG_MACHINE_PROFILE = previousProfile;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rejects unknown options instead of silently discarding context", () => {
  assert.throws(
    () => execFileSync(process.execPath, [path.join(codeRoot, "bin", "acg.mjs"), "audit", "--unknown-option"], {
      cwd: codeRoot,
      encoding: "utf8"
    }),
    /Unknown option: --unknown-option/
  );
});
