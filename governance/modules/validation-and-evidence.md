# Validation and Evidence Policy

Before claiming completion of non-trivial work, run the project's authoritative validation. Non-trivial work includes production code, data, migrations, permissions, authentication, authorization, contracts, IPC, routing, APIs, user behavior, policy, manifests, trackers, continuity, operations, and release behavior.

Validate proportionately for coherent slices and authoritatively at completion. Run required unit, integration, end-to-end, build, lint, type, migration, proof, tracker, policy, and release gates.

Every evidence record identifies the exact candidate or commit, procedure, relevant environment, material timestamp, actual result, skipped scope, artifacts, and conclusion. A green command is insufficient if it ran the wrong scope, skipped expected tests, used a materially different environment, or conflicts with other evidence.

When required validation cannot run, separate verified from unverified surfaces, state why, risk, and closure action, and do not claim completion. Report `verified`, `partially verified`, `unverified`, `blocked`, or `deferred`, not plausibility language.

For policy and model routing distinguish request, resolution, delivery, context acknowledgment, and runtime enforcement. Delivery is not proof of consumption; instructions are not runtime-enforced without an authoritative gateway.
