# Active work

## Slice ID

mail.send-receive-v1

## Next task

Complete Owner setup of a live Resend connection, verified domain, mailbox,
and allowed sender through the client before beginning inbound delivery.

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

## Executive scope decision

Prioritize a complete basic send/receive vertical slice. Drafts, forwarding,
attachments, rich HTML display, multi-user grants, and production KMS/deployment
remain planned follow-up work. Do not block basic inbox delivery on those
features.
