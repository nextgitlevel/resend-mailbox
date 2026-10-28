# Completed work

Completed tasks move here from `ACTIVE.md` with the date, commit, acceptance
criteria, verification commands, and concise result. Do not erase history.

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
