# Finding Classification Standard

Every audit, investigation, design, security, architecture, implementation, or repository review classifies findings. A finding is not work: give it an independent ID, reserve repository work IDs for implementation, and preserve their many-to-many relationship.

Severity:

- P0: critical security, governance, integrity, cross-tenant, privilege, authentication, authorization, audit-integrity, or data-loss defect.
- P1: major failure making core capability broken or unusable.
- P2: significant degradation, reliability issue, architectural concern, or important quality problem.
- P3: normal engineering, maintainability, diagnostics, documentation, or moderate UX work.
- P4: enhancement or future improvement.

Each finding states:

- ID and summary
- Severity: P0-P4
- one or more justified categories
- Confidence: Low, Medium, High, or Verified
- all evidence sources
- Status: Proposed, Needs Validation, Confirmed, In Progress, Fixed, Verified, Accepted Risk, or Won't Fix
- Release Impact: Blocked, Required, Recommended, or Optional
- Recommended Remediation
- Rationale
- related work IDs without replacing its ID

Canonical categories are Security, Governance, Architecture, Reliability, Performance, Operations, AI / Model, Data, Testing, UX, Accessibility, Documentation, Developer Experience, and Compliance. Use one or more; introduce another category only with explicit justification.

Verified confidence requires direct inspection, runtime observation, reproduction, or equivalent objective evidence; Confirmed status requires evidence. State release impact explicitly, never infer it mechanically from severity.

Accepted Risk requires authorized owner, rationale, affected release, residual risk, and expiry or review point; waiver does not erase evidence.

Continue across independent declared surfaces after a critical finding. Conclude only when scoped surfaces and authority boundaries are evaluated, evidence reconciled, no new in-scope surface remains, and assumptions, recommendations, and future enhancements are distinct. Never silently downgrade or fix findings.
