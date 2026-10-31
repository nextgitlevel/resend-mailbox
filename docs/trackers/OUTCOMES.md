# Outcomes and proof

## 2026-10-31 — authenticated plain-text compose and send status UI

- **Commit:** `8b9d270`.
- **Outcome:** Expo web/native client now has owner bootstrap/sign-in, a verified
  sender selector, responsive plain-text compose, status polling, and a safe
  same-key retry path for ambiguous requests while the compose page remains
  open. API CORS permits credentialed requests only from the exact configured
  origin, and sender listing is authenticated and organization-scoped.
- **Verification:** `corepack pnpm verify` passed (API: 56 passed, 8 PostgreSQL
  integration cases skipped; client: 3 passed). `corepack pnpm --filter
@resend-mailbox/client exec expo export --platform web` passed. `git diff
--check` passed.
- **Operational configuration:** `.env.example` is a template only. The API
  reads `CLIENT_ORIGIN` from its environment; the Expo bundle reads
  `EXPO_PUBLIC_API_BASE_URL` at build time. No live service, runtime file,
  mirror, symlink, secret, or deployment artifact changed.
- **Limitation:** PostgreSQL sender-list isolation integration is present but
  skipped here because Docker daemon access is denied. Production sending
  remains disabled until reviewed KMS and worker operations are available.

## 2026-10-31 — recoverable outbound delivery and status

- **Commit:** `d2c20e5`.
- **Outcome:** durable claims use a 120-second lease and five-attempt limit;
  transient failures use exponential backoff with jitter and reuse the stable
  provider idempotency key. After the documented Resend 24-hour retention
  window, an attempted send becomes `delivery_outcome_unknown`. The Owner API
  exposes organization-scoped safe status only.
- **Evidence:** worker tests cover retry delays/cap, stable idempotency,
  non-retryable failure, and lease attempt accounting. HTTP fixtures cover
  retryable statuses and distinguish concurrent from mismatched idempotency
  conflicts. PostgreSQL integration cases were added for lease recovery,
  cross-organization status isolation, and retention expiry.
- **Verification:** `corepack pnpm verify` passed (API tests: 54 passed, 8
  integration tests skipped); `git diff --check` passed. The database cases
  need a rerun where the Docker daemon is accessible.
- **Decision record:** `docs/adr/0004-outbound-delivery-retries.md`.

## 2026-10-31 — live development Resend outbound delivery

- **Proof:** queue payload binds the selected organization-owned Resend
  connection, reply-to policy, and bounded plain text; its idempotency
  fingerprint includes delivery-affecting values. Deterministic fixtures prove
  the fixed Resend endpoint, payload/header mapping, scoped credential lookup,
  safe failures, and no live network use in tests.
- **Verification:** `corepack pnpm verify` passed. PostgreSQL integration
  cases were skipped because Docker daemon socket access was denied.
- **Operational impact:** none. Only a development-only worker entrypoint was
  added; it requires development key management and refuses non-development
  startup. No live provider call, secret, runtime configuration, deployment
  artifact, or production service changed.

Use this append-only log for evidence that a completed change achieved its
intended outcome. Each entry must include:

- Date and commit identifier.
- Intended outcome and acceptance criteria.
- Exact verification command(s) and pass/fail result.
- Manual proof, screenshots, fixture IDs, or health-check evidence where
  automated proof is insufficient.
- Known limitations, follow-up work, and rollback notes.

## 2026-10-31 — worker-owned outbound delivery state machine

- **Proof:** PostgreSQL `SKIP LOCKED` claim proof returns one claimant under
  contention; unit tests prove idempotency-key handoff and safe terminal
  failures. The disposable Compose stack was removed after its database proof.
- **Operational impact:** none. `compose.dev.yaml` remains the authoritative
  development-only declaration; no live service, credential, or provider state
  changed.

## 2026-10-31 — idempotent outbound queue foundation

- **Proof:** queue service fetch guard proves no network action; persistence
  stores and compares canonical fingerprints under organization-scoped
  idempotency uniqueness. Integration proof covers duplicate, mismatch,
  organization isolation, and rollback.
- **Operational impact:** none. No live service reads this development source;
  no runtime configuration, credential, provider state, or deployment artifact
  changed.

## 2026-10-31 — allowed-address sender and reply-to policy

- **Proof:** strict parser and repository-level validation enforce an exact
  verified-domain match; a locked transaction plus partial unique index keeps
  default-sender selection organization-scoped and at most one per domain.
  Tests cover Owner access, invalid/foreign inputs, direct repository bypass,
  tenant isolation, and replacement behavior.
- **Operational impact:** none. Source paths only; no live service or runtime
  configuration reads this uncommitted development work.

## 2026-10-31 — provider-authoritative domain verification refresh

- **Decision:** ADR 0005 makes the provider, not the Owner client, the source
  of domain verification state. The Owner may request a refresh only.
- **Proof:** focused fixture, service, and route tests cover no-network
  behavior, Owner authorization, scoped domain lookup, invalid verifier output,
  and unconfigured production composition. The PostgreSQL integration test
  proves foreign organization updates return no domain while a scoped update
  persists `verified`; the database-backed API suite passed 42 tests.
- **Authoritative application paths:** verification policy is
  `apps/api/src/domains/domain-verification-service.ts`; fixture seam is
  `apps/api/src/domains/domain-verification-client.ts`; scoped persistence is
  `apps/api/src/persistence/identity-repository.ts`; HTTP handling is
  `apps/api/src/app.ts`. These are source paths, not runtime configuration;
  they have no mirrors and no live service reads them.
- **Operational impact:** the authoritative development Compose definition is
  `compose.dev.yaml`; its proof stack was removed. No runtime configuration,
  secret, systemd unit, certificate, deployment artifact, or external provider
  state changed.

## 2026-10-31 — organization-safe domain and allowed-recipient persistence hardening

- **Intended outcome:** prevent cross-organization catch-all and
  allowed-recipient bindings, and make verification state enforceable in the
  persistence boundary rather than only in HTTP/service code.
- **Proof:** focused service and route tests cover scoped catch-all rejection
  plus Owner-only route access. A PostgreSQL integration test first reproduced
  acceptance of an address on a pending domain, then passed after the
  repository's atomic eligible-domain/mailbox insert required `verified`.
  The database-backed API suite passed 38 tests; `corepack pnpm verify` and
  `git diff --check` passed.
- **Authoritative application paths:** ownership checks are in
  `apps/api/src/domains/domain-settings-service.ts`; atomic address persistence
  and domain normalization are in
  `apps/api/src/persistence/identity-repository.ts`; API authorization is in
  `apps/api/src/app.ts`. These are source paths, not runtime configuration,
  and no live service reads them. There are no mirrored copies.
- **Limitations:** live Resend domain verification, asynchronous verification
  transitions, provider calls, inbound mail processing, and client settings UI
  remain deferred to subsequent Sprint 2+ slices.
- **Operational impact:** no runtime configuration, secret, systemd unit,
  certificate, deployment artifact, or external provider state changed. The
  proof-only development Compose stack uses ephemeral environment values and
  is removed with its volumes after verification.

## 2026-10-31 — deterministic recipient-routing foundation

- **Intended outcome:** apply the accepted organization/domain and inbound
  routing decisions deterministically before provider integration.
- **Proof:** the test first failed for the absent router; its four cases pass
  for normalized assigned addresses, same local parts on separate domains,
  explicit catch-all/quarantine/discard, and rejection of unverified, foreign,
  malformed, and unknown-domain recipients. `corepack pnpm verify` and
  `git diff --check` passed.
- **Authoritative application paths:** routing behavior is
  `apps/api/src/routing/recipient-router.ts`; behavioral proof is
  `apps/api/test/recipient-routing.test.ts`. Neither path is configured as a
  running service or deployment input.
- **Limitations:** this is a pure policy component. Domain/address persistence,
  configuration routes, provider verification, and webhook integration remain
  pending in their own slices.
- **Operational impact:** no runtime configuration, secret, provider state,
  deployment artifact, or production/staging service changed.

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

## 2026-10-30 — deterministic Resend validation-client fixtures

- **Intended outcome:** establish the first narrow validation seam without
  accepting live credentials, initiating provider requests, or changing
  stored connection state.
- **Proof:** the focused API test first failed for the absent deterministic
  client export, then passed all three tests after implementation. It covers
  successful, unauthorized, transient, unexpected-status, and unmapped-
  credential outcomes and installs a throwing `fetch` guard. `corepack pnpm
verify` passed the secret scan, formatting, linting, type checks, root tests,
  and 19 API tests (four existing database integrations skipped without
  `DATABASE_URL`); `git diff --check` passed.
- **Authoritative application paths:** the contract and fixture-only transport
  are `apps/api/src/settings/resend-validation-client.ts`; their tests are
  `apps/api/test/resend-validation-client.test.ts`. Neither is runtime
  configuration, and no live service reads either path because this application
  has not been deployed. There are no mirrored copies.
- **Limitations:** live Resend transport integration, controlled secret
  decryption, connection-status persistence, API exposure, retries, and audit
  records remain intentionally deferred to independently reviewed slices.
- **Operational impact:** no runtime configuration, secret, systemd unit,
  certificate, deployment artifact, database, or external provider state
  changed.

## 2026-10-30 — Owner-only on-demand connection validation

- **Intended outcome:** make an authenticated Owner able to request a
  redacted, ephemeral validation status for an existing connection without
  exposing its credential or permitting cross-organization envelope access.
- **Proof:** focused service and route tests passed six cases for authorized
  success, unauthorized/transient outcomes, decryption failure, unauthenticated
  access, non-Owner access with zero envelope lookups, and indistinguishable
  missing/foreign `404` responses. The disposable PostgreSQL test run passed
  all 25 API tests and proves the raw envelope query is organization scoped.
  `corepack pnpm verify` and `git diff --check` passed.
- **Authoritative application paths:** the endpoint is in
  `apps/api/src/app.ts`; orchestration is in
  `apps/api/src/settings/connection-validation-service.ts`; the scoped lookup
  is in `apps/api/src/persistence/identity-repository.ts`. These are source
  paths, not runtime configuration, and have no mirrors. The server entrypoint
  intentionally does not compose a validation client, so no deployed service
  reads a live transport configuration.
- **Limitations:** production calls return `VALIDATION_NOT_CONFIGURED` pending
  a separately reviewed live Resend transport composition. Validation status is
  not persisted; audit logging, retries, and provider-error telemetry remain
  deferred.
- **Operational impact:** no runtime configuration, secret, systemd unit,
  certificate, deployment artifact, or external provider state changed. The
  temporary Compose stack used an ephemeral password and was removed with its
  volumes after verification.
