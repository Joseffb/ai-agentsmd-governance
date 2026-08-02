import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");
const storagePath = path.join(root, "governance", "modules", "storage.md");

test("storage v3 owns the general contained-environment lifecycle", () => {
  const storage = fs.readFileSync(storagePath, "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "governance", "manifest.json"), "utf8"));
  const module = manifest.modules.find((entry) => entry.id === "storage");
  assert.equal(module.version, 3);
  assert.match(storage, /containers, VMs, simulators\/emulators, browser automation or profiles, local AI, generated media, package\/model caches, temporary databases, generated worktrees, remote previews/i);
  assert.match(storage, /unique run\/environment identity.*verify exact ownership.*retention as `disposable`, `persistent`, `shared`, `evidence`, or `unknown`.*baseline usage.*exact teardown.*closeout usage and residuals/is);
  assert.match(storage, /Predeclare retention at creation in an assignment- or runtime-bound creation record.*exact object and immutable engine\/object identity/is);
  assert.match(storage, /creation record plus the immutable engine\/object identity is required deletion authority/is);
  assert.match(storage, /Run\/Compose identifiers, labels, tags, and digests only corroborate identity and cannot independently authorize deletion/is);
  assert.match(storage, /processes, include PID plus start identity/i);
  assert.match(storage, /worker claim, path\/name, age\/TTL, disk pressure, or port alone never proves ownership or disposable status/i);
  assert.match(storage, /identifiers, classes, sizes, dispositions, and before\/after usage only; never print secrets/i);
});

test("storage v3 preserves non-disposable state and rejects broad deletion", () => {
  const storage = fs.readFileSync(storagePath, "utf8");
  assert.match(storage, /only exact, proven-disposable, run-owned artifacts after their consumers stop and retention\/evidence checks pass/i);
  assert.match(storage, /Immediately before teardown, recheck exact ownership and active references to avoid check\/delete races; make teardown idempotent and verify either absence or intentionally retained state afterward/i);
  assert.match(storage, /persistent database volumes; shared images, caches, networks, model stores, and browser profiles; and all unknown, evidence, or project-retained state/i);
  assert.match(storage, /accepted candidate, reproducibility, rollback, validation, or evidence/i);
  assert.match(storage, /Never run `docker system prune`, image\/volume\/builder-cache prune, a wildcard or glob cleanup, parent-root or recursive broad deletion, or a Docker\.raw manipulation or relocation trick/i);
  assert.match(storage, /explicitly disposable volumes/i);
  assert.match(storage, /Remote branches, registries, cloud previews, and hosted resources require separate external deletion authority/i);
  assert.match(storage, /each named repository\/root is resolved and admitted independently; never infer sibling, ancestor, or parent-root authority/i);
});

test("storage v3 makes residual evidence nonblocking and gives the rule its rent", () => {
  const storage = fs.readFileSync(storagePath, "utf8");
  for (const source of [
    fs.readFileSync(path.join(root, "README.md"), "utf8"),
    fs.readFileSync(path.join(root, "docs", "agent-system-role.md"), "utf8"),
    fs.readFileSync(path.join(root, "skills", "govern-codex-policy", "SKILL.md"), "utf8")
  ]) {
    assert.match(source, /single `storage` policy|(?:one|single) detailed owner: the `storage`\s+policy/i);
    assert.match(source, /Docker\.raw.*(?:example|observed)/i);
  }
  assert.match(storage, /disk evidence before and after heavy runs, plus storage-growth and residual obligations/i);
  assert.match(storage, /Do not claim a clean run when closeout is incomplete; the project result still continues/i);
  assert.match(storage, /cleanup success record never hides a failed teardown: retain the explicit residual/i);
  assert.match(storage, /Cleanup or helper failure preserves state and the residual obligation, never grants broad deletion or blocks the project/i);
  assert.match(storage, /prevents disk\/storage exhaustion, cross-run collisions, and stale service\/resource leakage/i);
  assert.match(storage, /Enforcement cost is bounded identity, usage, teardown, and closeout evidence/i);
  assert.match(storage, /Escalation path: Seat `0`.*Safe fallback: preserve the exact state and report it/is);
});

test("cleanup is a narrow local mutation intent routed through storage policy", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "governance", "manifest.json"), "utf8"));
  const cleanup = manifest.operation_catalog.cleanup;
  const storage = manifest.modules.find((entry) => entry.id === "storage");
  assert.deepEqual(cleanup, {
    effect_class: "filesystem_mutation",
    required_modules: ["storage"]
  });
  assert.ok(storage.triggers.operations.includes("cleanup"));
  assert.match(
    fs.readFileSync(storagePath, "utf8"),
    /Remote branches, registries, cloud previews, and hosted resources require separate external deletion authority/i
  );
});
