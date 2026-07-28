# Release and Integration Policy

Load before merge, push, tag, deployment, publication, release, or claims about those states. Project branch protection, review, versioning, deployment, and release rules control; global policy grants no Git or external-effect authority.

Before integration verify candidate branch/worktree, base and HEAD, diff scope, approvals, authoritative validation, continuity, migrations, compatibility, and rollback posture. Preserve unrelated work and resolve conflicts centrally.

A clean branch, passing focused test, open pull request, generated artifact, or prepared deployment is not a merge or release. Report the actual target and resulting commit, tag, release, deployment, or publication evidence.

Never bypass protected branches, ownership, review, approval, security, release gates, or production authority. A user override applies only to its named gate and never turns skipped validation into passed validation.

## Agent System Auto-correction Boundary

An `auto_correct` defect-reporting disposition may change only private Agent
System code, configuration, isolated worktrees, and private release lanes under
existing authority. It cannot mutate the reporting project, its worktrees or
continuity, or any public branch. Reporting never implies merge, push,
activation, publication, or release authority. A repair may later produce
optional reload or changed-path guidance, but the reporting project never waits
for that repair or activation.

## System Version

The governance system has one canonical semantic version in `package.json`.
Immutable `v1-<hash>` release IDs identify exact content and never substitute
for that version.

- PATCH: compatible clarification, compression, test, or defect correction that
  preserves policy and interface contracts.
- MINOR: backward-compatible policy, module, command, field, or capability.
- MAJOR: incompatible precedence, authority, routing, schema, receipt, CLI,
  loading, or fail-closed behavior.

Bump each affected module's integer version when its normative contract changes.
Change a JSON `schema_version` only for an incompatible format change. A release
build must reject changed bundled governance without a system-version advance,
and reject a version advance without a bundled governance change.

## Lifecycle Terms and No-op Rule

- `bootstrap`: first-time installation of stable global links;
- `activate`: switch the runtime pointer to another release;
- `reload`: a fresh task reads the already-active release;
- `verify`: read-only inspection of release metadata, digests, pointers, and links;
- `rollback`: explicitly activate an older release.

Verify before bootstrap or activation. If the intended valid release and all stable links are already active, do not bootstrap, activate, roll back, or infer a restart. Report `already_active`; use reload or acknowledgment when a fresh task needs the current policy.

Activation applies to new tasks. Running tasks use their ledger release; reload cannot replace context or repair stale receipts.

Restarting an already-active agent system requires explicit counter-confirmation. State the active release and why restart is unnecessary, then ask: `The agent system is already active as <release>. Confirm restart anyway?` Proceed only after an unambiguous affirmative response to that question. A request to reload, verify, test, acknowledge, continue, or use the current policy is not restart authorization.

Never combine terms such as `bootstrap reload`, and report activation, validation, rollback-test, and total workflow durations separately.

Record merged, released, deployed, or completed only after it occurs. If required policy or authority is absent, block and state the gap.

## Running-context pinning

A prior context acknowledgment pins subsequent route, delivery, and acknowledgment work to the installed immutable release matching its manifest, kernel, and governance-skill identities. The CLI performs this resolution before lifecycle validation. Never compare a valid prior receipt against an unrelated newly active release, silently reset its ledger, or ask a normal agent to locate an old router manually. If the matching immutable release is unavailable, require a fresh context and preserve the prior accounting in the handoff.
