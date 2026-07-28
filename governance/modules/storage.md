# Storage Policy

Load before builds, tests, containers, browser automation, local AI, generated media, large caches, temporary worktrees, or other heavyweight output.

Keep source and Git metadata in the repository of record. Approved repository and generated-output roots come from the active local profile. Never use a synchronized review or document lane for active repositories, worktrees, package state, builds, media, or scratch output.

Route disposable, cached, heavyweight, and agent-created non-model output to the project's approved generated-output lane, using project-scoped `Worktrees`, `Artifacts`, `Tmp`, `DerivedData`, `target`, `Node`, `Playwright`, and `Models` directories where applicable.

Before heavy work, verify the lane, resolve the project slug, and create it only with authority. If unavailable, stop unless the user approves a local fallback. Report fallback path, contents, reason, and cleanup obligation.

Active model weights, downloaded model caches, and model-runner stores remain on fast internal storage by default. Generated media, datasets, evaluations, conversions, and temporary inference output do not share that exception. Do not create new storage exceptions silently.

Redirect tool output only when supported without harming correctness. Do not alter global container storage or introduce unsupported relocation tricks. Report output that cannot safely be redirected.
