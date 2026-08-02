import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "..");
const cli = path.join(repository, "bin", "acg.mjs");

function run(args, home, input) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: repository,
    env: { ...process.env, HOME: home },
    input,
    encoding: "utf8"
  });
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createRepository(root, name) {
  const repository = path.join(root, name);
  fs.mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.email", "fixture@example.invalid"]);
  git(repository, ["config", "user.name", "Fixture"]);
  fs.writeFileSync(path.join(repository, "README.md"), `${name}\n`);
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "-q", "-m", "fixture"]);
  return repository;
}

function inspectionRequest(project, target) {
  return {
    mode: "read_only",
    phase: "inspection",
    project,
    operations: ["read_file"],
    tools: ["filesystem_read"],
    paths: [target],
    risk_tags: [],
    mutation_authority: false,
    runtime_capabilities: { filesystem_read: true }
  };
}

function writeProfile(home, profile) {
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "governance-machine-profile.json"), `${JSON.stringify({ schema_version: 1, ...profile })}\n`);
}

test("project read roots authorize inspection but not mutation mode", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "acg-read-root-"));
  const target = path.join(home, "external-dependency");
  fs.mkdirSync(target, { recursive: true });

  const added = JSON.parse(run([
    "profile",
    "add-read-root",
    "--project",
    "example-project",
    "--path",
    target,
    "--authorize-profile-write"
  ], home));
  assert.equal(added.capability, "read_only");
  assert.equal(added.changed, true);

  const request = {
    mode: "read_only",
    phase: "inspection",
    project: "example-project",
    operations: ["read_file"],
    tools: ["filesystem_read"],
    paths: [target],
    risk_tags: [],
    mutation_authority: false,
    runtime_capabilities: { filesystem_read: true }
  };
  const allowed = JSON.parse(run(["route"], home, JSON.stringify(request)));
  assert.match(allowed.completion_sentinel, /^ACG_ROUTE_COMPLETE:/);

  const denied = spawnSync(process.execPath, [cli, "route"], {
    cwd: repository,
    env: { ...process.env, HOME: home },
    input: JSON.stringify({ ...request, mode: "mutation" }),
    encoding: "utf8"
  });
  assert.notEqual(denied.status, 0);
  assert.match(`${denied.stdout}${denied.stderr}`, /outside approved roots/);

  const removed = JSON.parse(run([
    "profile",
    "remove-read-root",
    "--project",
    "example-project",
    "--path",
    target,
    "--authorize-profile-write"
  ], home));
  assert.equal(removed.changed, true);
});

test("read-only Git lineage admits explicit repositories and profile-bound worktrees only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-git-lineage-"));
  const home = path.join(root, "home");
  const repository = createRepository(root, "repository");
  const worktree = path.join(root, "outside", "derived-worktree");
  const unrelated = createRepository(root, "unrelated");
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(repository, ["worktree", "add", "-q", "-b", "fixture-worktree", worktree]);

  try {
    const explicit = JSON.parse(run(["route"], home, JSON.stringify(inspectionRequest("unbound-project", repository))));
    assert.equal(explicit.authorization_decision.git_read_only_lineage[0].provenance, "explicit_unbound_git_repository");
    assert.throws(
      () => run(["route"], home, JSON.stringify(inspectionRequest("unbound-project", path.join(repository, "README.md")))),
      /outside approved roots/
    );
    const mutation = spawnSync(process.execPath, [cli, "route"], {
      cwd: repository,
      env: { ...process.env, HOME: home },
      input: JSON.stringify({ ...inspectionRequest("unbound-project", repository), mode: "mutation", mutation_authority: true }),
      encoding: "utf8"
    });
    assert.notEqual(mutation.status, 0);
    assert.match(`${mutation.stdout}${mutation.stderr}`, /outside approved roots/);

    writeProfile(home, { project_read_roots: { fixture: [repository] } });
    const derived = JSON.parse(run(["route"], home, JSON.stringify(inspectionRequest("fixture", path.join(worktree, "README.md")))));
    assert.equal(derived.authorization_decision.git_read_only_lineage[0].provenance, "profile_git_lineage");
    assert.equal(derived.authorization_decision.git_read_only_lineage[0].worktree, fs.realpathSync(worktree));
    const readRootMutation = spawnSync(process.execPath, [cli, "route"], {
      cwd: repository,
      env: { ...process.env, HOME: home },
      input: JSON.stringify({ ...inspectionRequest("fixture", worktree), mode: "mutation", mutation_authority: true }),
      encoding: "utf8"
    });
    assert.notEqual(readRootMutation.status, 0);
    assert.match(`${readRootMutation.stdout}${readRootMutation.stderr}`, /outside approved roots/);

    writeProfile(home, { project_roots: { fixture: [repository], other: [unrelated] } });
    assert.throws(
      () => run(["route"], home, JSON.stringify(inspectionRequest("fixture", unrelated))),
      /belongs to unrelated project: other/
    );

    writeProfile(home, { project_roots: { fixture: [repository], other: [worktree] } });
    assert.throws(
      () => run(["route"], home, JSON.stringify(inspectionRequest("fixture", worktree))),
      /ambiguous registered project lineage/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("read-only Git lineage rejects symlink and sensitive-root escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acg-git-lineage-boundary-"));
  const home = path.join(root, "home");
  const repository = createRepository(root, "repository");
  const alias = path.join(root, "repository-link");
  const sensitiveRepository = path.join(home, ".ssh", "repository");
  fs.symlinkSync(repository, alias);
  createRepository(path.join(home, ".ssh"), "repository");

  try {
    assert.throws(
      () => run(["route"], home, JSON.stringify(inspectionRequest("unbound-project", alias))),
      /must not be a symlink/
    );
    assert.throws(
      () => run(["route"], home, JSON.stringify(inspectionRequest("unbound-project", sensitiveRepository))),
      /inside a sensitive root/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
