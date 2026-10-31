# Active work

## Slice ID

S2.domain-address-persistence

## Next task

Sprint 2 — domain, mailbox, and allowed-recipient persistence

## Acceptance criteria

- Persist organization-scoped domains with globally normalized unique names,
  exactly one connection, and an explicit verification state.
- Persist mailboxes and allowed recipient addresses; each address belongs to
  one verified domain and resolves to one mailbox in the same organization.
- Persist only explicit per-domain fallback policies and enforce their mailbox
  ownership where applicable.
- Provide Owner-only, organization-scoped configuration routes that never
  accept client-selected organization authority.
- Record test-first evidence and all quality-gate results before completion.
- No production-system, secret, deployment, or undocumented architecture change.

## Test-first evidence

- Pending: persistence and route tests will be added before implementation.
