import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { codeRoot } from "../lib/core.mjs";

const cli = path.join(codeRoot, "bin", "acg.mjs");

function route(home, target) {
  const request = {
    mode: "read_only",
    phase: "inspection",
    project: "fixture-project",
    operations: ["read_file"],
    tools: ["filesystem_read"],
    paths: [target],
    risk_tags: [],
    mutation_authority: false,
    runtime_capabilities: { filesystem_read: true }
  };
  const env = { ...process.env, HOME: home };
  delete env.ACG_MACHINE_PROFILE;
  return execFileSync(process.execPath, [cli, "route"], {
    encoding: "utf8",
    env,
    input: JSON.stringify(request)
  });
}

test("default machine profile authorizes only exact project roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-project-roots-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const sibling = path.join(root, "sibling");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(project);
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(project, "allowed.txt"), "allowed\n");
  fs.writeFileSync(path.join(sibling, "blocked.txt"), "blocked\n");
  fs.writeFileSync(path.join(home, ".codex", "governance-machine-profile.json"), JSON.stringify({
    schema_version: 1,
    project_roots: {
      "fixture-project": [project]
    }
  }, null, 2) + "\n");

  try {
    const result = JSON.parse(route(home, path.join(project, "allowed.txt")));
    assert.equal(result.authorization_decision.decision, "allow");
    assert.throws(
      () => route(home, path.join(sibling, "blocked.txt")),
      /Add the exact repository or worktree root/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("conditional policies give bounded root and thread-tool recovery guidance", () => {
  const projectPolicy = fs.readFileSync(path.join(codeRoot, "governance", "modules", "project-overlays.md"), "utf8");
  const delegationPolicy = fs.readFileSync(path.join(codeRoot, "governance", "modules", "delegation.md"), "utf8");
  assert.match(projectPolicy, /governance-machine-profile\.json/);
  assert.match(projectPolicy, /add only that root/);
  assert.match(delegationPolicy, /never substitute `local`/);
  assert.match(delegationPolicy, /If `wait_threads` has no handler/);
  assert.match(delegationPolicy, /result, blocker, question, decision, payload, or follow-up task/);
  assert.match(delegationPolicy, /Purely informational messages requiring no action need no reply/);
  assert.match(delegationPolicy, /configured `approval_mode`/);
  assert.match(delegationPolicy, /pause only the affected action/);
  assert.match(delegationPolicy, /reporting task\s+reports\/local-logs once and immediately continues/);
  assert.match(delegationPolicy, /not project-resume permission/);
  assert.match(delegationPolicy, /do not infer failure or loop/);
  assert.match(delegationPolicy, /responsive, user-facing orchestrator/);
  assert.match(delegationPolicy, /Apply `model-routing` to every seat/);
  assert.match(delegationPolicy, /lowest capable family and reasoning tier/);
  assert.match(delegationPolicy, /Ask once only when the coordinator is below the task's demonstrated requirement/);
  assert.match(delegationPolicy, /Agent System defect delivery is not implied by delegation/);
  assert.match(delegationPolicy, /separately obtain explicit consent to maintain a persistent Agent System\s+task, automatically report governance\/runtime defects to it, and repair true\s+Agent System blockers/);
  assert.match(delegationPolicy, /Each capability requires its own active consent; automatic reporting\s+also requires an active task lane and a `log_only` or `auto_correct`\s+disposition/);
  assert.match(delegationPolicy, /Without the consent\s+required for a capability, do not\s+perform it or\s+spend\s+background tokens/);
  assert.match(delegationPolicy, /private untracked local\s+JSONL issue\s+ledger/);
  assert.match(delegationPolicy, /helper never grants Seat `0` implementation\s+authority/);
  assert.match(delegationPolicy, /legacy or unqualified\s+automatic reporting to `log_only`/);
  assert.match(delegationPolicy, /`log_only` records\s+every eligible Agent System\/runtime issue and never starts repair/);
  assert.match(delegationPolicy, /cannot mutate the reporting project or any public branch/);
});

test("seat terminology reserves zero for the orchestrator without inflating delegated capacity", () => {
  const delegationPolicy = fs.readFileSync(path.join(codeRoot, "governance", "modules", "delegation.md"), "utf8");
  const jitPolicy = fs.readFileSync(path.join(codeRoot, "governance", "modules", "jit-orchestration.md"), "utf8");
  const readme = fs.readFileSync(path.join(codeRoot, "README.md"), "utf8");
  const metrics = fs.readFileSync(path.join(codeRoot, "docs", "agent-metrics.md"), "utf8");

  assert.match(delegationPolicy, /Reserve seat `0` for the coordinator\/orchestrator/);
  assert.match(delegationPolicy, /exclude it from the unqualified agent count and seat count/);
  assert.match(delegationPolicy, /numbered `1` through `N`/);
  assert.match(readme, /A count of `2` therefore maps to/);
  assert.match(readme, /`0 orchestrator, 1 UI, 2 security`/);
  assert.match(metrics, /excluded from\s+average, peak, and displayed agent or seat counts/);
  assert.match(jitPolicy, /Seat `0` is excluded from the worker count/);
  assert.match(jitPolicy, /`N` agents or seats means `N`\s+delegated workers numbered `1` through `N`/);
});

test("JIT orchestration never substitutes for project authority or completion", () => {
  const rootPolicy = fs.readFileSync(path.join(codeRoot, "AGENTS.md"), "utf8");
  const jitPolicy = fs.readFileSync(path.join(codeRoot, "governance", "modules", "jit-orchestration.md"), "utf8");

  assert.match(rootPolicy, /Agent System governs execution, not engineering/i);
  assert.match(rootPolicy, /Agent System provides governance through evidence, not control/i);
  assert.match(rootPolicy, /Evidence, lifecycle\s+records, metrics, and reports never become execution authority/i);
  assert.match(rootPolicy, /An Agent System\s+or helper failure never blocks Seat `0` or the project/i);
  assert.match(jitPolicy, /does not govern project authority, product state, business decisions,\s+releases, deployment, publication, or execution ownership/i);
  assert.match(jitPolicy, /Removing or declining it leaves rule selection, prompt composition,\s+delegation, native recovery, project-native tooling, and project completion\s+available/i);
  assert.match(jitPolicy, /Only cross-task defect delivery disappears/i);
  assert.match(jitPolicy, /There is no fixed retry count, but an\s+unchanged relaunch loop is prohibited/i);
});

test("JIT orchestration keeps authoritative mechanical data deterministic", () => {
  const jitPolicy = fs.readFileSync(path.join(codeRoot, "governance", "modules", "jit-orchestration.md"), "utf8");

  assert.match(jitPolicy, /Keep mechanical data mechanical/i);
  assert.match(jitPolicy, /deterministic code for retrieval,\s+metadata, identity, calculations, validation, provenance, state, and\s+rendering/i);
  assert.match(jitPolicy, /AI must never overwrite authoritative mechanical\s+data/i);
  assert.match(jitPolicy, /derived output must remain distinguishable from that snapshot and cannot\s+replace or corrupt the authoritative mechanical data/i);
});
