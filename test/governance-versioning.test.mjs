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
  fs.mkdirSync(path.join(release, ".agents", "plugins"), { recursive: true });
  fs.copyFileSync(path.join(codeRoot, ".agents", "plugins", "marketplace.json"), path.join(release, ".agents", "plugins", "marketplace.json"));
  const digest = bundleDigest(release);
  const lock = readJson(path.join(codeRoot, "governance", "policy.lock.json"));
  const version = {
    system_version: options.systemVersion ?? "3.0.0-rc.1",
    previous_system_version: options.previousSystemVersion ?? "2.2.2",
    version_bump: options.versionBump ?? "major",
    ...(options.omitDisplayChannel ? {} : { display_channel: "RC-3.0" }),
    bundled_source_plugins: ["jit-orchestration-governor", "model-routing-gate"],
    mandatory_bundled_plugins: ["jit-orchestration-governor", "model-routing-gate"],
    host_plugin_activation: "Unverified"
  };
  const payload = { schema_version: 1, manifest: lock.manifest, ...version, source_commit: "0".repeat(40), source_branch: "main", source_remote_commit: "0".repeat(40), remote_verified_at: "2026-07-28T00:00:00.000Z", bundle_sha256: `sha256:${digest.sha256}`, files: digest.records, integrity_claim: "tamper_detection_not_tamper_prevention", activation_scope: ["filesystem"], new_context_activation: "requires_fresh_context_acknowledgment", existing_context_activation: "Unverified" };
  const contentSha = sha256(canonicalJson(payload));
  const releaseId = `v1-${contentSha.slice(0, 16)}`;
  fs.writeFileSync(path.join(release, "release.json"), `${JSON.stringify({ release_id: releaseId, content_sha256: `sha256:${contentSha}`, ...payload }, null, 2)}\n`);
  fs.renameSync(release, path.join(source, ".runtime", "releases", releaseId));
  return { source, releaseId };
}

function makeFakeCodex(root) {
  const executable = path.join(root, "fake-codex.mjs");
  fs.writeFileSync(executable, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const codexHome = process.env.CODEX_HOME;
const stateFile = path.join(codexHome, "fake-codex-state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { marketplaces: {}, installed: {}, events: [] };
const args = process.argv.slice(2);
const json = (value) => process.stdout.write(JSON.stringify(value));
const persist = () => {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.writeFileSync(path.join(codexHome, "config.toml"), "fake-plugin-state\\n");
};
const marketplaceName = "ai-codex-governance";
const selector = (name) => name + "@" + marketplaceName;
state.events.push(args.join(" "));
if (args[0] !== "plugin") process.exit(2);
const command = args.slice(1);
if (command[0] === "marketplace" && command[1] === "list") {
  persist();
  json({ marketplaces: Object.entries(state.marketplaces).map(([name, root]) => ({ name, root })) });
} else if (command[0] === "marketplace" && command[1] === "add") {
  const root = command[2];
  state.marketplaces[marketplaceName] = root;
  persist();
  json({ marketplaceName, installedRoot: root, alreadyAdded: false });
} else if (command[0] === "marketplace" && command[1] === "remove") {
  delete state.marketplaces[command[2]];
  persist();
  json({ marketplaceName: command[2], removed: true });
} else if (command[0] === "list") {
  const marketplaceIndex = command.indexOf("--marketplace");
  const selectedMarketplace = marketplaceIndex === -1 ? null : command[marketplaceIndex + 1];
  const installed = Object.values(state.installed).filter((entry) => !selectedMarketplace || entry.marketplaceName === selectedMarketplace);
  persist();
  json({ installed, available: [] });
} else if (command[0] === "add") {
  const pluginId = command[1];
  const name = pluginId.split("@")[0];
  if (process.env.FAKE_CODEX_FAIL_PLUGIN === name) {
    persist();
    process.stderr.write("injected plugin install failure");
    process.exit(9);
  }
  const root = state.marketplaces[marketplaceName];
  state.installed[pluginId] = { pluginId, name, marketplaceName, installed: true, enabled: true, source: { path: path.join(root, "plugins", name) } };
  fs.mkdirSync(path.join(codexHome, "plugins", "cache", marketplaceName, name), { recursive: true });
  persist();
  json(state.installed[pluginId]);
} else if (command[0] === "remove") {
  delete state.installed[command[1]];
  persist();
  json({ pluginId: command[1], removed: true });
} else {
  process.stderr.write("unsupported fake command");
  process.exit(2);
}
`);
  fs.chmodSync(executable, 0o755);
  return executable;
}

function writeFakeCodexState(codexHome, state) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "fake-codex-state.json"), `${JSON.stringify(state)}\n`);
}

function makeLegacyPluginSource(root, plugin, version, author = "AI Codex Governance") {
  const source = path.join(root, "legacy-plugins", plugin);
  const manifest = readJson(path.join(codeRoot, "plugins", plugin, ".codex-plugin", "plugin.json"));
  manifest.version = version;
  manifest.author.name = author;
  fs.mkdirSync(path.join(source, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(source, ".codex-plugin", "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return source;
}

function cacheLegacyPluginSource(codexHome, marketplace, plugin, version, source, manifestVersion = version) {
  const cache = path.join(codexHome, "plugins", "cache", marketplace, plugin, version);
  fs.mkdirSync(cache, { recursive: true });
  fs.cpSync(source, cache, { recursive: true });
  const manifestFile = path.join(cache, ".codex-plugin", "plugin.json");
  const manifest = readJson(manifestFile);
  manifest.version = manifestVersion;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
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
  assert.match(kernel, /in-scope failure class, not an instance/);
  assert.match(kernel, /substantial work is decision-grade/);
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
    automaticRepair: false,
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
  assert.equal(profile.consent.automatic_repair, "declined");
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
  assert.equal(profile.reporting_contract.local_cli_transport, "agent-system record-issue");
  assert.equal(profile.reporting_contract.delivery_unavailable.flag, "agent_system_delivery_unavailable");
  assert.equal(profile.reporting_contract.delivery_unavailable.disposition, "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work");
  assert.equal(profile.reporting_contract.persistent_task_creation.attempt_limit, 1);
  assert.equal(profile.reporting_contract.persistent_task_creation.exact_label, "Agent System");
  assert.equal(profile.reporting_contract.host_interception, "Unverified");
  assert.match(profile.reporting_contract.enforcement, /caller_required/);

  const compatibilityWrite = configureAgentSystemProfile({
    persistentTask: true,
    automaticDefectReport: true,
    reportedDefectAction: "log_only",
    acknowledgeTokenCost: true,
    authorizeProfileWrite: true
  }, profileFile);
  assert.equal(compatibilityWrite.agent_system.consent.automatic_repair, "declined");
  assert.equal(compatibilityWrite.reporting_contract.automatic_repair_enabled, false);

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
  assert.equal(legacyNoCreate.consent.migration, "legacy_automatic_report_migrated_to_log_only_and_repair_declined");
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
  assert.equal(legacyConsent.consent.automatic_repair, "declined");
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
    automaticRepair: true,
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
      automaticRepair: false,
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
    "--automatic-repair",
    "no",
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

  const compatibleCliWrite = JSON.parse(execFileSync(process.execPath, [
    cli,
    "profile",
    "agent-system",
    "--persistent-task",
    "yes",
    "--automatic-defect-report",
    "yes",
    "--reported-defect-action",
    "log_only",
    "--acknowledge-agent-system-token-cost",
    "--authorize-profile-write"
  ], { encoding: "utf8", env: cliEnvironment }));
  assert.equal(compatibleCliWrite.agent_system.consent.automatic_repair, "declined");

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
  assert.equal(duplicate.recorded, true);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.event_type, "repeat");
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
  const cliRecord = JSON.parse(execFileSync(process.execPath, [cli, "agent-system", "record-issue", "--project", "governance", "--issue-id", "OPT-IN-4", "--failure-class", "cli-record-issue", "--category", "expected_fail_closed", "--severity", "P3", "--summary", "quiet local write"], { encoding: "utf8", env: environment }));
  assert.equal(cliRecord.recorded, true);
  assert.equal(cliRecord.category, "expected_fail_closed");
  assert.equal(cliRecord.report_eligibility.cross_task_delivery_eligible, false);
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, automaticRepair: false, authorizeProfileWrite: true }, profileFile),
    /acknowledge-agent-system-token-cost/
  );
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: false, automaticDefectReport: true, automaticRepair: false, reportedDefectAction: "log_only", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile),
    /require persistent/
  );
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, automaticRepair: false, acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile),
    /requires --reported-defect-action log_only or auto_correct/
  );
  assert.throws(
    () => configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, automaticRepair: false, reportedDefectAction: "log_only", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile),
    /only allowed when automatic defect reporting is enabled/
  );
  const autoCorrectWithoutRepair = configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, automaticRepair: false, reportedDefectAction: "auto_correct", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  assert.equal(autoCorrectWithoutRepair.reporting_contract.automatic_repair_enabled, false);
  assert.equal(autoCorrectWithoutRepair.reporting_contract.disposition.repair_authorization, "none");
  const autoCorrect = configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, automaticRepair: true, reportedDefectAction: "auto_correct", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  assert.equal(autoCorrect.reporting_contract.automatic_repair_enabled, true);
  assert.equal(autoCorrect.reporting_contract.disposition.repair_authorization, "bounded_private_agent_system_repair_only");
  assert.deepEqual(autoCorrect.reporting_contract.disposition.prohibited, ["reporting_project_mutation", "public_publication", "destructive_operation", "architecture_change", "schedules", "automatic_kpi_reporting"]);
  const activeNoReport = configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, automaticRepair: false, acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  assert.equal(activeNoReport.agent_system.memory_path, null);
  assert.equal(activeNoReport.reporting_contract.mode, "active_without_automatic_reports");
  assert.equal(activeNoReport.reporting_contract.target_lookup, null);
  assert.equal(activeNoReport.reporting_contract.local_cli_transport, "agent-system record-issue");
  assert.equal(recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-5", severity: "P4", summary: "active local record" }, profileFile).recorded, true);
  configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, automaticRepair: false, reportedDefectAction: "log_only", memoryPath: path.join(codeRoot, "README.md"), acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  assert.equal(readAgentSystemProfile(profileFile).reporting_contract.local_cli_transport, "agent-system record-issue");
  const fallback = recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-6-fallback", failureClass: "task-delivery-unavailable", category: "host_runtime", severity: "P1", summary: "task delivery unavailable", deliveryUnavailable: true }, profileFile);
  assert.equal(fallback.mode, "delivery_unavailable_local_fallback");
  assert.equal(fallback.delivery_unavailable, true);
  assert.equal(fallback.disposition, "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work");
  const automaticRecord = recordLocalAgentSystemIssue({ project: "governance", issueId: "OPT-IN-6", severity: "P1", summary: "automatic mode still records locally" }, profileFile);
  assert.equal(automaticRecord.recorded, true);
  assert.equal(automaticRecord.report_eligibility.cross_task_delivery_eligible, false);
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
      /deprecated; use --persistent-task yes\|no --automatic-defect-report yes\|no --automatic-repair yes\|no/
    );
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("Agent System incident stream is append-only and reports only eligible root causes", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acg-agent-system-incidents-"));
  const profileFile = path.join(temporaryRoot, "machine-profile.json");
  configureAgentSystemProfile({
    persistentTask: true,
    automaticDefectReport: true,
    automaticRepair: true,
    reportedDefectAction: "auto_correct",
    acknowledgeTokenCost: true,
    authorizeProfileWrite: true
  }, profileFile);

  const bazel = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-BAZEL-LOCK",
    failureClass: "bazel.module-bazel-lock-dirty",
    category: "project_tool_side_effect",
    severity: "P2",
    summary: "Bazel dirtied MODULE.bazel.lock",
    evidenceClass: "Observed",
    evidence: "Bazel changed the project lockfile during validation"
  }, profileFile);
  assert.equal(bazel.event_type, "new_class");
  assert.equal(bazel.report_eligibility.cross_task_delivery_eligible, false);

  const reconfirmation = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-AUTHORITY",
    failureClass: "standing-authority-reconfirmation",
    category: "worker_adherence",
    severity: "P2",
    summary: "Worker asked to reconfirm standing authority",
    evidenceClass: "Observed",
    evidence: "Standing authority was already available"
  }, profileFile);
  assert.equal(reconfirmation.report_eligibility.eligible, false);

  const routerClaim = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-ROUTER-MODE",
    failureClass: "router-mode-claim-without-exact-reproduction",
    category: "agent_system",
    severity: "P1",
    summary: "Router mode was claimed without exact reproduction",
    evidenceClass: "Unverified",
    evidence: "No exact reproduction was supplied"
  }, profileFile);
  assert.equal(routerClaim.report_eligibility.eligible, false);

  const nativeFallback = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-REMOTE-ROOT",
    failureClass: "remote-worktree-root-absent",
    category: "host_runtime",
    severity: "P1",
    summary: "Remote worktree root was absent",
    evidenceClass: "Observed",
    evidence: "Native fallback remained available",
    supportedFallback: true
  }, profileFile);
  assert.equal(nativeFallback.report_eligibility.eligible, false);

  const callerMistake = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-CALLER-SLUG",
    failureClass: "caller-project-slug",
    category: "caller_error",
    severity: "P3",
    summary: "Caller supplied an incorrect project slug"
  }, profileFile);
  const callerCorrection = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-CALLER-SLUG",
    failureClass: "caller-project-slug",
    category: "caller_error",
    severity: "P3",
    summary: "Caller slug was corrected",
    correctionOf: callerMistake.failure_class
  }, profileFile);
  assert.equal(callerCorrection.recorded, true);
  assert.equal(callerCorrection.event_type, "correction");
  assert.equal(callerCorrection.report_eligibility.eligible, false);

  const confirmed = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-CORE-GATE",
    failureClass: "agent-system-core-gate-failure",
    category: "agent_system",
    severity: "P1",
    summary: "Core Agent System gate failed",
    evidenceClass: "Observed",
    evidence: "Exact local reproduction proved the gate failure",
    coreCapability: true,
    locallyActionable: true,
    privateAgentSystemScope: true,
    repairAuthority: true,
    exclusionsComplete: true,
    supportedFallback: false
  }, profileFile);
  assert.equal(confirmed.report_eligibility.cross_task_delivery_eligible, true);
  assert.deepEqual(confirmed.report_eligibility.reasons, [
    "new_confirmed_agent_system_failure_class",
    "true_p0_p1_core_blocker_without_supported_fallback"
  ]);
  assert.equal(confirmed.auto_correction_eligibility.eligible, true);
  const repeat = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-CORE-GATE",
    failureClass: "agent-system-core-gate-failure",
    category: "agent_system",
    severity: "P2",
    summary: "Core Agent System gate failed again",
    evidenceClass: "Observed",
    evidence: "Exact local reproduction proved the gate failure",
    materialRepairEvidence: true
  }, profileFile);
  assert.equal(repeat.event_type, "repeat");
  assert.equal(repeat.report_eligibility.eligible, false);
  const addendum = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-CORE-GATE",
    failureClass: "agent-system-core-gate-failure",
    category: "agent_system",
    severity: "P2",
    summary: "Core Agent System gate repair evidence",
    evidenceClass: "Observed",
    evidence: "A second reproduction isolated the repair boundary",
    materialRepairEvidence: true
  }, profileFile);
  assert.equal(addendum.event_type, "addendum");
  assert.deepEqual(addendum.report_eligibility.reasons, ["materially_new_repair_evidence"]);
  assert.equal(addendum.report_eligibility.cross_task_delivery_eligible, true);
  assert.match(addendum.auto_correction_eligibility.caller_action, /do_not_start_automatic_repair/);

  const legacyLedger = bazel.local_ledger;
  fs.appendFileSync(legacyLedger, `${JSON.stringify({ schema_version: 1, event_id: "legacy-row", issue_id: "LEGACY-ROUTER", project: "lcfe", severity: "P1", summary: "legacy local incident" })}\n`);
  const legacyContinuation = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LEGACY-ROUTER",
    failureClass: "legacy.legacy-router",
    category: "agent_system",
    severity: "P1",
    summary: "Current observation follows a schema-1 row",
    evidenceClass: "Observed",
    evidence: "Current reproduction is bounded"
  }, profileFile);
  assert.equal(legacyContinuation.event_type, "addendum");
  assert.equal(legacyContinuation.report_eligibility.eligible, false);

  const contentionLock = fs.openSync(`${legacyLedger}.lock`, "wx", 0o600);
  const contended = recordLocalAgentSystemIssue({
    project: "lcfe",
    issueId: "LCFE-CONTENDED",
    failureClass: "concurrent-first-observation",
    category: "agent_system",
    severity: "P1",
    summary: "Concurrent first observation",
    evidenceClass: "Observed",
    evidence: "A concurrent writer owns first-observation classification"
  }, profileFile);
  fs.closeSync(contentionLock);
  fs.unlinkSync(`${legacyLedger}.lock`);
  assert.equal(contended.recorded, false);
  assert.equal(contended.contention_deferred, true);
  assert.equal(contended.report_eligibility.cross_task_delivery_eligible, false);

  const rows = fs.readFileSync(bazel.local_ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 11);
  assert.equal(rows.filter((row) => row.schema_version === 1).length, 1);
  assert.equal(rows.filter((row) => row.schema_version === 2).length, 10);
  assert.equal(rows.filter((row) => row.failure_class === "caller-project-slug").length, 2);
  assert.equal(rows.find((row) => row.event_type === "correction").report_eligibility.eligible, false);
  assert.match(rows.find((row) => row.event_type === "addendum").evidence_digest, /^sha256:[a-f0-9]{64}$/);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("Agent System incident eligibility fails closed for implicit categories, laundering, repeats, and malformed JSONL", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acg-agent-system-adversarial-"));
  const profileFile = path.join(temporaryRoot, "machine-profile.json");
  configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, automaticRepair: true, reportedDefectAction: "auto_correct", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  const verified = recordLocalAgentSystemIssue({ project: "governance", issueId: "VERIFIED-1", failureClass: "verified-agent-system-class", category: "agent_system", severity: "P2", summary: "Verified Agent System failure class", evidenceClass: "Verified", evidence: "Bounded verification reproduced the failure" }, profileFile);
  assert.equal(verified.report_eligibility.cross_task_delivery_eligible, true);
  const implicit = recordLocalAgentSystemIssue({ project: "governance", issueId: "IMPLICIT-1", failureClass: "implicit-category-class", severity: "P1", summary: "Compatibility caller omitted category", evidenceClass: "Observed", evidence: "Bounded observation exists", coreCapability: true, locallyActionable: true, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true, supportedFallback: false }, profileFile);
  assert.equal(implicit.category, null);
  assert.equal(implicit.category_explicit, false);
  assert.equal(implicit.classification_status, "unclassified_local_only");
  assert.equal(implicit.report_eligibility.cross_task_delivery_eligible, false);
  assert.equal(implicit.auto_correction_eligibility.eligible, false);
  const classified = recordLocalAgentSystemIssue({ project: "governance", issueId: "CLASSIFIED-1", failureClass: "category-laundering-class", category: "agent_system", severity: "P2", summary: "Initial root cause category", evidenceClass: "Observed", evidence: "Initial bounded evidence" }, profileFile);
  assert.throws(() => recordLocalAgentSystemIssue({ project: "governance", issueId: "CLASSIFIED-1", failureClass: "category-laundering-class", category: "caller_error", severity: "P2", summary: "Attempted category laundering" }, profileFile), /requires explicit reclassification from the current category/);
  const reclassified = recordLocalAgentSystemIssue({ project: "governance", issueId: "CLASSIFIED-1", failureClass: "category-laundering-class", category: "caller_error", reclassifiedFromCategory: "agent_system", correctionOf: classified.failure_class, severity: "P2", summary: "Corrected root cause category" }, profileFile);
  assert.equal(reclassified.event_type, "correction");
  assert.equal(reclassified.category, "caller_error");
  const followsCorrection = recordLocalAgentSystemIssue({ project: "governance", issueId: "CLASSIFIED-1", failureClass: "category-laundering-class", severity: "P2", summary: "Later entry follows corrected category" }, profileFile);
  assert.equal(followsCorrection.category, "caller_error");
  assert.equal(followsCorrection.category_explicit, false);
  assert.equal(followsCorrection.classification_status, "unclassified_inherited_local_only");
  assert.equal(followsCorrection.report_eligibility.eligible, false);

  const nonAgentRoot = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECLASSIFY-AGENT-1", failureClass: "confirmed-reclassification-class", category: "worker_adherence", severity: "P2", summary: "Initial non-Agent-System root cause", evidenceClass: "Observed", evidence: "Initial worker-adherence evidence" }, profileFile);
  const confirmedReclassification = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECLASSIFY-AGENT-1", failureClass: "confirmed-reclassification-class", category: "agent_system", reclassifiedFromCategory: "worker_adherence", correctionOf: nonAgentRoot.failure_class, severity: "P1", summary: "Evidence corrected the root cause to Agent System", evidenceClass: "Verified", evidence: "Verified evidence established the Agent System root cause", coreCapability: true, locallyActionable: true, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true, supportedFallback: false }, profileFile);
  assert.equal(confirmedReclassification.event_type, "correction");
  assert.deepEqual(confirmedReclassification.report_eligibility.reasons, ["confirmed_agent_system_reclassification"]);
  assert.equal(confirmedReclassification.report_eligibility.cross_task_delivery_eligible, true);
  assert.equal(confirmedReclassification.auto_correction_eligibility.eligible, false);
  const strictBlockerAfterReclassification = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECLASSIFY-AGENT-1", failureClass: "confirmed-reclassification-class", category: "agent_system", severity: "P1", summary: "Current entry satisfies strict blocker predicates", evidenceClass: "Verified", evidence: "Current blocker evidence is bounded", coreCapability: true, locallyActionable: true, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true, supportedFallback: false }, profileFile);
  assert.deepEqual(strictBlockerAfterReclassification.report_eligibility.reasons, ["true_p0_p1_core_blocker_without_supported_fallback"]);
  assert.equal(strictBlockerAfterReclassification.auto_correction_eligibility.eligible, true);
  const strictBlockerRepeat = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECLASSIFY-AGENT-1", failureClass: "confirmed-reclassification-class", category: "agent_system", severity: "P1", summary: "Strict blocker repeated", evidenceClass: "Verified", evidence: "Current blocker evidence is bounded", coreCapability: true, locallyActionable: true, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true, supportedFallback: false }, profileFile);
  assert.equal(strictBlockerRepeat.report_eligibility.eligible, false);
  assert.equal(strictBlockerRepeat.auto_correction_eligibility.eligible, false);
  const reclassifiedAway = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECLASSIFY-AGENT-1", failureClass: "confirmed-reclassification-class", category: "caller_error", reclassifiedFromCategory: "agent_system", correctionOf: confirmedReclassification.failure_class, severity: "P3", summary: "Later correction moved the root cause away" }, profileFile);
  const secondAgentReclassification = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECLASSIFY-AGENT-1", failureClass: "confirmed-reclassification-class", category: "agent_system", reclassifiedFromCategory: "caller_error", correctionOf: reclassifiedAway.failure_class, severity: "P2", summary: "Second confirmed Agent System reclassification", evidenceClass: "Observed", evidence: "A later observation returned to the same confirmed state" }, profileFile);
  assert.equal(secondAgentReclassification.report_eligibility.eligible, false);

  assert.throws(() => recordLocalAgentSystemIssue({ project: "governance", issueId: "DELIVERY-MISSING-CLASS", severity: "P1", summary: "Delivery unavailable omitted classification", deliveryUnavailable: true }, profileFile), /requires explicit --category and --failure-class/);
  const deliveryUnavailable = recordLocalAgentSystemIssue({ project: "governance", issueId: "DELIVERY-LOCAL-1", failureClass: "delivery-unavailable-agent-system-class", category: "agent_system", severity: "P1", summary: "Delivery is unavailable after a confirmed incident", evidenceClass: "Observed", evidence: "The delivery attempt is unavailable", coreCapability: true, locallyActionable: true, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true, supportedFallback: false, deliveryUnavailable: true }, profileFile);
  assert.equal(deliveryUnavailable.failure_class_explicit, true);
  assert.equal(deliveryUnavailable.category_explicit, true);
  assert.equal(deliveryUnavailable.report_eligibility.cross_task_delivery_eligible, false);
  assert.equal(deliveryUnavailable.auto_correction_eligibility.eligible, false);
  assert.match(deliveryUnavailable.next_action, /do_not_retry_or_resend/);
  const deliveryRow = fs.readFileSync(deliveryUnavailable.local_ledger, "utf8").trim().split("\n").map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((row) => row?.failure_class === "delivery-unavailable-agent-system-class");
  assert.equal(deliveryRow.category, "agent_system");
  assert.equal(deliveryRow.failure_class, "delivery-unavailable-agent-system-class");

  const blocker = recordLocalAgentSystemIssue({ project: "governance", issueId: "BLOCKER-1", failureClass: "repeat-true-blocker-class", category: "agent_system", severity: "P1", summary: "Initial true blocker", evidenceClass: "Observed", evidence: "Initial true-blocker evidence", coreCapability: true, locallyActionable: true, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true, supportedFallback: false }, profileFile);
  assert.equal(blocker.report_eligibility.cross_task_delivery_eligible, true);
  const rewordedBlockerRepeat = recordLocalAgentSystemIssue({ project: "governance", issueId: "BLOCKER-1", failureClass: "repeat-true-blocker-class", category: "agent_system", severity: "P1", summary: "Reworded true blocker remains active", evidenceClass: "Observed", evidence: "Reworded but non-material true-blocker evidence", coreCapability: true, locallyActionable: true, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true, supportedFallback: false }, profileFile);
  assert.equal(rewordedBlockerRepeat.true_core_blocker, true);
  assert.equal(rewordedBlockerRepeat.report_eligibility.eligible, false);
  assert.equal(rewordedBlockerRepeat.auto_correction_eligibility.eligible, false);
  const ledger = verified.local_ledger;
  fs.appendFileSync(ledger, "{malformed trailing row");
  const recoveredTail = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECOVERY-1", failureClass: "malformed-tail-recovery", category: "expected_fail_closed", severity: "P3", summary: "Malformed trailing row was preserved" }, profileFile);
  assert.equal(recoveredTail.malformed_trailing_row_preserved, true);
  const laterAppend = recordLocalAgentSystemIssue({ project: "governance", issueId: "RECOVERY-2", failureClass: "malformed-tail-later-append", category: "expected_fail_closed", severity: "P3", summary: "Later append remains available" }, profileFile);
  assert.equal(laterAppend.recorded, true);
  const recoveredText = fs.readFileSync(ledger, "utf8");
  assert.match(recoveredText, /\{malformed trailing row/);
  assert.match(recoveredText, /malformed_trailing_recovery/);
  const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acg-agent-system-malformed-nontail-"));
  const malformedProfile = path.join(malformedRoot, "machine-profile.json");
  configureAgentSystemProfile({ persistentTask: false, automaticDefectReport: false, automaticRepair: false, acknowledgeTokenCost: true, authorizeProfileWrite: true }, malformedProfile);
  fs.writeFileSync(path.join(malformedRoot, "agent-system-local-issues.jsonl"), "{malformed non-tail row\n{\"schema_version\":2}\n");
  assert.throws(() => recordLocalAgentSystemIssue({ project: "governance", issueId: "MALFORMED-NONTAIL", failureClass: "malformed-nontail", category: "expected_fail_closed", severity: "P3", summary: "Malformed non-tail rows fail closed" }, malformedProfile), /malformed non-tail JSONL row/);
  fs.rmSync(malformedRoot, { recursive: true, force: true });
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("Agent System incident transitions preserve confirmation, proof, correction, and contention boundaries", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "acg-agent-system-transitions-"));
  const profileFile = path.join(temporaryRoot, "machine-profile.json");
  configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: true, automaticRepair: true, reportedDefectAction: "auto_correct", acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
  const base = { project: "governance", issueId: "TRANSITION-1", failureClass: "transition-class", category: "agent_system", severity: "P1", summary: "Bounded incident", evidence: "Same bounded reproduction" };
  const unverified = recordLocalAgentSystemIssue({ ...base, evidenceClass: "Unverified" }, profileFile);
  assert.equal(unverified.report_eligibility.eligible, false);
  const confirmed = recordLocalAgentSystemIssue({ ...base, evidenceClass: "Observed" }, profileFile);
  assert.equal(confirmed.event_type, "addendum");
  assert.deepEqual(confirmed.report_eligibility.reasons, ["new_confirmed_agent_system_failure_class"]);
  assert.equal(confirmed.report_eligibility.cross_task_delivery_eligible, true);
  const confirmedRepeat = recordLocalAgentSystemIssue({ ...base, evidenceClass: "Observed" }, profileFile);
  assert.equal(confirmedRepeat.event_type, "repeat");
  assert.equal(confirmedRepeat.report_eligibility.eligible, false);

  const incompleteBlocker = recordLocalAgentSystemIssue({ ...base, issueId: "BOUNDARY-1", failureClass: "boundary-class", evidenceClass: "Verified", coreCapability: true, locallyActionable: true, supportedFallback: false }, profileFile);
  assert.equal(incompleteBlocker.true_core_blocker, false);
  assert.equal(incompleteBlocker.auto_correction_eligibility.eligible, false);
  const proofTransition = recordLocalAgentSystemIssue({ ...base, issueId: "BOUNDARY-1", failureClass: "boundary-class", evidenceClass: "Verified", coreCapability: true, locallyActionable: true, supportedFallback: false, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true }, profileFile);
  assert.equal(proofTransition.event_type, "addendum");
  assert.equal(proofTransition.true_core_blocker, true);
  assert.equal(proofTransition.auto_correction_eligibility.eligible, true);
  const proofRepeat = recordLocalAgentSystemIssue({ ...base, issueId: "BOUNDARY-1", failureClass: "boundary-class", evidenceClass: "Verified", coreCapability: true, locallyActionable: true, supportedFallback: false, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true }, profileFile);
  assert.equal(proofRepeat.event_type, "repeat");
  assert.equal(proofRepeat.report_eligibility.eligible, false);
  assert.equal(proofRepeat.auto_correction_eligibility.eligible, false);

  const correction = recordLocalAgentSystemIssue({ ...base, issueId: "CORRECTION-1", failureClass: "correction-class", category: "worker_adherence", evidenceClass: "Observed" }, profileFile);
  const reclassification = recordLocalAgentSystemIssue({ ...base, issueId: "CORRECTION-1", failureClass: "correction-class", category: "agent_system", reclassifiedFromCategory: "worker_adherence", correctionOf: correction.failure_class, evidenceClass: "Verified", coreCapability: true, locallyActionable: true, supportedFallback: false, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true }, profileFile);
  assert.equal(reclassification.report_eligibility.cross_task_delivery_eligible, true);
  assert.equal(reclassification.auto_correction_eligibility.eligible, false);
  const correctionRepeat = recordLocalAgentSystemIssue({ ...base, issueId: "CORRECTION-1", failureClass: "correction-class", category: "agent_system", severity: "P1", evidenceClass: "Verified", coreCapability: true, locallyActionable: true, supportedFallback: false, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true }, profileFile);
  assert.equal(correctionRepeat.event_type, "repeat");
  assert.equal(correctionRepeat.report_eligibility.cross_task_delivery_eligible, false);
  assert.equal(correctionRepeat.auto_correction_eligibility.eligible, false);
  const materiallyChangedBlocker = recordLocalAgentSystemIssue({ ...base, issueId: "CORRECTION-1", failureClass: "correction-class", category: "agent_system", severity: "P1", evidenceClass: "Verified", evidence: "A materially changed bounded blocker reproduction", materialRepairEvidence: true, coreCapability: true, locallyActionable: true, supportedFallback: false, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true }, profileFile);
  assert.equal(materiallyChangedBlocker.event_type, "addendum");
  assert.equal(materiallyChangedBlocker.report_eligibility.cross_task_delivery_eligible, true);
  assert.equal(materiallyChangedBlocker.auto_correction_eligibility.eligible, true);
  const materiallyChangedBlockerRepeat = recordLocalAgentSystemIssue({ ...base, issueId: "CORRECTION-1", failureClass: "correction-class", category: "agent_system", severity: "P1", evidenceClass: "Verified", evidence: "A materially changed bounded blocker reproduction", materialRepairEvidence: true, coreCapability: true, locallyActionable: true, supportedFallback: false, privateAgentSystemScope: true, repairAuthority: true, exclusionsComplete: true }, profileFile);
  assert.equal(materiallyChangedBlockerRepeat.event_type, "repeat");
  assert.equal(materiallyChangedBlockerRepeat.report_eligibility.cross_task_delivery_eligible, false);
  assert.equal(materiallyChangedBlockerRepeat.auto_correction_eligibility.eligible, false);

  const ledger = unverified.local_ledger;
  const descriptor = fs.openSync(`${ledger}.lock`, "wx", 0o600);
  const contended = recordLocalAgentSystemIssue({ ...base, issueId: "CONTENTION-1", failureClass: "contention-class", evidenceClass: "Observed" }, profileFile);
  fs.closeSync(descriptor);
  fs.unlinkSync(`${ledger}.lock`);
  assert.equal(contended.recorded, false);
  assert.equal(contended.contention_deferred, true);
  const serializedRetry = recordLocalAgentSystemIssue({ ...base, issueId: "CONTENTION-1", failureClass: "contention-class", evidenceClass: "Observed" }, profileFile);
  assert.equal(serializedRetry.event_type, "new_class");
  assert.equal(serializedRetry.report_eligibility.cross_task_delivery_eligible, true);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("activation surfaces current machine-profile consent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-activation-consent-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "isolated-codex-home");
  const profileFile = path.join(root, "explicit-profile.json");
  const { source, releaseId } = makeActivationRelease(root);
  const codexExecutable = makeFakeCodex(root);
  const previousProfile = process.env.ACG_MACHINE_PROFILE;
  process.env.ACG_MACHINE_PROFILE = profileFile;
  try {
    const undecided = activateRelease(source, releaseId, home, { codexHome, codexExecutable });
    assert.equal(undecided.agent_system_activation.status, "decision_required");
    assert.equal(undecided.agent_system_activation.mode, "inactive_local_only");
    configureAgentSystemProfile({ persistentTask: true, automaticDefectReport: false, automaticRepair: false, acknowledgeTokenCost: true, authorizeProfileWrite: true }, profileFile);
    const configured = activateRelease(source, releaseId, home, { codexHome, codexExecutable });
    assert.equal(configured.agent_system_activation.status, "configured");
    assert.equal(configured.agent_system_activation.mode, "active_without_automatic_reports");
  } finally {
    if (previousProfile === undefined) delete process.env.ACG_MACHINE_PROFILE;
    else process.env.ACG_MACHINE_PROFILE = previousProfile;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("activation registers, installs, and verifies mandatory release plugins before switching pointers", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-plugin-activation-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "isolated-codex-home");
  const { source, releaseId } = makeActivationRelease(root);
  const codexExecutable = makeFakeCodex(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = activateRelease(source, releaseId, home, { codexHome, codexExecutable });
  assert.equal(result.mandatory_plugin_activation.status, "installed_and_verified");
  assert.equal(result.mandatory_plugin_activation.marketplace, "ai-codex-governance");
  assert.deepEqual(result.mandatory_plugin_activation.plugins, ["jit-orchestration-governor", "model-routing-gate"]);
  assert.equal(result.mandatory_plugin_activation.host_hook_activation, "Unverified");
  assert.deepEqual(result.mandatory_plugin_activation.hook_trust_next_actions, [
    "Start interactive `codex -C <project>` in a terminal.",
    "Run `/hooks` and trust each required handler for the installed plugins.",
    "Exit the CLI, then fully relaunch Codex Desktop.",
    "Do not use --dangerously-bypass-hook-trust; installed and enabled plugins do not prove host hook activation."
  ]);
  assert.equal(path.basename(fs.realpathSync(path.join(source, ".runtime", "current"))), releaseId);
  const state = readJson(path.join(codexHome, "fake-codex-state.json"));
  assert.equal(state.marketplaces["ai-codex-governance"], path.join(source, ".runtime", "releases", releaseId));
  assert.deepEqual(Object.keys(state.installed).sort(), ["jit-orchestration-governor@ai-codex-governance", "model-routing-gate@ai-codex-governance"]);
  assert.ok(state.events.includes("plugin marketplace add " + path.join(source, ".runtime", "releases", releaseId) + " --json"));
  assert.ok(state.events.includes("plugin list --marketplace ai-codex-governance --json"));
});

test("a mandatory plugin failure restores isolated Codex state before candidate activation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-plugin-rollback-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "isolated-codex-home");
  const { source, releaseId } = makeActivationRelease(root);
  const codexExecutable = makeFakeCodex(root);
  fs.mkdirSync(path.join(codexHome, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), "prior-config\\n");
  fs.writeFileSync(path.join(codexHome, "plugins", "prior.txt"), "prior-plugin-state\\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const priorFailure = process.env.FAKE_CODEX_FAIL_PLUGIN;
  process.env.FAKE_CODEX_FAIL_PLUGIN = "model-routing-gate";
  try {
    assert.throws(
      () => activateRelease(source, releaseId, home, { codexHome, codexExecutable }),
      /injected plugin install failure/
    );
  } finally {
    if (priorFailure === undefined) delete process.env.FAKE_CODEX_FAIL_PLUGIN;
    else process.env.FAKE_CODEX_FAIL_PLUGIN = priorFailure;
  }
  assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), "prior-config\\n");
  assert.equal(fs.readFileSync(path.join(codexHome, "plugins", "prior.txt"), "utf8"), "prior-plugin-state\\n");
  assert.equal(fs.existsSync(path.join(source, ".runtime", "current")), false);
});

test("activation migrates exact or older evidence-matching Agent System plugins from another marketplace", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-plugin-migration-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "isolated-codex-home");
  const { source, releaseId } = makeActivationRelease(root);
  const codexExecutable = makeFakeCodex(root);
  const jitLegacy = makeLegacyPluginSource(root, "jit-orchestration-governor", "3.0.0-rc.3");
  const modelLegacy = makeLegacyPluginSource(root, "model-routing-gate", "1.2.0+codex.20260802");
  cacheLegacyPluginSource(codexHome, "personal", "jit-orchestration-governor", "3.0.0-rc.1", jitLegacy);
  cacheLegacyPluginSource(codexHome, "personal", "model-routing-gate", "1.2.0+codex.20260802", modelLegacy);
  writeFakeCodexState(codexHome, {
    marketplaces: { personal: path.join(root, "personal-marketplace") },
    installed: {
      "jit-orchestration-governor@personal": { pluginId: "jit-orchestration-governor@personal", name: "jit-orchestration-governor", marketplaceName: "personal", version: "3.0.0-rc.1", installed: true, enabled: true, source: { path: jitLegacy } },
      "model-routing-gate@personal": { pluginId: "model-routing-gate@personal", name: "model-routing-gate", marketplaceName: "personal", version: "1.2.0+codex.20260802", installed: true, enabled: true, source: { path: modelLegacy } }
    },
    events: []
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = activateRelease(source, releaseId, home, { codexHome, codexExecutable });
  assert.deepEqual(result.mandatory_plugin_activation.migrated_legacy_plugins, [
    { plugin_id: "jit-orchestration-governor@personal", version: "3.0.0-rc.1" },
    { plugin_id: "model-routing-gate@personal", version: "1.2.0+codex.20260802" }
  ]);
  const state = readJson(path.join(codexHome, "fake-codex-state.json"));
  assert.equal(Object.hasOwn(state.installed, "jit-orchestration-governor@personal"), false);
  assert.equal(Object.hasOwn(state.installed, "model-routing-gate@personal"), false);
  assert.ok(state.events.includes("plugin remove jit-orchestration-governor@personal --json"));
  assert.ok(state.events.includes("plugin remove model-routing-gate@personal --json"));
  assert.equal(path.basename(fs.realpathSync(path.join(source, ".runtime", "current"))), releaseId);
});

test("an unverifiable same-name plugin conflict fails before activation with a removal command", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-plugin-conflict-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "isolated-codex-home");
  const { source, releaseId } = makeActivationRelease(root);
  const codexExecutable = makeFakeCodex(root);
  const unknown = makeLegacyPluginSource(root, "jit-orchestration-governor", "3.0.0-rc.1", "Another Publisher");
  writeFakeCodexState(codexHome, {
    marketplaces: { personal: path.join(root, "personal-marketplace") },
    installed: {
      "jit-orchestration-governor@personal": { pluginId: "jit-orchestration-governor@personal", name: "jit-orchestration-governor", marketplaceName: "personal", version: "3.0.0-rc.1", installed: true, enabled: true, source: { path: unknown } }
    },
    events: []
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => activateRelease(source, releaseId, home, { codexHome, codexExecutable }),
    /codex plugin remove jit-orchestration-governor@personal/
  );
  const state = readJson(path.join(codexHome, "fake-codex-state.json"));
  assert.equal(Object.hasOwn(state.installed, "jit-orchestration-governor@personal"), true);
  assert.equal(fs.existsSync(path.join(source, ".runtime", "current")), false);
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
