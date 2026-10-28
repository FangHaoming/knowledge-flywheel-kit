# Maintaining knowledge-flywheel-kit (repository A)

- This is the generic source and bootstrap repository. Project-specific knowledge stays in each consuming repository B; never add B's cards, credentials, or absolute local paths to A.
- Keep bootstrap operations local, deterministic and idempotent. Preserve project instructions outside the managed marker block, custom skills/rules, and project knowledge.
- Run `npm test` after changing bootstrap or runtime behavior. Tests use isolated temporary Git repositories; do not initialize the current source repository as a consumer.
- Document verified behavior and actual limitations. Do not claim client UI activation from filesystem tests alone. Do not add dependencies merely to parse configuration or copy files.

