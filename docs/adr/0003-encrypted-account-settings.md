# ADR 0003: encrypted account settings

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The application must store Resend API credentials and webhook signing secrets
for multiple organization-owned connections. Those values must never reach the
Expo client, logs, database backups in plaintext, or ordinary support/audit
views. The project is self-hostable, so it cannot assume one hosted key
management provider.

## Decision

Use application-level envelope encryption behind a provider-neutral key
management interface.

- Each secret value is encrypted with a unique random data-encryption key
  (DEK) using an authenticated-encryption algorithm selected by the future
  cryptography implementation ADR/code review.
- The DEK is wrapped by a versioned key-encryption key (KEK) supplied by a
  `KeyManagementProvider` abstraction. The database stores ciphertext,
  nonce/algorithm metadata, wrapped DEK, KEK key ID/version, connection ID,
  and creation/rotation timestamps—never plaintext.
- The active KEK is injected only into the server/worker runtime from a
  deployment-managed secret system. It is not put in `.env.example`, Docker
  Compose, the browser bundle, database, or source control.
- Decryption is permitted only in narrowly scoped server/worker operations
  that need to call Resend or verify a webhook. Settings read APIs expose
  presence, last-four/fingerprint if safe, validation status, and timestamps;
  they never return the stored secret.
- Rotation is dual-read: new writes use the active KEK version; background
  re-encryption updates older records; rollback retains prior KEK access until
  migration proof and backup-retention windows pass.

## Alternatives considered

1. **Plaintext database columns protected only by disk encryption.** Rejected:
   backups, database access, and application bugs would expose credentials.
2. **One application-wide environment encryption key.** Rejected for the
   durable design: it lacks record-level metadata, safe rotation, and a clean
   self-hosted key-management boundary.
3. **Client-side encryption.** Rejected: the client must not possess provider
   credentials, and server-side webhook/send work requires controlled access.
4. **Hard-code a cloud KMS dependency.** Rejected: it breaks self-hosting.
   The interface may have local development and cloud/HSM implementations.

## Consequences

- Sprint 1 persistence includes a secret envelope model and a mock/in-memory
  key-management provider for deterministic tests, not a production key.
- Production setup must explicitly select, configure, back up, and rotate a
  KEK provider before enabling provider connections. This is a deployment
  decision and requires its own configuration inventory and release artifact.
- Credential validation calls use decrypted material only in memory, redact
  errors, and must avoid tracing/logging headers or request bodies.
- Deletion destroys the encrypted envelope and records a redacted audit event;
  it does not promise immediate erasure from encrypted backups.

## Security and operational impact

Compromise of the database alone must not reveal usable credentials; compromise
of both database and active KEK infrastructure remains in scope for incident
response. Access to KEK operations must be least-privilege and attributable.
Key versions, rotation success/failure, decryption errors, and unusual access
rates are security signals, while secret values and plaintext-derived hashes
are never metrics labels.

## Proof plan

- Unit tests will prove encrypt/decrypt round trips, tamper rejection, wrong
  key rejection, and key-version rotation.
- API tests will prove owners can update a connection secret but cannot read it
  back, and unauthorized users cannot create, validate, rotate, or delete it.
- Integration tests will prove database snapshots contain no supplied
  plaintext fixture and that a redacted audit record is produced for every
  privileged secret action.
