# ADR 0004: Owner authentication and sessions

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The initial self-hosted instance needs one secure Owner without requiring a
hosted identity provider. The model must avoid exposing provider credentials,
raw passwords, or reusable session tokens, while remaining compatible with
future employee invitations and external identity providers.

## Decision

Use a local password only for the one-time Owner bootstrap and login. Bootstrap
also requires a server-side, one-time `BOOTSTRAP_TOKEN`, submitted in the
`X-Bootstrap-Token` header; without it, bootstrap is unavailable. Deployment
operators must remove or rotate that secret after successful bootstrap. Hash
the password with Node's memory-hard scrypt implementation and a unique random
salt; store the versioned hash only. Sessions use a cryptographically random,
opaque token. The browser receives that token only in an `HttpOnly`,
`SameSite=Lax` cookie; the server database stores only a SHA-256 token hash,
expiration, revocation timestamp, and user relationship.

The `instance_bootstrap` singleton records the initial Owner separately from
organization membership roles. A transaction advisory lock plus the singleton
constraint makes bootstrap single-use while still allowing future organizations
to have their own owner memberships. Production cookies add `Secure` when
`NODE_ENV=production`.

## Alternatives considered

1. **Raw bearer tokens or JWTs in browser storage.** Rejected: token exposure
   to browser JavaScript and difficult revocation are unnecessary for the
   initial server-rendered/API session model.
2. **Hosted identity provider as a prerequisite.** Rejected: it conflicts with
   self-hosting and the current single-Owner requirement.
3. **A globally unique `owner` membership role.** Rejected: it breaks future
   multi-organization ownership. The singleton bootstrap record expresses the
   real instance-level invariant.

## Consequences

- Password reset, MFA, session revocation UI, employee invitations, and SSO
  are deferred and require a superseding or complementary ADR.
- The API has no usable auth path until a database connection and identity
  schema are configured; it returns `AUTH_NOT_CONFIGURED` rather than silently
  accepting requests.
- Authentication logs must not include request bodies, cookies, passwords,
  bootstrap tokens, or raw session tokens. Credential failures share a generic
  response. `BOOTSTRAP_TOKEN` is a deployment-managed secret, never a client
  setting or committed environment file.

## Proof plan

- Unit tests prove raw passwords and raw session tokens are not retained,
  malformed/expired tokens are rejected, and incorrect passwords fail.
- Route tests prove the token is absent from JSON and uses an `HttpOnly`,
  `SameSite=Lax` cookie; bootstrap without the server token is rejected and
  missing/malformed cookies receive `401`.
- PostgreSQL integration tests prove the singleton bootstrap, password-hash
  persistence, hash-only session lookup, and migration rollback.
