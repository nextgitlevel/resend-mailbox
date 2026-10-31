# Active work

## Slice ID

S3.outbound

## Next task

Sprint 3 — build a responsive authenticated compose and delivery-status view
that submits to the existing API and gives clear retry/failure feedback.

## Acceptance criteria

- Owner can compose plain-text mail, select only a configured sender, and
  submit it with a fresh idempotency key and active session cookie.
- Show queued send status and poll the safe status endpoint until sent or
  failed; explain unknown outcome without inviting blind resends.
- Handle unauthenticated, unauthorized sender, validation, network, and
  provider failure states without exposing credentials.
- Keep web layout useful on desktop and mobile; no attachment or rich HTML
  support until the corresponding server-side security work is approved.
- Component tests cover successful submission, idempotent request key, status
  transitions, and user-visible errors; no network in tests.

## Completed implementation slice

- Development-only Resend transport and worker are implemented and tested.
- Production KMS/worker composition remains intentionally disabled.
- Verification: `corepack pnpm verify` passed; database integration was
  skipped because the Docker daemon socket denied access.

## Test-first evidence for this task

- Red: `cd apps/api && node --import tsx --test
test/outbound-delivery-worker.test.ts` failed when the attempt limit was
  temporarily set to four; the bounded-retry test detected premature
  exhaustion. Restored the intended five-attempt limit, which the test covers.
- `corepack pnpm verify` passed after implementing bounded retry/status behavior
  (API: 54 passed, 8 PostgreSQL tests skipped). `git diff --check` passed.
