# Outcomes and proof

Use this append-only log for evidence that a completed change achieved its
intended outcome. Each entry must include:

- Date and commit identifier.
- Intended outcome and acceptance criteria.
- Exact verification command(s) and pass/fail result.
- Manual proof, screenshots, fixture IDs, or health-check evidence where
  automated proof is insufficient.
- Known limitations, follow-up work, and rollback notes.

## 2026-10-28 — repository operating foundation

- **Intended outcome:** make future work test-first, auditable, and independent
  from the Property Intelligence runtime.
- **Proof:** `git diff --check` passed; all seven required documentation paths
  were verified to exist; README links point to the project documentation.
- **Commit:** recorded with this documentation foundation.
- **Limitations:** automated Markdown linting and repository test commands do
  not exist yet; Sprint 0 must add them before application work begins.
- **Operational impact:** none. The checkout remains a VPS development
  workspace, not a runtime/deployment input.

## 2026-10-28 — commit handoff rule

- **Intended outcome:** prevent completed work from remaining only on the VPS
  checkout by requiring every verified task commit to be pushed upstream.
- **Proof:** `AGENTS.md` and `QUALITY_GATES.md` require a successful
  `git push` before task handoff; the implementing commit and the prior
  documentation-foundation commit are pushed to `origin/main` together.
- **Operational impact:** repository history is synchronized to GitHub; no
  runtime configuration changed.

## 2026-10-28 — Sprint 0 scaffold

- **Intended outcome:** create an independently testable, credential-free
  foundation for the standalone Resend Mailbox application.
- **Proof:** `corepack pnpm verify` passed secret scanning, formatting, API /
  Expo / contracts linting, type checks, four root tests, and two API health
  route tests. `git diff --check` passed.
- **Architecture:** Expo Router client, Fastify API, shared TypeScript
  contracts, and development-only Postgres/Redis/S3-compatible Compose
  definition.
- **Limitations:** No Resend
  credential, webhook, database, runtime configuration, or deployment service
  was created.
- **Commit:** recorded with this Sprint 0 foundation after independent review
  and successful push.

## 2026-10-28 — Docker development-runtime validation

- **Intended outcome:** make the standalone workspace capable of isolated
  development service startup while avoiding Property Intelligence ports and
  runtime state.
- **Proof:** Docker Engine `29.1.3` and Compose `2.40.3` were installed;
  `docker compose ... config --quiet` passed. A temporary Compose stack
  accepted PostgreSQL connections on `15432`, returned `PONG` from Redis on
  `16379`, and returned a valid S3 bucket-list XML response from SeaweedFS on
  `19000`. The Compose health check waits for the SeaweedFS S3 gateway to be
  ready after its leader election. The foundation test first required the
  complete SeaweedFS command, then passed after adding its filer process.
- **Configuration authority:** the development service declaration is
  `compose.dev.yaml` in this repository. Docker's package-managed systemd
  unit is `docker.service`; Docker stores images and volumes beneath
  `/var/lib/docker`. No mirrored Compose file exists, and no live service
  reads this development Compose file after the probe stack is removed.
- **Operational impact:** only package-managed Docker runtime state changed.
  No production/staging application service, Property Intelligence service,
  deployment artifact, or secret changed. The probe used an ephemeral
  environment value and the containers plus their named probe volumes were
  removed afterward.
- **Follow-up:** Sprint 1 must decide the durable production object-storage
  provider and credential model; this local compatibility service is not a
  production selection.

## 2026-10-28 — Sprint 1 architecture decisions

- **Intended outcome:** establish the durable security boundaries needed for a
  standalone, multi-domain, future multi-user email client before building
  persistence or provider access.
- **Proof:** ADRs 0001–0003 define organization/domain isolation, a raw-body
  signature-first and idempotent inbound lifecycle, and server-only envelope
  encryption with versioned-key rotation. `node --test
tests/foundation.test.mjs` first failed for missing ADRs, then for an
  overbroad tenant-isolation statement, and passed once the decisions and
  required content assertions were complete. `corepack pnpm verify` and `git
diff --check` passed; independent test and quality review passed.
- **Limitations:** no authentication implementation, database migration,
  Resend credential, webhook endpoint, production KMS provider, or deployment
  configuration exists yet. ADRs are design commitments; later changes require
  a superseding ADR rather than editing these decisions.
- **Operational impact:** none. The standalone VPS development checkout
  remains outside all runtime and deployment paths.
