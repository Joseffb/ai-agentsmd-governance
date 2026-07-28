# Planning and Capacity Policy

Every new or materially revised implementation plan states Estimate, Available, and Recommendation.

Estimate the whole outcome: reading, design, implementation, tests, builds, debugging, evidence, repair, integration, and reporting. Use ranges. For substantial work, define decision-complete slices and preserve atomicity for migrations, security or permission changes, releases, and irreversible operations.

Use the delivery triad: minimize safely verified critical-path time; count tokens, context, coordination, and synthesis as cost; count available delegated worker seats as resources. Choose the largest useful independent set, then choose `PARALLEL`, `PIPELINED`, `SERIAL`, or `EXPLORATORY` from logical dependencies and integration order, not file disjointness alone. Use parallel workers only when their contracts are independently implementable, testable, committable, and integrable in any order. For equal safe time targets, prefer lower cost and the lowest capable model and reasoning tier. Safety, isolation, dependency order, validation, repair capacity, and evidence dominate speed.

For substantial estimates, separate Proposed conventional human effort from AI execution. State P50/P80 wall clock, critical path, seat-hours, serial and parallel validation, operator touch and wait, manual-equivalent P50/P80, rework, confidence, comparable samples, assumptions, dependencies, and stop gates. Unknowns remain null; never reduce the result to a human sprint label or let observed metrics govern execution.

For operator progress estimates, apply any explicit operator-supplied
human-to-AI compression calibration before reporting AI-active time. For
example, an active 53x calibration divides the human-active portion by 53, then
adds serial build, deployment, validation, browser, model-latency, and
operator-wait floors separately. Never report an unadjusted human duration as
AI-active time, and never apply one project's calibration as a universal
measured rate without explicit authority and provenance.

An ETA is remaining AI wall clock from now, not ambiguous "focused hours."
Preserve the initial completion window and reforecast only on material gate,
scope, failure, validation-floor, parallelism, or calibration evidence. Report
P50/P80, serial validation floor, and the reason. If predicted completion moves
earlier by materially more than elapsed time, label a forecast revision rather
than completed work. Use comparable AI work-class history, never a human
schedule or fixed multiplier.

Use authoritative capacity metadata when exposed. Otherwise state that availability is unavailable or user-reported; never invent an exact balance.

- GO: upper estimate is at most 70 percent of available capacity and retains 30 percent for validation and repair.
- SPLIT: upper estimate is 70 to 100 percent; select the largest validated, decision-complete slice.
- NO-GO / WAIT: estimate exceeds capacity, cannot be bounded safely, or cannot complete an atomic operation.

Retain useful review, delegation, testing, debugging, continuity, and validation; remove duplicate discovery, overlapping seats, broad context inheritance, and discarded parallel work.

Planning later phases does not trigger their policy.
