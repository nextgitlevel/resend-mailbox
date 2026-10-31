# ADR 0005: domain verification authority

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Domain routing is safe only after the sending provider has verified control of
the domain. An Owner can configure a domain, but must not be able to assert a
verified state through a client-supplied status field.

## Decision

Domain verification status is provider-authoritative. An Owner may request a
server-side refresh for an organization-scoped domain; an injected verifier
returns only `pending`, `verified`, or `failed`. The service persists that
result atomically for the scoped domain and returns redacted domain data.

The HTTP request carries no status, provider credential, or organization ID.
Production server composition leaves refresh unavailable until a separately
reviewed live Resend verifier is supplied. Deterministic fixture verifiers are
permitted for tests and perform no network I/O.

## Alternatives considered

1. **Owner-set verification status.** Rejected: it could activate routing for
   an unverified domain.
2. **Browser calls to Resend.** Rejected: provider credentials must remain
   server-side.
3. **Add a live SDK transport now.** Rejected: the provider boundary needs
   fixture-backed behavior and separate credential/deployment review first.

## Consequences

- A refresh endpoint is Owner-only and conceals foreign/missing domains.
- Repository updates must include organization scope and validate status.
- Future live verifier composition owns controlled credential decryption and
  must be reviewed with provider transport, audit, and retry behavior.

## Security and operational impact

No client can mark a domain verified. Provider credentials and responses are
never returned or logged. This ADR creates no runtime configuration; the
authoritative future configuration remains the server-side deployment
composition, with no mirrored copy introduced here.

## Proof plan

- Fixture tests prove no network access and fail-closed invalid verifier
  output.
- Service and route tests prove Owner authorization, organization isolation,
  unavailable composition, and redacted transition results.
- PostgreSQL integration tests prove scoped persistence updates.
