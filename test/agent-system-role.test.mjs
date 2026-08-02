import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");
const rolePath = path.join(root, "docs", "agent-system-role.md");

test("portable Agent System role is canonical and discoverable", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const jit = fs.readFileSync(path.join(root, "governance", "modules", "jit-orchestration.md"), "utf8");
  const core = fs.readFileSync(path.join(root, "lib", "core.mjs"), "utf8");
  assert.match(role, /canonical, portable identity contract/i);
  assert.match(role, /JIT orchestration and agent-use governor/i);
  assert.match(role, /dynamically loads the smallest applicable rule set/i);
  assert.match(role, /composes scoped worker prompts/i);
  assert.match(role, /selects the\s+lowest reliable model and\s+reasoning/i);
  assert.match(role, /Seat `0` remains the high-level\s+orchestrator/i);
  assert.match(role, /never\s+supplies or expands project authority/i);
  assert.match(role, /facilitator and repair service, not the owner of another\s+project's product work/i);
  assert.match(role, /reload, retry, or changed-path guidance/i);
  assert.match(role, /one exact non-archived `Agent System` label match/i);
  assert.match(role, /ephemeral delivery handle, not durable role\s+identity/i);
  assert.match(role, /replacement is staged under a temporary\s+noncanonical label/i);
  assert.match(role, /rename and unpin the\s+predecessor/i);
  assert.match(role, /pin the replacement/i);
  assert.match(readme, /\[Read the canonical portable role contract\]\(docs\/agent-system-role\.md\)/);
  assert.match(readme, /exclude archived tasks, and require one\s+exact title match/i);
  assert.match(readme, /never as the persisted routing key/i);
  assert.match(readme, /rename and unpin the predecessor/i);
  assert.match(readme, /pin the replacement/i);
  assert.match(skill, /\.\.\/\.\.\/docs\/agent-system-role\.md/);
  assert.match(skill, /Never route by a stored\s+thread ID/i);
  assert.match(skill, /stage the replacement\s+under a temporary noncanonical title/i);
  assert.match(jit, /governs agent use and prompt activation/i);
  assert.match(jit, /does not govern project authority, product state, business decisions,\s+releases, deployment, publication, or execution ownership/i);
  assert.match(core, /docs", "agent-system-role\.md"/);
});

test("KPI events stay silent and after-action reports require an operator request", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const continuity = fs.readFileSync(path.join(root, "governance", "modules", "continuity.md"), "utf8");
  assert.match(role, /KPI lifecycle events are silent private JSONL telemetry/);
  assert.match(role, /KPI and after-action\s+reports are operator-requested only/);
  assert.match(role, /run cleanup never sends one automatically/i);
  assert.match(role, /cannot delay or reopen\s+completion, authorize or block execution, or absorb ordinary project work/);
  assert.match(continuity, /KPI lifecycle event writes are silent private JSONL telemetry/);
  assert.match(continuity, /KPI and after-action reports are operator-requested only/);
  assert.match(continuity, /run cleanup never\s+sends one automatically/i);
  assert.match(continuity, /cannot delay or reopen completion, affect governance, transfer project\s+ownership/);
  assert.match(continuity, /never\s+prompts, source, output, secrets, hidden reasoning, or raw task\/thread IDs/);
});

test("worker teardown preserves candidate lanes until coordinator-owned disposal", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const policy = fs.readFileSync(path.join(root, "governance", "modules", "delegation.md"), "utf8");
  const git = fs.readFileSync(path.join(root, "governance", "modules", "subagent-git.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(git, /active.*?isolated worktree and branch.*?intact/is);
  assert.match(git, /finalized commit\/diff, validation evidence, and teardown status/i);
  assert.match(git, /worker-owned processes\/services\/watchers.*?ports, locks, and browser contexts/is);
  assert.match(git, /disposable\s+credentials\/session material.*?residual generated\/runtime state/is);
  assert.match(git, /never delete\/remove\/prune.*?Git worktree or branch.*?reset\/clean\/\s*discard\/rewrite/is);
  assert.match(git, /Failed,\s*interrupted,\s*rejected,\s*superseded, and unintegrated candidates.*?preserved/is);
  assert.match(git, /accepted lane.*?integration\/acceptance,\s*authoritative validation, and evidence\/\s*continuity preservation/is);
  assert.match(git, /rejected, superseded, or abandoned lane does not\s+require integration or acceptance/is);
  assert.match(git, /final Seat `0` disposition.*?no required unique work remains solely in that lane/is);
  assert.match(git, /Interrupted or\s+unclassified lanes remain preserved/is);
  assert.match(git, /Seat `0`, never a worker assertion, proves an exact lane unused/is);
  assert.match(git, /assignment-bound creation record plus immutable\s+repository, worktree, and branch identity/is);
  assert.match(git, /labels, tags, or digests may\s+corroborate identity but cannot independently authorize deletion/is);
  assert.match(git, /accepted-result linkage plus patch and tree\/path-\s*content equivalence across every assigned or dirty path/is);
  assert.match(git, /Commit ancestry alone\s+is insufficient/i);
  assert.match(git, /unique delta as deliberately rejected,\s+superseded by a named accepted result, or preserved in a named retained\s+artifact/is);
  assert.match(git, /tracked, untracked,\s+ignored, generated, stashed, unpushed, submodule, and evidence state as\s+applicable/is);
  assert.match(git, /project-native Git tooling.*?recoverable deletion.*?broad\/glob cleanup, wildcards, or recursive parent deletion/is);
  assert.match(git, /closeout.*?exact worker-owned.*?worktrees, branches, temp directories\/artifacts.*?generated\s+outputs\/caches/is);
  assert.match(git, /processes\/watchers\/services, ports, containers, images, volumes,\s+build artifacts, browser\s+contexts\/profiles, locks,/i);
  assert.match(git, /only an exact item proven no\s+longer needed after its applicable accepted\/integrated or rejected disposition\s+gate.*?project retention checks/is);
  assert.match(git, /Preserve unique\/unintegrated\s+candidates without final disposition/i);
  assert.match(git, /uncertain, shared, persistent, or not\s+explicitly-disposable cache, image, volume, network, database, or browser\s+profile/is);
  assert.match(git, /leave-better scope expansion/is);
  assert.match(git, /secret-free inventory plus removed, preserved, residual obligations, and\s+before\/after evidence.*?withhold any clean-run claim/is);
  assert.match(git, /broad globs.*?parent-root deletion.*?automatic destructive sweeper,\s+global prune/is);
  assert.match(git, /cleanup\/helper failure\s+is nonblocking.*?preserve the exact lane.*?never\s+permission to delete/is);
  assert.match(git, /orphan accumulation, storage\/disk exhaustion, and\s+cross-run collision\/leak/i);
  assert.match(git, /Cost: bounded\s+teardown report and coordinator verification; escalation: Seat `0`; safe\s+fallback/i);
  assert.match(git, /explicit user instruction may authorize cleanup in a named other project.*?resolve each named project\/repository\/root independently/is);
  assert.match(git, /lineage, applicable disposition, no-required-unique-work, no-active-resource,\s+and retention checks.*?every exact lane/is);
  assert.match(git, /Never infer sibling, ancestor\/\s*parent-root, or broad cleanup authority/i);
  assert.match(git, /dedicated cleanup coordinator may\s+delegate scoped workers per resolved project/i);
  assert.match(git, /Remote branch, registry, or\s+cloud-preview deletion needs separate external authority/i);
  for (const text of [policy, skill, role, readme]) {
    assert.match(text, /worker.*?(?:ephemeral state|candidate\/evidence).*?never\s+self-dispose/is);
    assert.match(text, /Seat `0`.*?acceptance-gated disposal.*?authoritative\s+validation.*?evidence\/continuity preservation/is);
    assert.match(text, /cleanup\s+failure.*?(?:preserves|keeps).*?(?:exact lane|residual obligation)/is);
  }
  assert.match(readme, /storage\/disk exhaustion, and cross-run\s+collision\/leak/i);
});

test("metrics remain downstream observations rather than optimization authority", () => {
  const metrics = fs.readFileSync(path.join(root, "docs", "agent-metrics.md"), "utf8");
  const jit = fs.readFileSync(path.join(root, "governance", "modules", "jit-orchestration.md"), "utf8");
  for (const text of [metrics, jit]) {
    assert.match(text, /metrics observe execution\s+and never become execution authority/i);
    assert.match(text, /no KPI, alone or\s+in\s+combination,[\s\S]*?or mutate policy/i);
    assert.match(text, /Historical (?:metric data|metrics) (?:remain|are)\s+downstream-only[\s\S]*?cannot feed live prompts or decisions automatically/i);
    assert.match(text, /worker topology follows real, independently integrable\s+architecture boundaries[;:]\s+agent count is never a target/i);
    assert.match(text, /metric-informed policy change/i);
    assert.match(text, /explicit\s+operator\s+review, a new version, stated assumptions, and post-change\s+recalibration/i);
  }
  assert.match(metrics, /Goodhart's,\s+Campbell's, Lucas's, and Conway's warnings/i);
  assert.match(metrics, /speed with validation, quality, and rework;\s+tokens with accepted scope; parallelism with integration and rework cost; and\s+autonomy with operator intervention and escaped defects; context compression\s+with information loss and clarification rate; and test pass rate with defect\s+escape rate/is);
  assert.match(metrics, /Tag comparisons with the Agent System version, rule set, model mix, and\s+validation topology/i);
  assert.match(metrics, /no KPI, alone or in\s+combination,[\s\S]*?set worker count/i);
  assert.match(metrics, /Do not blend pre- and post-policy relationships without a\s+qualification/i);
  for (const text of [metrics, jit]) {
    assert.match(text, /Ashby's Law of Requisite Variety constrains governance complexity/i);
    assert.match(text, /must not\s+exceed what operators can understand or workers can reliably execute/i);
    assert.match(text, /Add rules\s+only for observed failure classes; every rule needs a clear purpose and\s+observable effect/is);
    assert.match(text, /Expose unresolved rule conflicts rather than silently\s+choosing/i);
    assert.match(text, /governance reduces uncertainty rather than creating it/i);
  }
});

test("canonical evidence prioritizes accepted engineered output and bounded decision provenance", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const jit = fs.readFileSync(path.join(root, "governance", "modules", "jit-orchestration.md"), "utf8");
  for (const text of [role, jit]) {
    assert.match(text, /accepted validated scope and engineered output/i);
    assert.match(text, /Tokens and cost (?:remain|are) downstream\s+denominators/i);
    assert.match(text, /OECB\s+headline/i);
    for (const label of ["Observed", "Derived", "Proposed", "Unknown"]) {
      assert.match(text, new RegExp(label));
    }
    assert.match(text, /missing effort (?:stays|remains) `null`/i);
    assert.match(text, /decision.*scope.*type.*action.*normal path/is);
    assert.match(text, /authority.*evidence.*rule references/is);
    assert.match(text, /never records prompts or hidden reasoning|without\s+prompt or hidden reasoning/i);
  }
});

test("Agent System automation requires explicit separate consent and has a local-only disposition", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const kernel = fs.readFileSync(path.join(root, "governance", "kernel", "AGENTS.md"), "utf8");
  assert.match(role, /explicitly ask, separately, whether to create and\s+maintain a persistent Agent System task/i);
  assert.match(role, /automatically send it\s+governance\/runtime defect reports/i);
  assert.match(role, /whether to permit repair of true Agent\s+System blockers/i);
  assert.match(role, /disposition must be `log_only`\s+or `auto_correct`/i);
  assert.match(role, /can\s+consume\s+tokens/i);
  assert.match(role, /quiet, bounded,\s+secret-free append to a private\s+untracked local JSONL issue ledger/i);
  assert.match(role, /ledger is not a task\s+message, does not wake or create a task/i);
  assert.match(role, /no\s+cross-task\s+governance\s+message\s+and\s+no\s+background\s+token\s+spend/i);
  assert.match(readme, /fresh\s+installation\s+must\s+ask\s+the\s+(?:two\s+)?separate\s+decisions/i);
  assert.match(skill, /Task maintenance, reporting, and repair each require their own explicit active\s+consent/i);
  assert.match(kernel, /Separate consent governs task\/report\/repair/i);
});

test("Agent System consent and local-only logging use portable no-guess commands", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const consent = /profile agent-system --persistent-task yes\|no --automatic-defect-report yes\|no --automatic-repair yes\|no \[--reported-defect-action log_only\|auto_correct\] --acknowledge-agent-system-token-cost --authorize-profile-write \[--label <exact-title>\] \[--memory <optional-private-file>\]/;
  const record = /agent-system record-issue --project <slug> --issue-id <id> --severity P0\|P1\|P2\|P3\|P4 --category agent_system\|worker_adherence\|host_runtime\|project_tool_side_effect\|caller_error\|expected_fail_closed --failure-class <stable-slug> --summary <bounded-text> \[--evidence-class Observed\|Verified\|Inferred\|Proposed\|Unknown\|Unverified\] \[--evidence <bounded-text>\] \[--core-capability --locally-actionable --private-agent-system-scope --repair-authority --complete-exclusions --supported-fallback no\] \[--delivery-unavailable\]/;
  for (const text of [role, skill]) {
    assert.match(text, consent);
    assert.match(text, /`--reported-defect-action` is required (?:with|when) `--automatic-defect-report yes`/i);
    assert.match(text, /rejected (?:with|when) (?:it is )?`?(?:--automatic-defect-report )?no`?/i);
    assert.doesNotMatch(text, /--automatic-report(?:\s|`)/);
    assert.doesNotMatch(text, /2\.2\.2 compatibility bridge|later mode-aware private control/i);
  }
  assert.match(readme, record);
  assert.match(role, record);
  assert.match(skill, record);
  assert.match(role, /`--memory` is optional machine-local continuity/i);
  assert.match(role, /entry requires the explicit category and stable failure class, remains local/i);
  assert.match(role, /disabled reporting remains local-only/i);
  for (const text of [readme, role, skill]) {
    assert.match(text, /structured blocker-proof flags are optional/i);
    assert.match(text, /all six proof facts/i);
  }
});

test("auto_correct is an opted-in true-blocker-only repair mode", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const kernel = fs.readFileSync(path.join(root, "governance", "kernel", "AGENTS.md"), "utf8");
  const jit = fs.readFileSync(path.join(root, "governance", "modules", "jit-orchestration.md"), "utf8");
  const delegation = fs.readFileSync(path.join(root, "governance", "modules", "delegation.md"), "utf8");
  const release = fs.readFileSync(path.join(root, "governance", "modules", "release.md"), "utf8");
  for (const text of [role, skill, jit, delegation, release]) {
    assert.match(text, /Observed\/Verified P0\/P1 defect/i);
    assert.match(text, /required\s+core\s+Agent\s+System\s+capability/i);
    assert.match(text, /locally actionable within\s+private\s+Agent\s+System\s+scope/i);
    assert.match(text, /no\s+equivalent\s+supported\s+repair\s+path/i);
    assert.match(text, /project defect, caller syntax error,\s+external\s+runtime-only\s+limitation/i);
    assert.match(text, /destructive\/irreversible change,\s+architecture\/public-contract\s+redesign/i);
    assert.match(text, /source-project mutation,\s+public\s+publication, or schedule/i);
  }
  assert.match(kernel, /Separate consent governs task\/report\/repair/i);
  assert.match(kernel, /`auto_correct` repairs/i);
  assert.match(kernel, /confirmed locally actionable private-Agent-System Observed\/Verified P0\/P1\s+core-capability blockers/i);
  assert.match(kernel, /Projects\s+never wait/i);
  for (const text of [role, skill, jit, delegation]) {
    assert.match(text, /`log_only`\s+records\s+every\s+eligible\s+Agent\s+System\/runtime\s+issue\s+and\s+never\s+(?:starts\s+)?repair/i);
    assert.match(text, /`auto_correct`.*(?:automatically\s+)?repair.*only\s+a\s+confirmed,\s+locally\s+actionable\s+true\s+Agent\s+System\s+blocker/is);
    assert.match(text, /logs\s+every\s+other\s+issue\s+without\s+repair/i);
  }
  assert.match(release, /requires separate explicit active\s+repair consent/i);
  assert.match(role, /reporting project never waits for repair and continues/i);
  assert.match(skill, /source project never waits and continues through fallback/i);
});

test("RC consent continues projects immediately and bounds legacy migration", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const kernel = fs.readFileSync(path.join(root, "governance", "kernel", "AGENTS.md"), "utf8");
  for (const text of [role, readme, skill]) {
    assert.match(text, /no\s+wait-for-Agent-System/i);
    assert.match(text, /never blocks Seat `0` or the project|never blocks the project/i);
    assert.match(text, /existing tool definitions or native tools/i);
    assert.match(text, /legacy combined\s+reporting.*`log_only`/is);
    assert.match(text, /never authorizes?\s+automatic KPI or\s+after-action\s+reports or\s+automatic repair/i);
    assert.match(text, /cannot mutate\s+the\s+reporting project.*public branch/is);
  }
  for (const text of [role, skill]) {
    assert.match(text, /`log_only` records\s+every eligible Agent System\/runtime issue and never\s+starts\s+repair/i);
  }
  assert.match(kernel, /(?:no|or)\s+wait(?:-for-Agent-System)?\s+state/i);
  assert.match(kernel, /Agent\s+System\s+never\s+blocks\s+the\s+project/i);
  assert.match(kernel, /KPI is downstream-only/i);
  assert.match(role, /Helper failure never grants Seat `0` implementation/i);
  assert.match(readme, /missing or failed helper never grants Seat `0` implementation/i);
  assert.match(skill, /helper failure grants no Seat `0` implementation/i);
});

test("optional Agent System support lane is never a JIT or completion dependency", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const jit = fs.readFileSync(path.join(root, "governance", "modules", "jit-orchestration.md"), "utf8");
  for (const text of [role, readme, skill, jit]) {
    assert.match(text, /optional support/i);
    assert.match(text, /rule selection/i);
    assert.match(text, /prompt composition/i);
    assert.match(text, /delegation/i);
    assert.match(text, /native (?:fallback|recovery)/i);
    assert.match(text, /project-native tooling/i);
    assert.match(text, /project completion/i);
    assert.match(text, /Only cross-task defect (?:reporting|delivery) disappears/i);
  }
});

test("JIT manifest failure behavior blocks only the affected Agent System path", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "governance", "manifest.json"), "utf8"));
  const jit = manifest.modules.find((module) => module.id === "jit-orchestration");
  assert.deepEqual(jit.on_failure.block, [
    "affected_agent_system_path"
  ]);
  assert.deepEqual(jit.on_failure.allow, [
    "native_project_execution",
    "native_worker_delegation",
    "manual_scoped_worker_prompts",
    "project_native_tooling"
  ]);
});

test("topology remains a bounded planning aid and helper failure preserves worker fallback", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const jit = fs.readFileSync(path.join(root, "governance", "modules", "jit-orchestration.md"), "utf8");
  for (const text of [role, jit]) {
    assert.match(text, /Topology is JIT launch-order metadata[\s\S]*?(?:not|never) broader context[\s\S]*?persistent workflow state/i);
    assert.match(text, /[Uu]ncertain(?:ty| dependencies)[\s\S]*?SERIAL[\s\S]*?EXPLORATORY/i);
    assert.match(text, /(?:helper|classifier)[\s\S]*?(?:manual|native)[\s\S]*?fallback/i);
    assert.match(text, /without blocking(?: the)? project|does not block the project/i);
  }
});

test("canonical role makes worktree, branch, work, test, merge the mutating-worker first principle", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const loop = /decompose[\s\S]{0,900}?reserve[\s\S]{0,900}?(?:independent|non-overlapping)\s+lanes[\s\S]{0,900}?(?:isolated\s+(?:branch\s*\/\s*)?worktree|branch\s*\/\s*worktree)[\s\S]{0,900}?(?:worker|mutating\s+worker)[\s\S]{0,900}?(?:implement|work)[\s\S]{0,900}?(?:local\s+tests?|test)[\s\S]{0,900}?Seat\s*`?0`?[\s\S]{0,900}?(?:integrat|accept)[\s\S]{0,900}?(?:authoritative|project-authoritative)\s+validation[\s\S]{0,900}?(?:integrated\s+candidate|integration)/i;
  assert.match(role, loop);
  assert.match(role, /(?:read-only|equivalent\s+non-Git)[\s\S]{0,700}?(?:does not|never)\s+weaken[\s\S]{0,700}?mutating[\s\S]{0,400}?(?:Git\s+)?isolation/i);
  assert.match(role, /(?:disjoint\s+(?:files?|branches?)|branch\s+disjointness)[\s\S]{0,500}?(?:does\s+not|never)\s+(?:prove|imply)[\s\S]{0,500}?PARALLEL/i);
});

test("complete tracked distribution contains no machine-private identity", () => {
  const trackedFiles = execFileSync("git", [
    "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"
  ])
    .toString()
    .split("\0")
    .filter(Boolean);
  const privatePatterns = [
    new RegExp(`/${["Us", "ers"].join("")}/`, "i"),
    new RegExp(`/${["Vol", "umes"].join("")}/`, "i"),
    new RegExp(`\\.codex/${["memo", "ries"].join("")}`, "i"),
    new RegExp(["Pred", "ator"].join(""), "i"),
    new RegExp(["019", "f"].join("") + "[a-f0-9-]{20,}", "i"),
    new RegExp(["Jos", "eff"].join(""), "i"),
    new RegExp(["Beta", "ncourt"].join(""), "i"),
    new RegExp("\\b" + ["PX", "\\d+"].join("-") + "\\b", "i"),
    new RegExp("\\b" + ["px", "\\d+"].join("") + "\\b", "i")
  ];
  for (const relative of trackedFiles) {
    const file = path.join(root, relative);
    if (!fs.lstatSync(file).isFile()) continue;
    const content = fs.readFileSync(file);
    if (content.includes(0)) continue;
    let text = content.toString("utf8");
    if (relative === "LICENSE") {
      const canonicalHolder = [["Jos", "eff"], ["Beta", "ncourt"]].map((parts) => parts.join("")).join(" ");
      const copyrightLine = new RegExp(`^Copyright \\(c\\) 2026 ${canonicalHolder}$`, "m");
      assert.match(text, new RegExp(`^MIT License\\n\\n${copyrightLine.source}`, "m"), relative);
      text = text.replace(copyrightLine, "Copyright (c) [canonical holder]");
    }
    for (const pattern of privatePatterns) {
      assert.doesNotMatch(text, pattern, relative);
    }
  }
});
