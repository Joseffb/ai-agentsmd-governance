# Subagent Git Isolation Policy

A mutating subagent requires its own branch and worktree. Concurrent mutating seats never share either. `fork_context` copies context only; it is not evidence of repository, branch, CWD, or worktree isolation. A read-only seat may use an existing worktree only when its commands cannot alter repository or Git state.

Before launch, the coordinator verifies repository, base branch and exact commit, dirty state and ownership, work ID, and scope. It then runs the governed preparation helper:

`node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs prepare --project <stable-slug> --repository <absolute-repository> --base <40-character-commit> --work-id <id> --seat <seat> --worktree <absolute-new-worktree> --write-scope <relative-path>`

Preparation must succeed before `spawn_agent`. Seat `0` is reserved for the coordinator and cannot receive a worker assignment. Pass its receipt path and assigned worktree in the seat prompt. The seat must run `node ~/.codex/skills/govern-codex-policy/scripts/subagent-git.mjs verify --receipt <absolute-receipt>` before mutation, include the returned `route_request_field` in every route request, and use the verified worktree as `workdir` for every command. The router verifies the receipt and grants only that worktree as an additional root. The launch CWD is irrelevant. If verification or routing fails, or tools cannot target that worktree, the seat stops without mutation. Never launch first and provision isolation later.

Use the active storage profile for temporary worktrees. The helper derives `codex/<work-id>/<seat>` and refuses an existing branch, existing target, in-repository target, non-exact base commit, dirty prepared worktree, or repository mismatch.

Unless explicitly authorized, a subagent may not change topology, switch branches, merge, rebase, cherry-pick, push, tag, stash, reset, clean, discard work, rewrite history, remove worktrees, delete branches, or stage unrelated files. Unexpected changes stop mutation and return to the coordinator; never absorb, revert, stash, overwrite, or commit them.

Within authority, a subagent stays in scope, validates proportionately, commits coherent work only when authorized, and returns project/work ID/seat, repository and worktree, assigned/base branch and commit, preparation receipt, final HEAD and commits, files and concise diff, commands and results, uncommitted or pre-existing changes, unresolved findings, integration dependencies, proposed continuity event, and integration safety.

The coordinator verifies the complete diff against base, confirms scope and evidence, integrates through project policy, reruns affected gates, and records canonical state. Only the coordinator may dispose of a worktree after reconciling unique work and evidence.

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
