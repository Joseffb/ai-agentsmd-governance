# Subagent Git Isolation Policy

A mutating subagent requires its own branch and worktree. Concurrent mutating seats never share either. `fork_context` copies context only; it is not evidence of repository, branch, CWD, or worktree isolation. A read-only seat may use an existing worktree only when its commands cannot alter repository or Git state.

Before launch, the coordinator verifies repository, base branch and exact commit, dirty state and ownership, work ID, and scope. It then runs the governed preparation helper:

`node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs prepare --project <stable-slug> --repository <absolute-repository> --base <40-character-commit> --work-id <id> --seat <seat> --worktree <absolute-new-worktree> --write-scope <relative-path>`

Preparation must succeed before `spawn_agent`. Seat `0` is reserved for the coordinator and cannot receive a worker assignment. Pass its receipt path and assigned worktree in the seat prompt. The seat must run `node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs verify --receipt <absolute-receipt>` before mutation, include the returned `route_request_field` in every route request, and use the verified worktree as `workdir` for every command. The router verifies the receipt and grants only that worktree as an additional root. The launch CWD is irrelevant. If verification or routing fails, or tools cannot target that worktree, the seat stops without mutation. Never launch first and provision isolation later.

Use the active storage profile for temporary worktrees. The helper derives `codex/<work-id>/<seat>` and refuses an existing branch, existing target, in-repository target, non-exact base commit, dirty prepared worktree, or repository mismatch.

## Worker teardown and lane disposal

While active, a worker keeps its isolated worktree and branch intact. At close,
it returns finalized commit/diff, validation evidence, and teardown status; only
within assignment authority, stop worker-owned processes/services/watchers,
release worker-owned ports, locks, and browser contexts, remove disposable
credentials/session material, and report residual generated/runtime state. Never
touch shared, external, or project state.

Workers never delete/remove/prune their Git worktree or branch, reset/clean/
discard/rewrite candidate state, or decide final disposal. Failed, interrupted,
rejected, superseded, and unintegrated candidates stay preserved until Seat `0`
explicitly classifies and dispositions them. An accepted lane may be disposed
only after integration/acceptance, authoritative validation, and evidence/
continuity preservation. A rejected, superseded, or abandoned lane does not
require integration or acceptance: after final Seat `0` disposition and
evidence/continuity preservation, disposal is allowed only when exact review
proves no required unique work remains solely in that lane. Interrupted or
unclassified lanes remain preserved.

Seat `0`, never a worker assertion, proves an exact lane unused. Deletion
authority requires its assignment-bound creation record plus immutable
repository, worktree, and branch identity; labels, tags, or digests may
corroborate identity but cannot independently authorize deletion. Verify the
applicable accepted or rejected disposition, no required unique work, and no
active consumer, process, mount, port, or lock; inspect tracked, untracked,
ignored, generated, stashed, unpushed, submodule, and evidence state as
applicable. For squash, cherry-pick, rebase, or other non-ancestral integration,
no-unique-work proof requires accepted-result linkage plus patch and tree/path-
content equivalence across every assigned or dirty path. Commit ancestry alone
is insufficient. For rejected, superseded, or abandoned work, the final
disposition must identify every unique delta as deliberately rejected,
superseded by a named accepted result, or preserved in a named retained
artifact. Then use project-native Git tooling and prefer recoverable deletion;
never use broad/glob cleanup, wildcards, or recursive parent deletion.

At run closeout, Seat `0` inventories and classifies exact worker-owned
worktrees, branches, temp directories/artifacts, disposable generated
outputs/caches, processes/watchers/services, ports, containers, images, volumes,
build artifacts, browser contexts/profiles, locks,
and disposable session/credential material. Remove only an exact item proven no
longer needed after its applicable accepted/integrated or rejected disposition
gate, authoritative validation where acceptance is claimed, evidence/continuity
preservation, and project retention checks. Preserve unique/unintegrated
candidates without final disposition, required evidence or continuity,
project-retained artifacts, and every uncertain, shared, persistent, or not
explicitly-disposable cache, image, volume, network, database, or browser
profile. Cleanup cannot become a leave-better scope expansion. Report a
secret-free inventory plus removed, preserved, residual obligations, and
before/after evidence; with incomplete closure, withhold any clean-run claim.
Never use broad globs, parent-root deletion, an automatic destructive sweeper,
global prune, or automatic KPI/after-action reporting. A cleanup/helper failure
is nonblocking: preserve the exact lane as a residual cleanup obligation, never
permission to delete. This prevents unique candidate/evidence loss, leaked
processes/resources, orphan accumulation, storage/disk exhaustion, and
cross-run collision/leak: premature deletion is irreversible and residual
runtime or generated state can collide, leak, or consume storage. Cost: bounded
teardown report and coordinator verification; escalation: Seat `0`; safe
fallback: preserve the exact lane and record cleanup.

An explicit user instruction may authorize cleanup in a named other project,
but resolve each named project/repository/root independently and apply the same
lineage, applicable disposition, no-required-unique-work, no-active-resource,
and retention checks to every exact lane. Never infer sibling, ancestor/
parent-root, or broad cleanup authority. A dedicated cleanup coordinator may
delegate scoped workers per resolved project. Remote branch, registry, or
cloud-preview deletion needs separate external authority.

Unless explicitly authorized, a subagent may not change topology, switch branches, merge, rebase, cherry-pick, push, tag, stash, reset, clean, discard work, rewrite history, remove worktrees, delete branches, or stage unrelated files. Unexpected changes stop mutation and return to the coordinator; never absorb, revert, stash, overwrite, or commit them.

Within authority, a subagent stays in scope, validates proportionately, commits coherent work only when authorized, and returns project/work ID/seat, repository and worktree, assigned/base branch and commit, preparation receipt, final HEAD and commits, files and concise diff, commands and results, uncommitted or pre-existing changes, unresolved findings, integration dependencies, proposed continuity event, and integration safety.

## Same-seat continuation

Initial verification is clean-only. During preparation, declare each repository-relative source mutation boundary with repeated `--write-scope <path>` options and, when needed, separately declare non-integrable build/install output with repeated `--generated-scope <path>` options. Generated scopes cannot overlap write scope or contain tracked files; they are excluded from continuation payload/digest enumeration, while tracked changes there fail closed. A seat needing a later repair while its own expected edits remain uncommitted must not rerun initial `verify`. Run:

`node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs continue --receipt <assignment-receipt> --expected-head <40-character-commit>`

Use `seat continue --project <slug> --receipt <original-assignment-receipt> --expected-head <40-character-commit> --intent implementation|validate|deploy` for the next governed worker launch. `implementation` is the backward-compatible default; select `validate` when validation is the immediate next operation, or `deploy` for an isolated deployment operation. It returns an integrity-bound shell-free `child_preflight`; the replacement runs that command exactly once before the declared implementation, validation, or deployment operation. The preflight verifies the continuation package and receipt, then routes, delivers, and acknowledges the declared immediate intent. A `deploy` preflight authorizes deployment only: it does not authorize source mutation, Git commit/push, database mutation, or a release claim. The private continuation provenance binds project, seat, repository/worktree, original and continuation receipt integrity, immediate intent, and package integrity; preflight, explain, and finalization fail closed if it is missing or altered. Finalization verifies the canonical continuation receipt bound into that signed assignment; an optional `--receipt` may only use that receipt or a canonical filesystem-equivalent spelling. Current receipts must carry the exact stable project slug and it must equal `seat continue --project`. A legacy receipt without that field may continue only when its canonical repository and worktree are both admitted by the supplied project's registered mutation roots and no alternate project admits both; the signed continuation package records `legacy_unique_project_profile`. Continuation is valid only for the same repository, worktree, branch, seat, unchanged prepared HEAD, declared write scope, exact dirty-state digest, project binding, and declared intent. A new seat, scope, repository, worktree, branch, commit, changed dirty state, project, or changed intent requires new preparation. Continuation is not a general dirty-worktree bypass. Receipt content hashes are authoritative; equivalent canonical filesystem spellings (including macOS `/var` and `/private/var`) are not distinct identities.

## Assignment-derived recovery and finalization

For a failed or interrupted mutating seat, run `seat recover --assignment
<governed-mutating-assignment-package>`. Recovery derives repository, base,
seat, write scope, generated scope, model, and reasoning from the signed parent
assignment; do not supply a replacement source or scope. It copies only current
regular files inside the original write scope to a new prepared worktree,
persists copied-file digests and neutral untracked exclusions, and fails closed
if a tracked out-of-scope dirty path would be left behind.

`seat finalize` verifies the bound receipt and classifies final paths only
within declared write or generated-output scopes. Generated output is recorded
separately as non-integrable provenance; it is never silently counted as source
change. Scope overlap, an undeclared final path, or a generated entry that is
not a regular file or directory fails finalization.
