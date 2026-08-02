import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const policy = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "governance", "modules", "model-routing.md"),
  "utf8"
);

test("model routing prohibits Fast mode without restricting reasoning selection", () => {
  assert.match(policy, /Use standard mode/);
  assert.match(policy, /Never enable, request, or recommend Fast mode/);
  assert.match(policy, /does not restrict explicit model-family or reasoning selection/);
  assert.match(policy, /Bias against `ultra` reasoning/);
  assert.match(policy, /First re-prompt or clarify/);
  assert.match(policy, /independent `xhigh` evaluation/);
  assert.match(policy, /material blocker/);
  assert.match(policy, /why `xhigh` is insufficient/);
  assert.match(policy, /token, compute, and cost footprint/);
  assert.match(policy, /exact incident/);
  assert.match(policy, /prior agreement does not carry forward/);
});

test("Luna Max is the bounded routine tier and safety-sensitive work escalates", () => {
  assert.match(policy, /capability-and-safety-first order \(then wall-clock, then tokens\s+and cost\)/i);
  assert.match(policy, /Luna Max: preferred lowest-cost bounded routine implementer/i);
  assert.match(policy, /`gpt-5\.6-luna` with `max` reasoning/);
  assert.match(policy, /Do not use Luna merely because it is cheap for security-critical, authority,\s+migration, destructive, privacy, release, deployment, or high-ambiguity\s+work/i);
  assert.match(policy, /Terra Max: complex implementation, debugging, migration, integration, and\s+multi-file work/i);
  assert.match(policy, /`gpt-5\.6-terra` with `max` reasoning/);
  assert.match(policy, /Sol High: adversarial work, architecture, authority review/i);
  assert.match(policy, /`gpt-5\.6-sol` with `high`\s+reasoning/);
});

test("native-first Luna routing has a bounded portable CLI manual-worker adapter", () => {
  assert.match(policy, /An observed native collaboration override can exclude Luna even when\s+the\s+installed Codex CLI authoritatively supports the Luna runtime ID/i);
  assert.match(policy, /Prefer\s+native collaboration or the configured custom `luna_worker` whenever that\s+selection is exposed/i);
  assert.match(policy, /proactive eligible routing, not a failure-only\s+fallback/i);
  assert.match(policy, /participant and capacity limits, one exact isolated worktree\s+for mutation, bounded scope and acceptance criteria, proportionate validation,\s+and a defined lifecycle\/evidence return/i);
  assert.match(policy, /bounded manual-worker adapter, not a native-collaboration\s+subagent/i);
  assert.match(policy, /Reserve one available worker slot\s+before launch/i);
  assert.match(policy, /record its owner, exact isolated worktree\/cwd, process or\s+session identity, and expected return/i);
  assert.match(policy, /Do not use a user-owned\s+`create_thread`\s+as a subagent substitute/i);
  assert.match(policy, /one self-contained, secret-free prompt file/i);
  assert.match(policy, /non-TTY process; it has no interactive steering,\s+follow-up turns, or resume path/i);
  assert.match(policy, /codex exec --cd "\$worker_worktree" --model gpt-5\.6-luna -c 'model_reasoning_effort="max"' --sandbox workspace-write --json - < "\$prompt_file"/);
  assert.match(policy, /\$worker_worktree` is the pre-verified exact isolated worktree/i);
  assert.match(policy, /\$prompt_file` is the coordinator-owned self-contained prompt file/i);
  assert.match(policy, /For read-only\s+work, replace `--sandbox workspace-write` with the read-only\s+sandbox/i);
  assert.match(policy, /JSON lifecycle\/evidence output private and ingest only bounded lifecycle and\s+evidence facts into the normal coordination record/i);
  assert.match(policy, /lifecycle owner owns the CLI PID or session, observes verified\s+exit or interruption, and performs bounded cancellation and process\/session\s+cleanup/i);
  assert.match(policy, /Release the reserved worker slot only after that verified\s+exit or interruption and the bounded cleanup outcome are recorded/i);
  assert.match(policy, /Never\s+delete, reset, or otherwise disturb the isolated candidate\/worktree during\s+cancellation or cleanup/i);
  assert.match(policy, /If process ownership or exit is unverified, preserve\s+candidate state, retain the reservation, and escalate or use another safe\s+worker path; do not relaunch/i);
  assert.match(policy, /not a public claim or model attestation/i);
  assert.match(policy, /requested model\s+and reasoning remain configuration, and actual model and reasoning remain\s+`Unverified` unless authoritative runtime metadata attests them/i);
});

test("native collaboration compatibility keeps bypass evidence nonblocking", () => {
  assert.match(policy, /Native\s+collaboration\s+interception is capability-dependent/i);
  assert.match(policy, /not a universal\s+expectation for every host/);
  assert.match(policy, /normal\s+workers\s+may still\s+proceed with explicit model and reasoning requests/i);
  assert.match(policy, /report actual model\s+and reasoning as `Unverified` unless authoritative runtime selection metadata\s+attests them/i);
  assert.match(policy, /Set `model_critical:false` by default/);
  assert.match(policy, /actual-model or actual-reasoning attestation requirement needs authoritative\s+runtime selection metadata or operator-approved redesign/is);
  assert.match(policy, /continue unrelated work/i);
  assert.match(policy, /telemetry that this\s+path is not hook-gated/);
  assert.match(policy, /never stops the project/i);
});

test("Spark is mandatory only for composer-derived mechanical AI transformation work", () => {
  assert.match(policy, /mandatory only for composer-derived `mechanical` bounded delegated AI transformation or mechanical-edit work/);
  assert.match(policy, /`gpt-5\.3-codex-spark` with `low` reasoning/);
  assert.match(policy, /## Subagent Assignment[\s\S]*?### Spark-Eligible Bounded Delegated Work/);
  assert.match(policy, /only the exact `mechanical` complexity\s+class may produce/i);
  assert.match(policy, /content-addressed bundle, worker\s+request, and prompt envelope/);
  assert.match(policy, /integrity-bound Model\s+Routing Gate must verify that composer-derived request before launch/);
  assert.match(policy, /bounded delegated AI transformation or\s+mechanical-edit worker/i);
  assert.match(policy, /inventory collection, calculation, test execution, validation, provenance,\s+state, and rendering remain deterministic code, tools, or data/i);
  assert.doesNotMatch(policy, /model-operated inventories|focused deterministic test execution/);
  assert.match(policy, /must never retrieve or\s+overwrite the authoritative mechanical data/i);
  assert.match(policy, /architecture, contracts,\s+authentication, security, privacy, migrations, ambiguous debugging,\s+integration or conflict resolution, release or acceptance work, or a final\s+verdict/i);
  assert.match(policy, /composition and launch tooling when it\s+is available, but do not require a quarantine handshake for a normal native\s+worker/i);
  assert.match(policy, /Direct native workers are normal workers: give them the assigned scope,\s+isolation, acceptance criteria, and proportionate validation/i);
  assert.match(policy, /conservative Spark fallback is `gpt-5\.6-terra` with\s+`low` reasoning only when the composer state is exactly\s+`unknown_or_unexposed` and `availability_evidence` is `Unverified`/i);
  assert.match(policy, /`authoritatively_unavailable` and `separate_pool_exhausted` are reserved state\s+names and fail closed at launch until a supported host capability receipt\s+provides authoritative availability evidence/i);
  assert.match(policy, /An unverified claim of either\s+reserved state is not permission to launch Terra/i);
  assert.match(policy, /Never move the work to Seat\s+`0`/);
  assert.match(policy, /block only the affected launch and continue the project through another\s+safe supported path/i);
  assert.match(policy, /actual\s+model and reasoning as `Unverified`/i);
  assert.match(policy, /On a hook-covered path, a missing, altered, or non-matching composer request\s+is inadmissible for that Spark launch/i);
});
