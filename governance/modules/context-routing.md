# Context Routing and Context Pack Policy

Prefer a project-approved context pack when one exists. Search approved `PACK.md`, `context-pack/`, `.codex/context/`, `.ai/context/`, skill, overlay, and user-provided locations. Read `PACK.md` first, then only files needed for the immediate operation.

Treat references as facts, skills as workflow guidance, tools or mock MCP as contracts rather than proof of callability, trackers as operational state, and examples as fixtures. Context packs provide durable knowledge; continuity provides current state. Neither replaces source, Git, authoritative trackers, decisions, or runtime evidence.

Give subagents only relevant pack files, bounded continuity, objective, permitted scope, acceptance criteria, stop conditions, and return format.

State uncertainty when a pack is missing, stale, contradictory, or incomplete; continue only when safe. Put stable repeated knowledge in the pack, not hidden chat history.

Re-route whenever project, phase, operation, tool, path, authority, external effect, or risk changes. Do not preload future policy.
