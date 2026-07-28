# External Effects and Supply Chain Policy

Load before network mutation, communication, deployment, publication, purchase, account or database change, dependency installation, install scripts, lockfile change, signing, or generated-code import.

Require authority for the exact effect and target. Read does not grant write; repository mutation does not grant deployment; drafting does not grant sending; test access does not grant production; tool availability grants nothing.

Before acting record target, action, scope, reversibility, identity or credentials, expected result, and validation. Destructive or irreversible effects require explicit authority unless already granted.

For dependencies and generated code, prefer locked project-standard choices; inspect identity, source, version, license, maintenance, and material checksums or signatures; never run unknown install scripts blindly; explain lockfile impact; preserve reproducibility and provenance; distinguish generated from reviewed code; never import secrets or untrusted executables.

Database or migration work requires verified environment, recovery posture, idempotency, ordering, rollback, and representative validation. Never test destructive production behavior merely to prove access.

Report actual target and outcome for communication, purchase, deployment, release, and publication; preparation is not execution. Call a check advisory unless an authoritative control prevents bypass.
