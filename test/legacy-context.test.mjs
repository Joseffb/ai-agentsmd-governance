import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const cli = path.resolve("bin/acg.mjs");

test("current-context adoption requires explicit pre-hook confirmation", () => {
  const rejected = spawnSync(process.execPath, [cli, "context", "adopt-current"], {
    encoding: "utf8"
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /requires authoritative operator confirmation/u);
});

test("confirmed legacy context adopts current policy without a default handoff", () => {
  const result = JSON.parse(execFileSync(process.execPath, [
    cli, "context", "adopt-current", "--operator-confirmed-pre-hook"
  ], { encoding: "utf8" }));
  assert.equal(result.context_class, "operator_confirmed_pre_hook_current_policy_adoption");
  assert.equal(result.adoption_level, "current_policy_complete_runtime_hook_degraded");
  assert.equal(result.existing_authority_may_continue, true);
  assert.equal(result.authority_effect, "none");
  assert.equal(result.operator_confirmation_runtime_attested, false);
  assert.equal(result.same_task_continuation_default, true);
  assert.equal(result.fresh_handoff_recommended, false);
  assert.equal(result.required_bootstrap_files.length, 3);
  assert.deepEqual(
    result.required_bootstrap_files.map((record) => record.id),
    ["kernel", "govern-codex-policy", "agent-system-role"]
  );
  assert.match(result.required_bootstrap_files[0].path, /governance\/kernel\/AGENTS\.md$/u);
  assert.ok(result.required_bootstrap_files[0].bytes > 0);
  assert.ok(result.required_bootstrap_files[0].bytes <= 8_000);
  assert.equal(result.load_contract.read_every_file_completely, true);
  assert.match(result.fresh_handoff_required_when[0], /major_feature/u);
  assert.equal(
    result.fresh_handoff_required_when.some((condition) => /context_budget|cannot_fit/u.test(condition)),
    false
  );
  assert.equal(
    result.fresh_handoff_required_when.includes(
      "the_hosting_runtime_authoritatively_rejects_further_context_for_capacity"
    ),
    true
  );
  assert.deepEqual(result.warning_boundaries, [
    "initial_adoption",
    "before_a_major_feature_that_depends_on_missing_runtime_enforcement"
  ]);
  assert.equal(result.warning_enforcement, "caller_required_unverified");
  assert.match(result.completion_sentinel, /^ACG_CURRENT_CONTEXT_ADOPTION_READY:/u);
});

test("legacy command remains a compatible alias for current adoption", () => {
  const result = JSON.parse(execFileSync(process.execPath, [
    cli, "context", "legacy", "--operator-confirmed-pre-hook"
  ], { encoding: "utf8" }));
  assert.equal(result.command, "context legacy");
  assert.equal(result.deprecated_alias_for, "context adopt-current");
  assert.equal(result.same_task_continuation_default, true);
});
