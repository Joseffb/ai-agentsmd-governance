# Mobile Review Policy

On an explicit mobile-review request, keep authority in the repository of record or approved artifact lane and create a deliberate copy under the review root defined by the local profile.

The lane is delivery-only: do not edit repositories, build, test, install packages, automate browsers, run containers, or run agent workflows there. A review copy is never authoritative.

Use descriptive names, regenerate from authority after material change, and do not export every artifact. Exclude secrets, credentials, keys, environment files, sensitive logs, and unredacted private data. Report source path, copy path, and whether it is current.
