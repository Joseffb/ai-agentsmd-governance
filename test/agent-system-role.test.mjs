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
  assert.match(role, /selects the lowest reliable model and\s+reasoning/i);
  assert.match(role, /Seat `0` remains the high-level\s+orchestrator/i);
  assert.match(role, /never supplies or\s+expands project authority/i);
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

test("Agent System automation requires explicit separate consent and has a local-only disposition", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const kernel = fs.readFileSync(path.join(root, "governance", "kernel", "AGENTS.md"), "utf8");
  assert.match(role, /explicitly ask, separately, whether to create and\s+maintain a persistent Agent System task/i);
  assert.match(role, /automatically send it\s+governance\/runtime defect reports/i);
  assert.match(role, /must be `log_only` or `auto_correct`/i);
  assert.match(role, /can\s+consume tokens/i);
  assert.match(role, /quiet, bounded,\s+secret-free append to a private\s+untracked local JSONL issue ledger/i);
  assert.match(role, /not a task message, does not\s+wake or create a task/i);
  assert.match(role, /no cross-task governance\s+message and no background token spend/i);
  assert.match(readme, /fresh installation must ask the two separate decisions/i);
  assert.match(skill, /automatic defect reporting additionally requires its own explicit active\s+consent, an active task lane, and a `log_only` or `auto_correct` disposition/i);
  assert.match(kernel, /Missing, undecided, inactive, or local-only consent enables neither\s+task creation nor messaging/i);
});

test("Agent System consent and local-only logging use portable no-guess commands", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const consent = /profile agent-system --persistent-task yes\|no --automatic-defect-report yes\|no \[--reported-defect-action log_only\|auto_correct\] --acknowledge-agent-system-token-cost --authorize-profile-write \[--label <exact-title>\] \[--memory <optional-private-file>\]/;
  const record = /agent-system record-issue --project <slug> --issue-id <id> --severity P0\|P1\|P2\|P3\|P4 --summary <bounded-text> \[--evidence-class Observed\|Inferred\|Proposed\|Unknown\|Unverified\] \[--evidence <bounded-text>\]/;
  for (const text of [readme, role, skill]) {
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
  assert.match(role, /permitted only when automatic reporting is not enabled/i);
  assert.match(role, /active persistent task with automatic reporting declined remains local-only for\s+reports/i);
});

test("RC consent continues projects immediately and bounds legacy migration", () => {
  const role = fs.readFileSync(rolePath, "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
  const kernel = fs.readFileSync(path.join(root, "governance", "kernel", "AGENTS.md"), "utf8");
  for (const text of [role, readme, skill]) {
    assert.match(text, /no\s+wait-for-Agent-System/i);
    assert.match(text, /Agent System may block an improper Seat `0` action,\s+but it never blocks\s+the project/i);
    assert.match(text, /existing tool definitions or native tools/i);
    assert.match(text, /legacy combined\s+reporting.*`log_only`/is);
    assert.match(text, /never authorizes?\s+automatic KPI or\s+after-action\s+reports or\s+automatic repair/i);
    assert.match(text, /`log_only` records or delivers\s+one\s+bounded defect\s+and never\s+starts repair/i);
    assert.match(text, /cannot mutate\s+the\s+reporting project.*public branch/is);
  }
  assert.match(kernel, /wait-for-Agent-System state/i);
  assert.match(kernel, /Agent System failure\s+never blocks the project/i);
  assert.match(kernel, /never authorizes automatic KPI\/after-action\s+reports, repair, project, or\s+public-branch mutation/i);
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
    "proven_improper_seat0_direct_worker_required_execution",
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
    for (const pattern of privatePatterns) {
      assert.doesNotMatch(content.toString("utf8"), pattern, relative);
    }
  }
});
