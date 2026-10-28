# ADR 0002: inbound message lifecycle

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Inbound email arrives through provider webhooks, which are untrusted network
input, may be retried, may arrive out of order, and must not expose raw
message content to unauthenticated callers. Routing must support multiple
domains and configured recipient addresses while safely handling unknown
recipients.

## Decision

Inbound processing is an asynchronous, idempotent state machine. The webhook
endpoint performs only raw-body verification, minimal envelope validation,
durable event capture/deduplication, and queue handoff. A worker owns later
provider retrieval, recipient-policy evaluation, thread matching, attachment
processing, and mailbox projection.

```text
raw webhook
  -> verify signature against raw body
  -> validate schema + provider event ID
  -> deduplicate + persist receipt transactionally
  -> enqueue durable work
  -> worker fetches/normalizes permitted message data
  -> recipient policy routes to mailbox | quarantine | discard
  -> persist message/thread projection + audit outcome
```

- Invalid signatures and malformed payloads receive no processing and create
  only a security-safe rejection metric/audit event.
- The event ID and provider/message identifiers are stored with uniqueness
  constraints. Replays are successful no-ops, not duplicate messages.
- The worker retries transient provider/storage failures with bounded,
  observable backoff. Terminal failures are quarantined for an authorized
  operator; they are never silently converted to delivered messages.
- Raw bodies are retained only for the minimum period needed for verification
  diagnostics and never rendered or logged as message content.
- Recipient routing uses the verified envelope recipient, normalized domain,
  and the policy in ADR 0001. It happens before a message becomes visible in a
  mailbox.

## Alternatives considered

1. **Process the whole message synchronously in the webhook request.**
   Rejected: provider retries, attachment retrieval, and scanner delays make
   timeout-driven duplication and availability failures likely.
2. **Trust a parsed framework body for signature verification.** Rejected:
   parsing can alter bytes, invalidating cryptographic verification.
3. **Create a mailbox for every unknown recipient.** Rejected: it enables
   address harvesting and uncontrolled data growth. Unknown-recipient behavior
   must be a visible domain policy.

## Consequences

- The API needs raw-request-body access on the webhook route before any JSON
  parser runs.
- A durable queue/outbox and worker are required before inbound delivery is
  implemented. Queue acknowledgement follows durable receipt, not rendering.
- Message/attachment retrieval is provider-mediated and server-side; clients
  receive only authorized, normalized projections and short-lived download
  access where applicable.

## Security and operational impact

Webhook signing secrets remain server-side and are never logged. Rate limits,
payload-size limits, schema validation, content-type checks, event age policy,
and replay metrics are mandatory. Attachment bytes are stored outside the web
root, scanned before broad availability, and accessed with authorization-aware
short-lived URLs. The webhook route must expose a health-safe response without
revealing routing decisions or account configuration.

## Proof plan

- Fixture tests will cover valid signature delivery, invalid signature
  rejection, malformed payload rejection, event replay, duplicate queue
  delivery, transient retry, terminal quarantine, and out-of-order events.
- Routing tests will cover allowed address, explicit catch-all, quarantine,
  discard, and same-local-part/different-domain cases.
- Authorization tests will prove an event and its resulting message are
  invisible outside the owning organization and mailbox grant.
