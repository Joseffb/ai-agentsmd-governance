import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  acknowledgeDelivery,
  authorizeActivationDirection,
  bundleDigest,
  canonicalJson,
  codeRoot,
  deliverResolvedPolicy,
  dependencyClosure,
  installStableLinks,
  lockLocalPolicies,
  readJson,
  resolveRoute,
  receiptDigest,
  runCanary,
  sha256,
  validateSkill,
  validateGraph,
  verifyLocalPolicies,
  verifyAll,
  verifyPolicyRoot
} from "../lib/core.mjs";

const policyRoot = path.join(codeRoot, "governance");

function makeLocalOrganizationFixture() {
  const root = fs.mkdtempSync("/tmp/example-");
  const policyDir = path.join(root, "local-policies");
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(policyDir, { recursive: true });
  fs.cpSync(path.join(codeRoot, "fixtures", "local-organizations", "policies"), policyDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  execFileSync("git", ["init", "-q", projectRoot]);
  execFileSync("git", ["-C", projectRoot, "remote", "add", "origin", "https://example.invalid/ExampleOrg/ExampleProject.git"]);
  const template = fs.readFileSync(path.join(codeRoot, "fixtures", "local-organizations", "index.json"), "utf8");
  const indexFile = path.join(root, "index.json");
  fs.writeFileSync(indexFile, template.replaceAll("/tmp/example", root));
  lockLocalPolicies(indexFile, policyRoot);
  return { root, policyDir, projectRoot, indexFile };
}

function localRequest(fixture, extra = {}) {
  return {
    mode: "read_only",
    phase: "plan",
    project: "ExampleProject",
    operations: ["plan"],
    mutation_authority: false,
    local_organization_index: fixture.indexFile,
    local_project_root: fixture.projectRoot,
    paths: [fixture.projectRoot],
    ...extra
  };
}

test("complete policy tree verifies", () => {
  const result = verifyAll(policyRoot);
  assert.equal(result.verified, true);
  assert.equal(result.module_count, 16);
  assert.equal(result.traceability_rules, 0);
  assert.equal(result.traceability, "optional_local_migration_provenance");
  assert.equal(result.system_version, "3.0.2");
  assert.equal(result.display_channel, "RC-3.0");
});

test("canary routing contract passes", () => {
  const result = runCanary(policyRoot);
  assert.equal(result.passed, true);
  assert.ok(result.cases.every((entry) => entry.passed));
});

test("future operations do not trigger policy", () => {
  const result = resolveRoute({
    mode: "read_only",
    phase: "plan",
    project: "*",
    operations: ["plan"],
    future_operations: ["build", "deploy"],
    mutation_authority: false
  }, policyRoot);
  assert.deepEqual(
    result.active_modules.map((module) => module.id),
    ["context-routing", "jit-orchestration", "planning-and-capacity"]
  );
});

test("local extension is exact, lazy, ordered, and acknowledged", () => {
  const fixture = makeLocalOrganizationFixture();
  const index = readJson(fixture.indexFile);
  index.organizations.push({
    id: "ExampleOther",
    policy: { version: 1, path: path.join(fixture.policyDir, "unreadable.md"), sha256: "sha256:" + "0".repeat(64) },
    projects: []
  });
  fs.writeFileSync(fixture.indexFile, JSON.stringify(index, null, 2) + "\n");
  const routed = resolveRoute(localRequest(fixture), policyRoot);
  assert.deepEqual(routed.active_modules.slice(-2).map((entry) => entry.id), ["local-organization:ExampleOrg", "local-project:ExampleOrg:ExampleProject"]);
  assert.equal(routed.local_policy_extension.repository_agents_precedence, "reported_not_copied");
  assert.equal(routed.active_modules.some((entry) => entry.id.includes("ExampleOther")), false);
  const acknowledged = acknowledgeDelivery(deliverResolvedPolicy(routed, policyRoot), policyRoot).context_acknowledgment;
  assert.equal(acknowledged.context_ledger["local-organization:ExampleOrg"].source, "delivered_local_policy");
  assert.equal(acknowledged.accumulated_policy_tokens, Object.values(acknowledged.context_ledger).reduce((sum, entry) => sum + entry.estimated_tokens, 0));
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

test("local extension fails closed for disabled, ambiguous, path, root, remote, and digest errors", () => {
  const fixture = makeLocalOrganizationFixture();
  const pristine = fs.readFileSync(fixture.indexFile, "utf8");
  const mutate = (change) => {
    const index = JSON.parse(pristine);
    change(index);
    fs.writeFileSync(fixture.indexFile, JSON.stringify(index, null, 2) + "\n");
    assert.throws(() => resolveRoute(localRequest(fixture), policyRoot));
  };
  mutate((index) => { index.disabled = true; });
  mutate((index) => { index.organizations[0].policy.path = `${fixture.policyDir}/../example-org.md`; });
  mutate((index) => { index.organizations[0].projects[0].root = path.join(fixture.root, "other-root"); });
  mutate((index) => { index.organizations[0].projects[0].git_origin = "https://example.invalid/ExampleOrg/Other.git"; });
  mutate((index) => { index.organizations[0].policy.sha256 = "sha256:" + "0".repeat(64); });
  const index = JSON.parse(pristine);
  const duplicate = structuredClone(index.organizations[0]);
  duplicate.id = "ExampleOrgTwo";
  index.organizations.push(duplicate);
  fs.writeFileSync(fixture.indexFile, JSON.stringify(index, null, 2) + "\n");
  assert.throws(() => resolveRoute(localRequest(fixture), policyRoot), /Ambiguous/);
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

test("local index is optional, future-only input does not preload, and verify supports selected or all descriptors", () => {
  const fixture = makeLocalOrganizationFixture();
  const withoutIndex = resolveRoute({
    mode: "read_only", phase: "plan", project: "*", operations: ["plan"], mutation_authority: false,
    future_local_organization_index: fixture.indexFile
  }, policyRoot);
  assert.equal(withoutIndex.active_modules.some((entry) => entry.source === "local_policy"), false);
  assert.equal(verifyLocalPolicies(fixture.indexFile, null, policyRoot).verified, true);
  assert.equal(verifyLocalPolicies(fixture.indexFile, localRequest(fixture), policyRoot).selected.length, 2);
  fs.appendFileSync(path.join(fixture.policyDir, "example-org.md"), "\nUpdated policy.\n");
  assert.doesNotThrow(() => lockLocalPolicies(fixture.indexFile, policyRoot));
  assert.equal(verifyLocalPolicies(fixture.indexFile, null, policyRoot).verified, true);
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

test("local fixtures contain no private identifiers", () => {
  const fixtureRoot = path.join(codeRoot, "fixtures", "local-organizations");
  for (const file of fs.readdirSync(fixtureRoot, { recursive: true })) {
    const full = path.join(fixtureRoot, file);
    if (!fs.statSync(full).isFile()) continue;
    assert.doesNotMatch(fs.readFileSync(full, "utf8"), /\/Users\/|\/Volumes\/|github\.com|git@/i);
  }
});

test("approved roots use source root and an optional generic machine profile", () => {
  const profileRoot = fs.mkdtempSync("/tmp/example-machine-");
  const allowedRoot = path.join(profileRoot, "allowed");
  fs.mkdirSync(allowedRoot);
  const profileFile = path.join(profileRoot, "profile.json");
  fs.writeFileSync(profileFile, JSON.stringify({ approved_roots: [allowedRoot] }) + "\n");
  const original = process.env.ACG_MACHINE_PROFILE;
  try {
    delete process.env.ACG_MACHINE_PROFILE;
    assert.doesNotThrow(() => resolveRoute({
      mode: "mutation", phase: "implementation", project: "*", operations: ["build"],
      tools: ["shell"], paths: [codeRoot], mutation_authority: true
    }, policyRoot));
    assert.throws(() => resolveRoute({
      mode: "mutation", phase: "implementation", project: "*", operations: ["build"],
      tools: ["shell"], paths: [allowedRoot], mutation_authority: true
    }, policyRoot), /outside approved roots/);
    process.env.ACG_MACHINE_PROFILE = profileFile;
    assert.doesNotThrow(() => resolveRoute({
      mode: "mutation", phase: "implementation", project: "*", operations: ["build"],
      tools: ["shell"], paths: [allowedRoot], mutation_authority: true
    }, policyRoot));
  } finally {
    if (original === undefined) delete process.env.ACG_MACHINE_PROFILE;
    else process.env.ACG_MACHINE_PROFILE = original;
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
});

test("bootstrap aliases allow only read-only access into the active release", (context) => {
  const current = path.join(codeRoot, ".runtime", "current");
  if (!fs.existsSync(current)) {
    context.skip("requires an installed active runtime release");
    return;
  }
  const root = fs.mkdtempSync("/tmp/acg-bootstrap-alias-");
  const home = path.join(root, "home");
  const codexHome = path.join(home, ".codex");
  const release = fs.realpathSync(current);
  const agents = path.join(codexHome, "AGENTS.md");
  const policies = path.join(codexHome, "policies");
  const skill = path.join(codexHome, "skills", "govern-codex-policy");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.symlinkSync(path.join(release, "AGENTS.md"), agents);
  fs.symlinkSync(path.join(release, "policies"), policies);
  fs.symlinkSync(path.join(release, "skills", "govern-codex-policy"), skill);
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = home;
    for (const target of [agents, policies, skill]) {
      assert.doesNotThrow(() => resolveRoute({
        mode: "read_only", phase: "inspection", project: "*", operations: ["repository_inspection"],
        tools: ["shell"], paths: [target], mutation_authority: false
      }, policyRoot));
    }
    assert.throws(() => resolveRoute({
      mode: "mutation", phase: "implementation", project: "*", operations: ["edit_files"],
      tools: ["shell"], paths: [agents], mutation_authority: true
    }, policyRoot), /outside approved roots/);
    fs.unlinkSync(agents);
    const redirected = path.join(root, "redirected-agents.md");
    fs.writeFileSync(redirected, "untrusted\n");
    fs.symlinkSync(redirected, agents);
    assert.throws(() => resolveRoute({
      mode: "read_only", phase: "inspection", project: "*", operations: ["repository_inspection"],
      tools: ["shell"], paths: [agents], mutation_authority: false
    }, policyRoot), /outside approved roots/);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("activation direction blocks implicit rollback and reports forward movement", () => {
  const root = fs.mkdtempSync("/tmp/acg-activation-direction-");
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.name", "ACG Test"]);
  execFileSync("git", ["-C", root, "config", "user.email", "acg@example.invalid"]);
  const marker = path.join(root, "marker.txt");
  fs.writeFileSync(marker, "first\n");
  execFileSync("git", ["-C", root, "add", "marker.txt"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "first"]);
  const first = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  fs.writeFileSync(marker, "second\n");
  execFileSync("git", ["-C", root, "commit", "-q", "-am", "second"]);
  const second = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(authorizeActivationDirection(root, first, second), "upgrade");
  assert.equal(authorizeActivationDirection(root, second, second), "same");
  assert.throws(() => authorizeActivationDirection(root, second, first), /Refusing rollback activation/);
  assert.equal(authorizeActivationDirection(root, second, first, true), "rollback");
  fs.rmSync(root, { recursive: true, force: true });
});

test("dependency closure is stable and ordered", () => {
  const manifest = readJson(path.join(policyRoot, "manifest.json"));
  const closure = dependencyClosure(manifest, ["subagent-git"], "*");
  assert.ok(closure.indexOf("model-routing") < closure.indexOf("delegation"));
  assert.ok(closure.indexOf("continuity") < closure.indexOf("subagent-git"));
  assert.equal(closure.at(-1), "subagent-git");
});

test("cycle fails closed", () => {
  const manifest = readJson(path.join(policyRoot, "manifest.json"));
  const clone = structuredClone(manifest);
  clone.modules.find((module) => module.id === "storage").dependencies.push("subagent-git");
  assert.throws(() => validateGraph(clone), /Circular module dependency/);
});

test("unresolved equal-precedence conflict fails closed", () => {
  const manifest = readJson(path.join(policyRoot, "manifest.json"));
  const clone = structuredClone(manifest);
  const storage = clone.modules.find((module) => module.id === "storage");
  const trust = clone.modules.find((module) => module.id === "trust-and-data");
  storage.conflicts.push("trust-and-data");
  trust.conflicts.push("storage");
  assert.throws(() => dependencyClosure(clone, ["storage", "trust-and-data"], "*"), /Unresolved policy conflict/);
});

test("route command is observational", () => {
  const before = fs.statSync(path.join(policyRoot, "policy.lock.json")).mtimeMs;
  const input = { mode: "read_only", phase: "answer", project: "*", operations: ["read_file"], mutation_authority: false };
  const output = execFileSync(process.execPath, [path.join(codeRoot, "bin", "acg.mjs"), "route"], {
    cwd: codeRoot,
    input: JSON.stringify(input),
    encoding: "utf8"
  });
  assert.match(output, /ACG_ROUTE_COMPLETE/);
  const after = fs.statSync(path.join(policyRoot, "policy.lock.json")).mtimeMs;
  assert.equal(after, before);
});

test("resolution, delivery, and context acknowledgment remain distinct", () => {
  const routed = resolveRoute({
    mode: "read_only",
    phase: "plan",
    project: "*",
    operations: ["plan"],
    mutation_authority: false
  }, policyRoot);
  assert.equal(routed.already_in_context.includes("planning-and-capacity"), false);
  const delivered = deliverResolvedPolicy(routed, policyRoot);
  assert.deepEqual(delivered.delivery_receipt.delivered_modules.map((module) => module.id), [
    "context-routing",
    "jit-orchestration",
    "planning-and-capacity"
  ]);
  const acknowledged = acknowledgeDelivery(delivered, policyRoot).context_acknowledgment;
  assert.equal(acknowledged.already_in_context.includes("planning-and-capacity"), true);
  assert.equal(acknowledged.accumulated_policy_tokens, Object.values(acknowledged.context_ledger).reduce((sum, entry) => sum + entry.estimated_tokens, 0));
});

test("accumulated policy context can grow beyond an advisory mode target", () => {
  let prior = acknowledgeDelivery(deliverResolvedPolicy(resolveRoute({
    mode: "read_only",
    phase: "plan",
    project: "*",
    operations: ["plan"],
    mutation_authority: false
  }, policyRoot), policyRoot), policyRoot).context_acknowledgment;

  prior = acknowledgeDelivery(deliverResolvedPolicy(resolveRoute({
    mode: "mutation",
    phase: "delegation",
    project: "*",
    operations: ["launch_mutating_subagent"],
    tools: ["subagent", "filesystem_write"],
    paths: [codeRoot],
    authorities: ["delegation"],
    mutation_authority: true,
    prior_receipt: prior
  }, policyRoot), policyRoot), policyRoot).context_acknowledgment;

  const routed = resolveRoute({
    mode: "read_only",
    phase: "review",
    project: "*",
    operations: ["repository_inspection"],
    tools: ["filesystem_read"],
    mutation_authority: false,
    prior_receipt: prior
  }, policyRoot);
  assert.ok(routed.accumulated_policy_tokens + routed.next_delta_tokens > routed.policy_context_target);
  assert.equal(routed.policy_context_enforcement, "advisory_only");
  assert.equal(routed.rollover_required, false);
  assert.equal(routed.resolution_receipt.runtime_capacity_evidence, "not_evaluated_by_policy_router");
  assert.equal("runtime_context_capacity" in routed.resolution_receipt, false);
  assert.equal("reserved_non_policy_context_budget" in routed.resolution_receipt, false);
  assert.ok(routed.newly_required_module_paths.length > 0);
  const acknowledged = acknowledgeDelivery(deliverResolvedPolicy(routed, policyRoot), policyRoot).context_acknowledgment;
  assert.ok(acknowledged.accumulated_policy_tokens > acknowledged.policy_context_target);
  assert.equal(acknowledged.context_growth_policy, "monotonic_unbounded_by_governance");
});

test("effectful read-only operations and inconsistent ledgers fail closed", () => {
  assert.throws(() => resolveRoute({
    mode: "read_only",
    phase: "release",
    project: "AI-Codex-Governance",
    operations: ["deploy"],
    tools: ["deployment"],
    paths: [codeRoot],
    mutation_authority: false
  }, policyRoot), /Read-only mode forbids/);

  const routed = resolveRoute({ mode: "read_only", phase: "plan", project: "*", operations: ["plan"], mutation_authority: false }, policyRoot);
  const acknowledged = acknowledgeDelivery(deliverResolvedPolicy(routed, policyRoot), policyRoot).context_acknowledgment;
  delete acknowledged.context_ledger["planning-and-capacity"];
  acknowledged.already_in_context = acknowledged.already_in_context.filter((id) => id !== "planning-and-capacity");
  acknowledged.accumulated_policy_tokens = Object.values(acknowledged.context_ledger).reduce((sum, entry) => sum + entry.estimated_tokens, 0);
  acknowledged.receipt_sha256 = receiptDigest(acknowledged);
  assert.throws(() => resolveRoute({
    mode: "read_only",
    phase: "answer",
    project: "*",
    operations: ["read_file"],
    mutation_authority: false,
    prior_receipt: acknowledged
  }, policyRoot), /not derivable from delivery history/);
});

test("malformed route schema fails closed", () => {
  assert.throws(() => resolveRoute({ mode: "read_only", project: "*", operations: ["read_file"] }, policyRoot), /phase is required/);
  assert.throws(() => resolveRoute({ mode: "invalid", phase: "x", project: "*", operations: ["read_file"] }, policyRoot), /allowed value/);
});

test("skill is validated without third-party packages", () => {
  assert.equal(validateSkill(codeRoot).valid, true);
});

test("missing or tampered modules fail closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-policy-"));
  const copiedPolicy = path.join(root, "policy");
  fs.cpSync(policyRoot, copiedPolicy, { recursive: true });
  fs.appendFileSync(path.join(copiedPolicy, "modules", "storage.md"), "\ntampered\n");
  assert.throws(() => verifyPolicyRoot(copiedPolicy, {
    sourceRoot: codeRoot,
    kernelFile: path.join(codeRoot, "governance", "kernel", "AGENTS.md"),
    skillFile: path.join(codeRoot, "skills", "govern-codex-policy", "SKILL.md")
  }), /digest mismatch/i);
  fs.rmSync(path.join(copiedPolicy, "modules", "storage.md"));
  assert.throws(() => verifyPolicyRoot(copiedPolicy, {
    sourceRoot: codeRoot,
    kernelFile: path.join(codeRoot, "governance", "kernel", "AGENTS.md"),
    skillFile: path.join(codeRoot, "skills", "govern-codex-policy", "SKILL.md")
  }), /unreadable/i);
  fs.rmSync(root, { recursive: true, force: true });
});

function makeTestRelease(root, marker = "") {
  const source = path.join(root, "source");
  const staging = path.join(source, ".runtime", "releases", `.staging-${marker || "base"}`);
  const release = staging;
  fs.mkdirSync(path.join(release, "policies"), { recursive: true });
  fs.copyFileSync(path.join(codeRoot, "governance", "kernel", "AGENTS.md"), path.join(release, "AGENTS.md"));
  fs.cpSync(path.join(codeRoot, "governance", "modules"), path.join(release, "policies", "modules"), { recursive: true });
  fs.cpSync(path.join(codeRoot, "governance", "schemas"), path.join(release, "policies", "schemas"), { recursive: true });
  fs.cpSync(path.join(codeRoot, "governance", "profiles"), path.join(release, "policies", "profiles"), { recursive: true });
  fs.copyFileSync(path.join(codeRoot, "governance", "manifest.json"), path.join(release, "policies", "manifest.json"));
  fs.copyFileSync(path.join(codeRoot, "governance", "policy.lock.json"), path.join(release, "policies", "policy.lock.json"));
  fs.copyFileSync(path.join(codeRoot, "governance", "overlay-targets.json"), path.join(release, "overlay-targets.json"));
  fs.cpSync(path.join(codeRoot, "skills", "govern-codex-policy"), path.join(release, "skills", "govern-codex-policy"), { recursive: true });
  fs.writeFileSync(path.join(release, "marker.txt"), marker);
  const digest = bundleDigest(release);
  const lock = readJson(path.join(codeRoot, "governance", "policy.lock.json"));
  const payload = {
    schema_version: 1,
    manifest: lock.manifest,
    source_commit: "0".repeat(40),
    source_branch: "main",
    source_remote_commit: "0".repeat(40),
    remote_verified_at: "2026-07-25T00:00:00.000Z",
    bundle_sha256: `sha256:${digest.sha256}`,
    files: digest.records,
    integrity_claim: "tamper_detection_not_tamper_prevention",
    activation_scope: ["filesystem"],
    new_context_activation: "requires_fresh_context_acknowledgment",
    existing_context_activation: "Unverified"
  };
  const contentSha = sha256(canonicalJson(payload));
  const releaseId = `v1-${contentSha.slice(0, 16)}`;
  fs.writeFileSync(path.join(release, "release.json"), JSON.stringify({
    release_id: releaseId,
    content_sha256: `sha256:${contentSha}`,
    ...payload
  }, null, 2) + "\n");
  const finalRelease = path.join(source, ".runtime", "releases", releaseId);
  fs.renameSync(release, finalRelease);
  return { source, releaseId };
}

test("packaged runtime release verifies through its policies entry point", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-runtime-verify-"));
  const { source, releaseId } = makeTestRelease(root, "runtime-verify");
  const releaseRoot = path.join(source, ".runtime", "releases", releaseId);
  const result = verifyAll(path.join(releaseRoot, "policies"));
  assert.equal(result.verified, true);
  assert.equal(result.release_id, releaseId);
  assert.equal(result.source_commit, "0".repeat(40));
  assert.equal(result.module_count, 16);
  fs.rmSync(root, { recursive: true, force: true });
});

for (const faultAt of ["current", "staged", "agents", "policies", "skill"]) {
test(`bootstrap fault at ${faultAt} restores prior targets`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-bootstrap-"));
  const home = path.join(root, "home");
  const { source, releaseId } = makeTestRelease(root, faultAt);
  fs.mkdirSync(path.join(home, ".codex", "skills"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "AGENTS.md"), "prior\n");
  assert.throws(() => installStableLinks({ sourceRoot: source, releaseId, home, faultAt }));
  assert.equal(fs.readFileSync(path.join(home, ".codex", "AGENTS.md"), "utf8"), "prior\n");
  assert.equal(fs.existsSync(path.join(home, ".codex", "policies")), false);
  assert.equal(fs.existsSync(path.join(home, ".codex", "skills", "govern-codex-policy")), false);
  assert.equal(fs.existsSync(path.join(source, ".runtime", "current")), false);
  fs.rmSync(root, { recursive: true, force: true });
});
}

test("subsequent pointer failure restores the previous release", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-switch-"));
  const home = path.join(root, "home");
  const first = makeTestRelease(root, "first");
  const secondBuild = makeTestRelease(root, "second");
  fs.mkdirSync(path.join(home, ".codex", "skills"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "AGENTS.md"), "prior\n");
  installStableLinks({ sourceRoot: first.source, releaseId: first.releaseId, home });
  assert.throws(() => installStableLinks({ sourceRoot: secondBuild.source, releaseId: secondBuild.releaseId, home, faultAt: "post_switch" }));
  assert.equal(path.basename(fs.realpathSync(path.join(first.source, ".runtime", "current"))), first.releaseId);
  fs.rmSync(root, { recursive: true, force: true });
});
