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

## 2026-10-28 — Sprint 1 identity persistence foundation

- **Intended outcome:** establish the smallest real PostgreSQL foundation for
  organization-scoped identity and encrypted provider-secret envelopes without
  introducing plaintext secrets, a KMS configuration, or provider access.
- **Proof:** the temporary Compose PostgreSQL service ran the two repository
  integration cases successfully. They applied and reverted an isolated schema
  per case, created redacted connection metadata, returned no cross-tenant
  result, rejected duplicate membership, and rejected a cross-organization
  secret envelope via the composite foreign key. API type and lint checks
  passed.
- **Authoritative application paths:** the reversible schema and repository
  live at `apps/api/src/persistence/identity-repository.ts`; integration proof
  lives at `apps/api/test/identity-repository.integration.test.ts`. Neither
  path is a live runtime migration runner or production configuration.
- **Limitations:** a production migration executor, authenticated Owner
  bootstrap endpoint/session, actual encryption implementation/KMS, audit
  records, and Resend validation are intentionally deferred. The stored
  envelope is an already-encrypted opaque payload, not proof of encryption by
  itself.
- **Operational impact:** the temporary local Docker stack used only the
  ephemeral Compose password and was removed with its named test volumes. No
  staging/production service, persistent application database, secret, or
  deployment artifact changed.

## 2026-10-29 — Sprint 1 Owner authentication and sessions

- **Intended outcome:** let one self-hosted Owner establish and authenticate an
  instance without a hosted identity dependency or exposure of passwords and
  session tokens.
- **Proof:** unit, route, and PostgreSQL integration tests passed. They prove
  scrypt password hashing, hash-only session persistence, server-token-gated
  one-time bootstrap, incorrect-password rejection, `HttpOnly`/`SameSite=Lax`
  cookie delivery, expired/revoked/unknown session rejection, and
  malformed-cookie rejection. ADR 0004 records the durable design and deferred
  MFA/SSO/reset work.
- **Authoritative application paths:** auth behavior is in
  `apps/api/src/auth/auth-service.ts`; HTTP handling is
  `apps/api/src/app.ts`; database records and schema are in
  `apps/api/src/persistence/identity-repository.ts`; the server reads the
  existing `DATABASE_URL` and new `BOOTSTRAP_TOKEN` runtime variables only to
  enable this service. `.env.example` is the non-live template; no mirror or
  live runtime configuration was created by this task.
- **Limitations:** no migration runner, password reset, MFA, SSO, logout/
  revocation endpoint, rate limiter, audit trail, or user-management UI exists
  yet. The API is not deployed and responds `AUTH_NOT_CONFIGURED` if no
  database is supplied.
- **Operational impact:** the proof-only Compose stack was removed. No live
  service reads the changed application code, and no persistent credential,
  deployment artifact, or Property Intelligence component changed.

## 2026-10-30 — encrypted Owner connection settings

- **Intended outcome:** permit an Owner to configure a Resend connection
  without exposing its credential through the client, database plaintext, or
  settings responses.
- **Proof:** `corepack pnpm verify` passed. The disposable PostgreSQL run
  passed all 16 API tests, including Owner-only create/read, member denial,
  AES-GCM envelope tamper rejection, KEK unwrap failure, and a direct database
  assertion that the credential fixture was not stored in envelope columns.
- **Authoritative application paths:** API behavior is in `apps/api/src/app.ts`;
  encryption and the local development KEK wrapper are in
  `apps/api/src/settings/`; persistence is in
  `apps/api/src/persistence/identity-repository.ts`. The server reads
  `ENCRYPTION_MASTER_KEY` only when `NODE_ENV=development`; `.env.example` is
  a non-live template and has no mirrored runtime copy. No live service reads
  these paths because this application has not been deployed.
- **Limitations:** there is no live Resend validation, production KMS,
  domain verification, mailbox provisioning, invitation flow, or inbound
  routing. Production deliberately returns `SETTINGS_NOT_CONFIGURED` until a
  reviewed KMS composition is supplied.
- **Operational impact:** no runtime configuration, secret, systemd unit,
  certificate, deployment artifact, or external provider state changed. The
  disposable Compose stack and volumes were removed after proof.
