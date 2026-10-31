# Active work

## Slice ID

mail.send-receive-v1

## Current task

Finish the full Owner setup and plain-text receive vertical slice. The send
path is in place; setup is now available in the client. Next implement durable
inbound event processing, message retrieval, inbox APIs, and inbox UI.

## Acceptance criteria

- Complete a usable plain-text send flow with authenticated Owner session,
  verified configured sender selection, stable idempotent queueing, bounded
  provider retries, and safe delivery status.
- Receive `email.received` only after raw-body signature verification; dedupe
  provider event IDs and route only to verified configured recipient addresses.
- Retrieve the full received message from Resend through the correct
  organization-owned connection, persist it, and expose mailbox-scoped inbox
  list/detail APIs and UI.
- Cover invalid signatures, malformed events, duplicates, unknown/unverified
  recipients, foreign organizations, Resend errors, and no-network fixtures.
- Keep provider credentials server-side. Do not fetch/store attachments or
  render untrusted HTML in this vertical slice.
- The client must work on desktop web and remain usable on mobile widths.

## Completed send-side work

- Development-only Resend delivery worker, retry state machine, Owner-scoped
  status endpoint, exact-origin credentialed CORS, safe sender listing, and
  responsive Expo compose/sign-in view are implemented.
- The browser API client uses HttpOnly session cookies and retains the same
  idempotency key for an ambiguous network retry while the page remains open.
- Production KMS/worker composition remains intentionally disabled.

## Completed setup work

- Owner settings routes and client setup now list/create/replace encrypted
  Resend connections, validate credentials against Resend, create mailboxes,
  add existing Resend domains, refresh provider-owned verification status, and
  create allowed addresses only on verified domains.
- Focused tests first failed because the live domain verification transport
  was absent; the transport, settings routes, client API, and setup UI were
  then implemented with fixture-only provider tests.
- Full verification passed after formatting. API tests: 63 passed, 8 database
  integration cases skipped; client tests: 4 passed. Docker-backed PostgreSQL
  tests still need a runnable daemon.

## Executive scope decision

Prioritize a complete basic send/receive vertical slice. Drafts, forwarding,
attachments, rich HTML display, multi-user grants, and production KMS/deployment
remain planned follow-up work. Do not block basic inbox delivery on those
features.
