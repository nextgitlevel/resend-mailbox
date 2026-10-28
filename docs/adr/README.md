# Architecture decision records

Create one numbered ADR for every durable technical or product decision that
would be costly to reverse: client architecture, authentication, encryption,
database isolation, attachment storage, queueing, webhook verification,
licensing, or deployment model.

Each ADR records context, decision, alternatives, consequences, security and
operational impact, and the related test/proof plan. ADRs are immutable after
acceptance; supersede them with a new ADR rather than rewriting history.

## Accepted decisions

- [0001 — Tenant and domain isolation](0001-tenant-and-domain-isolation.md)
- [0002 — Inbound message lifecycle](0002-inbound-message-lifecycle.md)
- [0003 — Encrypted account settings](0003-encrypted-account-settings.md)
