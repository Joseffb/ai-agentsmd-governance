# Compatibility Matrix

This public matrix covers diagnostic and high-level interfaces. It does not
grant authority, prove runtime interception, or promise host hook enforcement.

| Interface | Compatibility status | Retained through | Earliest removal |
| --- | --- | --- | --- |
| `acg orchestrate next` | High-level orchestration entry point | major 3 | major 4 |
| `acg orchestrate verify` | Persisted-bundle diagnostic verifier | major 3 | major 4 |
| `acg context adopt-current` | High-level same-task adoption entry point | major 3 | major 4 |
| `acg context legacy` | Deprecated diagnostic-compatible alias | major 3 | major 4 |
| `rollover_required` receipt field | Diagnostic compatibility field; always `false` for governance estimates | major 3 | major 4 |
| `budgets.closures` manifest field | Advisory context-target values | major 3 | major 4 |
| `seat inspect`, `preflight`, `assign`, `recover`, `continue`, `finalize`, `explain` | Seat workflow diagnostic/high-level interfaces | major 3 | major 4 |
| `metrics report`, `metrics after-action`, `metrics record` | Metrics diagnostic/reporting interfaces | major 3 | major 4 |
| `handoff verify`, `handoff accept`, `handoff communicate` | Handoff high-level interfaces | major 3 | major 4 |
| `profile agent-system`, `profile add-root`, `profile remove-root`, `profile approval` | Profile high-level interfaces | major 3 | major 4 |
| `route`, `deliver`, `acknowledge` | Raw lifecycle diagnostic compatibility interfaces | major 3 | major 4 |

Removal in major 4 remains a future compatibility decision, not an automatic
removal schedule. Consumers must treat host enforcement, runtime model
attestation, and chained-action interception as **Unverified** unless the host
provides authoritative metadata.
