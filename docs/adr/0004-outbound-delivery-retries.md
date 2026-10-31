# ADR 0004: outbound delivery retries and status

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The worker can stop after claiming a message or after Resend accepts an email
but before the local sent state is committed. Permanent claims strand mail;
blind retries can duplicate mail if the provider no longer remembers the
idempotency key.

## Decision

- Use Postgres as the durable queue. A claim increments an attempt counter and
  records a 120-second lease. Expired claims can be reclaimed with the same
  payload and idempotency key.
- Retry timeouts, HTTP 408/425/429/5xx, Resend's concurrent idempotency conflict
  (409), and other transport exceptions. Treat other 4xx responses and
  credential decryption failures as terminal without persisting provider text.
- Retry up to five claims using exponential delay starting at one second,
  capped at 60 seconds, with 0.5–1.5 random jitter.
- Resend documents a 24-hour idempotency-key retention window. After a send has
  been attempted, do not retry it once its queue age reaches 24 hours. Mark it
  `delivery_outcome_unknown` for owner reconciliation. This starts the local
  stop window at queue creation, earlier than the first provider attempt, to
  avoid depending on an unavailable exact provider-acceptance timestamp.
- Expose only organization-scoped status, attempt count, timestamps, and a
  small failure enum through the authenticated API. Provider response bodies,
  credentials, message bodies, and headers are not status fields.

## Consequences

Delivery is at-least-once within the provider's idempotency retention window;
the stable Resend idempotency key protects retries during that window. Once
the outcome is unknown, automation stops rather than risking an automatic
duplicate. The Owner must reconcile that message before deciding whether to
create a new send. A bounded queue age can fail a message that had not yet
reached the provider if its first attempt occurs late; this is a deliberate
conservative tradeoff.

## Source

Resend documents a 24-hour key retention period and same-key/same-payload
requirements in [Idempotency Keys](https://resend.com/changelog/idempotency-keys).
