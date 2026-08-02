# Planning and Capacity Policy

Every new or materially revised implementation plan states Estimate, Available, and Recommendation.

Estimate the whole outcome: reading, design, implementation, tests, builds, debugging, evidence, repair, integration, and reporting. Use ranges. For substantial work, define decision-complete slices and preserve atomicity for migrations, security or permission changes, releases, and irreversible operations.

Use the delivery triad: minimize safely verified critical-path time; count tokens, context, coordination, and synthesis as cost; count available delegated worker seats as resources. Choose the largest useful independent set, then choose `PARALLEL`, `PIPELINED`, `SERIAL`, or `EXPLORATORY` from logical dependencies and integration order, not file disjointness alone. Use parallel workers only when their contracts are independently implementable, testable, committable, and integrable in any order. For equal safe time targets, prefer lower cost and the lowest capable model and reasoning tier. Safety, isolation, dependency order, validation, repair capacity, and evidence dominate speed.

For substantial estimates, separate Proposed conventional human effort from AI execution. State P50/P80 wall clock, critical path, seat-hours, serial and parallel validation, operator touch and wait, manual-equivalent P50/P80, rework, confidence, comparable samples, assumptions, dependencies, and stop gates. Unknowns remain null; never reduce the result to a human sprint label or let observed metrics govern execution.

For operator progress estimates, consume the applicable calibration from the
JIT-owned `benchmark-calibration` module only when estimating AI-active time.
An explicitly approved project-specific calibration may override it for its
scope. Apply it only to compressible human-active effort, then add serial
build, test, deploy, browser, model-latency, and operator-wait floors
separately. Never report an unadjusted human duration as AI-active time or
treat a planning calibration as a universal measured rate.

If benchmark integrity cannot be verified, the governed benchmark-calibrated
estimate path is blocked only. Do not claim an automatic CLI fallback: the
project and Seat `0` continue immediately through existing native/manual
planning with calibrated AI-hour value `Unknown` and an explicit coverage
warning. With a valid policy load, unavailable or inapplicable calibration also
means `Unknown` with that warning; any uncalibrated estimate remains ROM.

An ETA is remaining AI wall clock from now, not ambiguous "focused hours."
Preserve the initial completion window and reforecast only on material gate,
scope, failure, validation-floor, parallelism, or calibration evidence. Report
P50/P80, serial validation floor, and the reason. If predicted completion moves
earlier by materially more than elapsed time, label a forecast revision rather
than completed work. Use comparable AI work-class history, never a human
schedule or fixed multiplier.

## Architectural hardening and integration status

For architectural-hardening or integration status, lead with defect clusters
and validation gates, not a completion percentage. Report the independent
blocking clusters, the current cluster, each applicable gate as `PASS`,
`FAIL`, `RUNNING`, `BLOCKED`, or `UNVERIFIED`, the evidenced regression trend,
and the remaining release work. Follow with a ranged remaining AI-active ETA
that states its assumptions, including any serial verification, integration,
and validation floors. When applicable, report deployment/browser latency
separately from the AI-active ETA. A gate-derived percentage is optional secondary context
only when it is derived from the listed gates; use `Unknown` when it cannot be justified.
It never substitutes for a blocking cluster or gate state.

Use authoritative capacity metadata when exposed. Otherwise state that availability is unavailable or user-reported; never invent an exact balance.

- GO: upper estimate is at most 70 percent of available capacity and retains 30 percent for validation and repair.
- SPLIT: upper estimate is 70 to 100 percent; select the largest validated, decision-complete slice.
- NO-GO / WAIT: estimate exceeds capacity, cannot be bounded safely, or cannot complete an atomic operation.

Retain useful review, delegation, testing, debugging, continuity, and validation; remove duplicate discovery, overlapping seats, broad context inheritance, and discarded parallel work.

Planning later phases does not trigger their policy.
