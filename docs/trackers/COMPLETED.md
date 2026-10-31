# Completed work

Completed tasks move here from `ACTIVE.md` with the date, commit, acceptance
criteria, verification commands, and concise result. Do not erase history.

## 2026-10-31 — live development Resend outbound delivery

**Outcome:** outbound queue records the selected organization-owned connection,
reply-to address, and bounded plain-text body. A development-only worker
decrypts that connection's credential in memory and sends through Resend's
email API with the queued idempotency key. Provider and credential errors are
reduced to a safe failure outcome.

**Test-first evidence:** the existing transport absence and empty-body red
tests were recorded in `ACTIVE.md`; deterministic transport and API request
fixtures now cover successful mapping, secret nonexposure, absent scoped
connection, provider failure, HTTP failure, and malformed provider response.

**Verification:** `corepack pnpm verify` passed (secret scan, format, lint,
typecheck, repository tests, and API tests: 50 passed, 7 database integration
tests skipped). `corepack pnpm --filter @resend-mailbox/api typecheck` and API
tests passed. `git diff --check` is required before commit. Database-backed
integration tests could not run because the Docker daemon socket denied access.

**Result:** local development can now deliver queued plain-text emails through
an authenticated Resend connection. `worker:dev` requires `NODE_ENV=development`,
`DATABASE_URL`, and a valid development `ENCRYPTION_MASTER_KEY`; it refuses
production startup. No live Resend request, secret, deployment artifact, VPS
runtime configuration, or production service was changed. Production delivery
still requires reviewed KMS and worker runtime composition.

## 2026-10-31 — worker-owned outbound delivery state machine

**Outcome:** a worker atomically claims queued sends once, passes the stored
idempotency key to an injected delivery transport, and persists only safe sent
or failed outcomes.

**Test-first evidence:** focused worker test first failed because the worker
module did not exist.

**Verification:** database-backed API suite passed 52 tests, with a concurrent
claim proof and terminal failure persistence; `corepack pnpm verify`,
formatting, lint, typecheck, and `git diff --check` passed.

**Result:** provider failures record only `provider_unavailable`. Live Resend
SDK composition, credentials, retry policy, and deployment remain separate.
No runtime configuration, secret, provider call, or deployment artifact changed.

## 2026-10-31 — idempotent outbound queue foundation

**Outcome:** added an Owner-only, organization-scoped durable outbound queue
with canonical payload fingerprints; queue creation deliberately performs no
network/provider action.

**Test-first evidence:** focused outbound service test first failed because
the service module was absent.

**Verification:** focused tests, PostgreSQL integration proof for first,
duplicate, mismatch, and cross-organization keys, `corepack pnpm verify`,
typecheck, lint, format, and `git diff --check` passed with independent review.

**Result:** equivalent retries return the same queued send, changed payloads
reuse of the key are rejected, and sender authorization is evaluated before
persistence. Live Resend dispatch remains a worker slice; no secret, provider
call, runtime configuration, or deployment artifact changed.

## 2026-10-31 — allowed-address sender and reply-to policy

**Outcome:** Owner-only address policy now persists normalized same-domain
reply-to values and atomically selects at most one default sender per verified
domain.

**Test-first evidence:** focused service test initially failed because the
policy service module did not exist.

**Verification:** focused service/route tests, database-backed API suite,
`corepack pnpm verify`, typecheck, lint, formatting, and `git diff --check`
passed. Independent test-runner and quality review passed.

**Result:** scoped repository transactions validate reply-to again at the
persistence boundary, lock the domain for default replacement, and reject
foreign/malformed direct calls without writes. No runtime configuration,
secret, provider call, or deployment artifact changed.

## 2026-10-31 — provider-authoritative domain verification refresh

**Outcome:** introduced a safe, provider-independent verification refresh
seam without permitting client-selected domain status or adding a live Resend
call.

**Acceptance criteria met:** Owner-only refresh derives organization from the
session, scopes lookup and status update to that organization, conceals foreign
or missing domains, and returns redacted domain data. Fixture verification is
network-free and accepts only `pending`, `verified`, or `failed`; invalid
output fails closed. Server composition intentionally returns
`DOMAIN_VERIFICATION_NOT_CONFIGURED` until a separately reviewed live provider
transport exists.

**Test-first evidence:** `cd apps/api && node --import tsx --test
test/domain-verification-service.test.ts` initially failed because the service
module did not exist.

**Verification:**

```bash
DATABASE_URL='postgresql://resend_mailbox_test:compose-probe-only@127.0.0.1:15432/resend_mailbox_test' corepack pnpm --filter @resend-mailbox/api test
corepack pnpm verify
git diff --check
```

**Result:** passed. The disposable Compose stack and volumes were removed.
No runtime configuration, secret, live provider call, inbound-mail behavior,
deployment artifact, or production service changed.

## 2026-10-31 — organization-safe domain and allowed-recipient persistence hardening

**Outcome:** completed the active Sprint 2 persistence slice with durable
organization ownership enforcement for catch-all policies and allowed
recipient addresses.

**Acceptance criteria met:**

- Domains are normalized before persistence and retain globally unique names,
  an organization-scoped connection, and an explicit verification state.
- A catch-all fallback is rejected before persistence unless its mailbox is
  found in the authenticated Owner's organization.
- The repository atomically creates an allowed recipient only when both the
  domain and mailbox belong to the organization and the domain is verified;
  direct repository callers cannot bypass that verified-domain boundary.
- Owner-only configuration derives organization authority solely from the
  session; allowed-address route tests cover success, unauthenticated, and
  member-role cases.

**Test-first evidence:**

- The focused domain-service test initially failed its new foreign-mailbox
  case with `Missing expected rejection.` (3 passed, 1 failed) under
  `cd apps/api && node --import tsx --test test/domain-settings-service.test.ts`.
- The database integration regression initially failed with `Missing expected
rejection.` when a pending domain could receive an allowed address under
  `DATABASE_URL='postgresql://resend_mailbox_test:compose-probe-only@127.0.0.1:15432/resend_mailbox_test' node --import tsx --test test/identity-repository.integration.test.ts`
  (4 passed, 1 failed).

**Verification:**

```bash
cd apps/api && node --import tsx --test test/domain-settings-service.test.ts test/domain-settings-routes.test.ts
DATABASE_URL='postgresql://resend_mailbox_test:compose-probe-only@127.0.0.1:15432/resend_mailbox_test' corepack pnpm --filter @resend-mailbox/api test
corepack pnpm verify
git diff --check
```

**Result:** passed. Independent test-runner verification passed the full
database-backed API suite (38 tests); independent quality review was requested
before commit. The temporary development Compose stack and volumes are removed
after verification. No provider call, secret, runtime configuration,
deployment artifact, or production service changed.

## 2026-10-31 — deterministic recipient-routing foundation

**Outcome:** added the provider-independent routing policy required by ADRs
0001 and 0002, without accepting inbound mail or calling Resend.

**Acceptance criteria met:** verified, organization-scoped domains route a
normalized explicit address to exactly one mailbox. Unknown addresses follow
only the configured catch-all, quarantine, or discard policy. Unverified,
foreign, malformed, and unknown-domain recipients are rejected; no mailbox is
created implicitly.

**Test-first evidence:** the focused routing test initially failed because
`recipient-router` did not exist, then passed its four behavior cases.

**Verification:** `corepack pnpm verify` and `git diff --check` passed.

**Result:** passed. Domain persistence, configuration APIs, provider
verification, inbound webhook processing, and client UI remain separate work.

## 2026-10-30 — Owner-only on-demand connection validation

**Outcome:** added a redacted, fixture-backed validation endpoint for an
existing encrypted connection, while retaining the deliberate no-live-provider
boundary.

**Acceptance criteria met:**

- `POST /v1/connections/:connectionId/validate` returns `401` without a valid
  session, `403` for a non-Owner before an envelope lookup, and the same `404`
  for missing or cross-organization connections.
- The service uses an organization-and-connection-scoped repository query,
  decrypts the authorized envelope only in server memory, passes it only to an
  injected validator, and returns only `connected`, `invalid_credentials`, or
  `unavailable`.
- Fixtures cover success, unauthorized, transient provider failure, missing
  connections, and decryption failure. No status is persisted and responses
  never include the credential.
- No live Resend SDK or transport, credential logging, domain configuration,
  mailbox provisioning, invitations, or inbound routing was added.

**Test-first evidence:**

- The initial focused service and route run failed because
  `connection-validation-service` did not exist.
- The focused suite then passed (6 tests), including authorization and
  organization-isolation paths, secret nonexposure, and no-validator-call on
  decryption failure.

**Verification:**

```bash
node --import tsx --test test/connection-validation-service.test.ts test/connection-validation-routes.test.ts
DATABASE_URL='postgresql://resend_mailbox:compose-probe-only@127.0.0.1:15432/resend_mailbox' corepack pnpm --filter @resend-mailbox/api test
corepack pnpm verify
git diff --check
```

**Result:** passed. The database command ran against an isolated disposable
Compose stack, which was removed with its volumes afterward. Production server
composition deliberately leaves validation unwired, returning
`VALIDATION_NOT_CONFIGURED` until a separately reviewed live transport slice.

## 2026-10-30 — deterministic Resend connection-validation contract

**Outcome:** added an injectable, server-side validation contract with
network-free fixtures, while deliberately deferring live provider access and
connection-status persistence.

**Acceptance criteria met:**

- The only public validation results are `connected`, `invalid_credentials`,
  and `unavailable`; callers receive a status, never the credential.
- Deterministic fixtures cover a successful probe, unauthorized response, and
  transient provider failure. Unknown provider statuses fail closed to
  `unavailable`, while an unmapped fixture credential is unauthorized.
- This slice adds no API route, credential decryption, database status write,
  logging, live Resend SDK, or network implementation.

**Test-first evidence:**

- `node --import tsx --test test/resend-validation-client.test.ts` initially
  failed because `DeterministicResendValidationClient` was absent from the
  contract module.
- The same focused command then passed (3 tests), including a global `fetch`
  guard that proves the fixture path performs no network request.

**Verification:**

```bash
node --import tsx --test test/resend-validation-client.test.ts
corepack pnpm verify
git diff --check
```

**Result:** passed. Independent test-runner and quality-watcher review passed
after the final formatting and tracker updates. No runtime configuration,
secret, provider call, database write, or deployment artifact changed.

## 2026-10-28 — repository operating foundation

**Outcome:** established automatic Codex guidance, a durable product plan,
quality gates, trackers, and an ADR convention before application code.

**Acceptance criteria met:**

- Root `AGENTS.md` supplies test-first, security, collaboration, commit, and
  VPS deployment-boundary rules.
- `docs/PLAN.md` defines the standalone product architecture and six detailed
  sprints with exit proof.
- Quality gates and active/completed/outcome trackers exist and are linked
  from the README.

**Verification:**

```bash
git diff --check
test -f AGENTS.md
test -f docs/PLAN.md
test -f docs/QUALITY_GATES.md
test -f docs/trackers/ACTIVE.md
test -f docs/trackers/COMPLETED.md
test -f docs/trackers/OUTCOMES.md
test -f docs/adr/README.md
```

**Result:** passed before commit. No runtime configuration, secrets, services,
or deployment artifacts were changed.

## 2026-10-28 — Sprint 0 scaffold

**Outcome:** created a standalone TypeScript pnpm monorepo with an Expo Router
client, a Fastify API health endpoint, shared contracts, local-only Compose
definition, baseline CI, contributor/security documents, and repeatable
quality scripts.

**Test-first evidence:**

- `node --test tests/foundation.test.mjs` initially failed for the absent
  workspace manifest, required files, and Compose definition.
- The initial full verification exposed a secret scanner that failed on
  untracked files; `tests/scan-secrets.test.mjs` first reproduced that defect
  and now prevents its return.
- The quality review required API health coverage and Compose hardening;
  `apps/api/test/health.test.ts` verifies successful and unsupported-method
  responses, while foundation tests enforce a pinned S3-compatible image and
  no committed service password.

**Verification:**

```bash
corepack pnpm verify
git diff --check
```

**Result:** passed. Docker runtime proof is recorded separately below.

## 2026-10-28 — Docker development-runtime validation

**Outcome:** installed Docker Engine and the Compose plugin, then proved the
development-only Postgres, Redis, and S3-compatible services can start without
touching a live application deployment.

**Acceptance criteria met:**

- Docker Engine `29.1.3` and Docker Compose `2.40.3` are installed and the
  package-managed `docker.service` is active.
- `compose.dev.yaml` passes Compose interpolation/configuration validation.
- PostgreSQL accepted connections on `127.0.0.1:15432`, Redis returned `PONG`
  on `127.0.0.1:16379`, and SeaweedFS returned the S3 bucket-list XML on
  `127.0.0.1:19000` after its initial leader election.
- The unavailable MinIO community image was replaced with the pinned,
  S3-compatible `chrislusf/seaweedfs:3.91` image. Its command starts the
  master, volume, filer, and S3 services.

**Test-first evidence:**

- `node --test tests/foundation.test.mjs` failed when the new health-check and
  loopback-only S3 assertions were introduced, proving the original Compose
  file neither encoded readiness nor protected the S3 host bind.
- The smallest Compose change added the checked S3 health probe and explicit
  loopback mapping; the focused test and the full verification suite then
  passed.

**Verification:**

```bash
node --test tests/foundation.test.mjs
sudo env POSTGRES_PASSWORD=compose-probe-only docker compose -f compose.dev.yaml config --quiet
sudo env POSTGRES_PASSWORD=compose-probe-only docker compose -f compose.dev.yaml up -d --force-recreate --wait --wait-timeout 60
pg_isready -h 127.0.0.1 -p 15432 -U resend_mailbox -d resend_mailbox
redis-cli -h 127.0.0.1 -p 16379 ping
curl --silent --show-error http://127.0.0.1:19000/
```

**Result:** passed. The probe stack and its named test volumes were removed
after validation; no application deployment or credential was created.

## 2026-10-28 — Sprint 1 architecture decisions

**Outcome:** accepted durable, provider-independent decisions for
organization/domain isolation, inbound message processing, and encrypted
provider settings before implementation begins.

**Acceptance criteria met:**

- ADR 0001 defines organization ownership, domain/address/mailbox boundaries,
  membership grants, and organization-scoped data access.
- ADR 0002 defines raw-body signature verification, transactional event
  deduplication, asynchronous processing, explicit recipient policy, retry,
  and quarantine behavior.
- ADR 0003 defines server-only envelope encryption, versioned KEKs, rotation,
  redacted settings APIs/audits, and the deferred production KMS boundary.
- The architecture test requires the three ADRs and their essential security
  boundaries, preventing accidental removal or dilution.

**Test-first evidence:**

- `node --test tests/foundation.test.mjs` first failed because the three ADR
  paths were absent.
- The strengthened ADR-content test then failed because ADR 0001 used the
  overbroad phrase “mutable business record”; it passed after the decision was
  corrected to distinguish organization-owned records from global identities.

**Verification:**

```bash
node --test tests/foundation.test.mjs
corepack pnpm verify
git diff --check
```

**Result:** passed, including independent test-runner and quality-watcher
review. No runtime configuration, credential, provider call, database, or
deployment artifact was created.

## 2026-10-28 — Sprint 1 identity persistence foundation

**Outcome:** added a reversible PostgreSQL identity schema and an
organization-scoped server repository for the first Owner, Resend connection
metadata, and encrypted secret-envelope record.

**Acceptance criteria met:**

- The reversible schema creates global users, organizations, memberships,
  Resend connections, and secret envelopes with role, uniqueness, and foreign
  key constraints. A composite foreign key prevents an envelope from referring
  to a connection in another organization.
- `PostgresIdentityRepository.bootstrapOwner` writes Owner/user/organization/
  membership/connection/envelope data in one transaction. Its read API returns
  redacted connection metadata only; it has no plaintext secret field or read
  operation.
- PostgreSQL integration tests prove organization-scoped lookup isolation,
  duplicate membership rejection, cross-organization envelope rejection, and
  migration rollback for each generated test schema.

**Test-first evidence:**

- `corepack pnpm --filter @resend-mailbox/api test` first failed because the
  `pg` driver and the persistence module did not exist.
- The integration test then exposed two test-harness defects: a pooled-session
  search-path assumption and a missing fixture ID. The harness now starts every
  pool in a generated schema and the negative fixture reaches the composite
  foreign-key constraint.

**Verification:**

```bash
sudo env POSTGRES_PASSWORD=compose-probe-only docker compose -f compose.dev.yaml up -d --wait --wait-timeout 60
DATABASE_URL='postgresql://resend_mailbox:compose-probe-only@127.0.0.1:15432/resend_mailbox' corepack pnpm --filter @resend-mailbox/api test
corepack pnpm --filter @resend-mailbox/api typecheck
corepack pnpm --filter @resend-mailbox/api lint
```

**Result:** passed. Test schemas and the temporary Compose stack/volumes were
removed after validation. No application database is running or initialized.

## 2026-10-29 — Sprint 1 Owner authentication and sessions

**Outcome:** implemented a one-time local Owner bootstrap, scrypt password
hashing, opaque database-backed sessions, and authenticated API session routes.

**Acceptance criteria met:**

- Owner bootstrap requires a server-side `BOOTSTRAP_TOKEN` and is single-use
  through a transaction lock and an `instance_bootstrap` singleton, without
  making owner memberships globally unique across future organizations.
- Passwords are stored only as versioned scrypt hashes; sessions persist only
  SHA-256 token hashes and expiry/revocation metadata.
- `/v1/bootstrap`, `/v1/login`, and `/v1/session` use server-only auth. The
  cookie is `HttpOnly`/`SameSite=Lax`, becomes `Secure` in production, and the
  raw token is never returned in JSON.
- Missing, malformed, invalidly encoded, unknown, expired, revoked,
  wrong-password, and unauthorized-bootstrap cases fail safely. Auth routes
  report unavailable until a database is wired.

**Test-first evidence:**

- The focused service test initially failed because `auth-service` did not
  exist; route tests then failed with `404` before the auth routes existed.
- A malformed percent-encoded cookie first produced `500`; its regression test
  now verifies `401`.
- PostgreSQL integration first exposed a migration-order error, then a
  globally unique owner-role conflict. The final singleton bootstrap table
  preserves the one-instance invariant without blocking future organizations.

**Verification:**

```bash
sudo env POSTGRES_PASSWORD=compose-probe-only docker compose -f compose.dev.yaml up -d --wait --wait-timeout 60
DATABASE_URL='postgresql://resend_mailbox:compose-probe-only@127.0.0.1:15432/resend_mailbox' corepack pnpm --filter @resend-mailbox/api test
corepack pnpm --filter @resend-mailbox/api typecheck
corepack pnpm --filter @resend-mailbox/api lint
```

**Result:** passed. The temporary Compose stack, generated schemas, and named
test volumes were removed after proof. No account, secret, live email, or
deployment service was created.

## 2026-10-30 — encrypted Owner connection settings

**Outcome:** added Owner-only, organization-scoped Resend connection settings
with envelope-encrypted API credentials and redacted connection status reads.

**Acceptance criteria met:**

- `POST /v1/connections` and `GET /v1/connections/:connectionId` require an
  authenticated Owner; unauthenticated requests receive `401` and member-role
  requests receive `403`.
- Each submitted credential is encrypted with a unique AES-256-GCM DEK; the
  database stores ciphertext, nonce, wrapped DEK, key version, and algorithm,
  never plaintext. Responses exclude every secret-bearing field.
- Tampering, wrong KEK material, malformed wrapping data, and absent settings
  wiring fail closed. Database proof confirms the submitted fixture is absent
  from persisted envelope fields.
- The local development server wires settings only when `NODE_ENV=development`
  and a valid `ENCRYPTION_MASTER_KEY` is provided. Production remains disabled
  pending a separately reviewed KMS provider.

**Test-first evidence:**

- The API suite initially failed because both settings modules were absent.
- The development-key test exposed non-canonical base64url acceptance; strict
  decoding now rejects the malformed wrapping data.

**Verification:**

```bash
corepack pnpm verify
sudo env POSTGRES_PASSWORD=compose-probe-only docker compose -f compose.dev.yaml up -d --wait --wait-timeout 60
DATABASE_URL='postgresql://resend_mailbox:compose-probe-only@127.0.0.1:15432/resend_mailbox' corepack pnpm --filter @resend-mailbox/api test
sudo env POSTGRES_PASSWORD=compose-probe-only docker compose -f compose.dev.yaml down --volumes --remove-orphans
git diff --check
```

**Result:** passed, including independent test-runner and quality review. The
test stack and its volumes were removed. No Resend API request, account,
domain, live runtime configuration, or deployment artifact was created.
