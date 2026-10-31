# Active work

## Slice ID

S4.inbound-message-storage

## Next task

Sprint 3 — make outbound delivery recoverable and visible with bounded retries,
persisted attempt state, and an Owner-scoped send status endpoint.

## Acceptance criteria

- A claimed send has a bounded lease/attempt policy so process interruption
  does not strand it permanently; a retry always reuses the same provider
  idempotency key.
- Persist attempt count and next-attempt time; retry only transient failures
  with bounded exponential backoff and jitter, and fail terminally at the cap.
- Expose safe organization-scoped status for a send without provider secrets
  or raw provider errors.
- Tests cover retry timing/cap, duplicate provider idempotency, interruption
  recovery, non-retryable errors, status authorization, and no live network.
- Document at-most-once/at-least-once tradeoffs and provider idempotency window.

## Completed implementation slice

- Development-only Resend transport and worker are implemented and tested.
- Production KMS/worker composition remains intentionally disabled.
- Verification: `corepack pnpm verify` passed; database integration was
  skipped because the Docker daemon socket denied access.
