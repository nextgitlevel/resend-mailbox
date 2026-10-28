# ADR 0001: tenant and domain isolation

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Version one has one Owner, but Resend Mailbox must later support employees,
multiple Resend connections, and unrelated domains without redesigning the
authorization model. An email address alone is not an adequate ownership
boundary: the same local part may occur on multiple domains and a connection
can serve multiple domains.

## Decision

The organization is the top-level authorization boundary. Every
organization-owned record carries `organization_id`; all application queries
and writes must scope to the authenticated actor's organization. Global
identity records, such as a user record, are not organization-owned and are
reached only through an organization-scoped membership.

Within an organization, ownership is explicit and directional:

```text
organization -> connection -> domain -> mailbox address -> mailbox
organization -> user -> membership/role -> mailbox grant
```

- A Resend connection belongs to one organization and is never shared across
  organizations.
- A domain belongs to exactly one connection and organization. Domain names
  have a global normalized uniqueness constraint to avoid ambiguous inbound
  routing.
- An allowed recipient address belongs to one verified domain and resolves to
  one mailbox. Catch-all, quarantine, and discard are domain policies, not
  implicit behavior.
- Mailboxes belong to one organization. A user sees a mailbox only through a
  membership plus an explicit mailbox grant (or a narrowly defined owner/admin
  privilege).
- Every request receives an organization context derived from the server-side
  session. Client-supplied organization, connection, domain, or mailbox IDs
  are selectors to validate, never authorities to trust.

## Alternatives considered

1. **Single-account schema, add tenancy later.** Rejected: retrofitting
   organization filters into messages, events, attachments, and audits is
   high-risk and can expose mailbox data.
2. **One database/schema per organization.** Deferred: strong isolation but
   disproportionate operational overhead for the initial self-hosted product.
   It remains a possible enterprise deployment option behind a future ADR.
3. **Domain as the top-level tenant.** Rejected: one Resend account can manage
   several domains, and employees need controlled access across selected
   mailboxes rather than every domain.

## Consequences

- Persistence repositories require organization-scoped methods; unscoped
  general lookup methods are prohibited for tenant-owned data.
- Unique indexes and foreign keys must include or validate organization
  ownership where they cross tenant-owned records.
- Audit records store organization, actor, target type/id, action, and a
  redacted metadata summary.
- Organization transfer, cross-organization sharing, and automatic catch-all
  acceptance are out of scope until separately designed.

## Security and operational impact

Authorization is enforced at the API/service boundary and again in persistence
queries; UI filtering is not a security control. Logs and metrics use opaque
identifiers, not email content or provider credentials. Database backups must
be encrypted and access-controlled because row isolation does not protect a
stolen backup.

## Proof plan

- Repository tests will require an organization filter for every tenant-owned
  repository operation.
- API tests will prove a member cannot read, modify, or enumerate another
  organization's connections, domains, mailboxes, messages, or audit records.
- Routing tests will prove identical local parts on distinct domains resolve
  independently and unknown recipients follow the explicit domain policy.
