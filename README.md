# Resend Mailbox

An unofficial, self-hostable, multi-domain email client built for a user’s own
Resend account. It is independent of the NextLevel Property Intelligence
system.

## Project documentation

- [Operating rules for Codex and contributors](AGENTS.md)
- [Product and delivery plan](docs/PLAN.md)
- [Quality gates](docs/QUALITY_GATES.md)
- [Active work tracker](docs/trackers/ACTIVE.md)
- [Completed-work tracker](docs/trackers/COMPLETED.md)
- [Outcome and proof log](docs/trackers/OUTCOMES.md)
- [Architecture decision records](docs/adr/README.md)

The development API supports Owner-managed Resend connections, verified
domains and allowed senders, plus a durable idempotent plain-text outbound
queue. For local development only, `corepack pnpm --filter @resend-mailbox/api
worker:dev` starts the Resend delivery worker when `DATABASE_URL` and a valid
`ENCRYPTION_MASTER_KEY` are configured. Queueing through the API requires an
authenticated Owner session and an allowed sender address. The worker uses
the connection selected for that sender and sends with the queued idempotency
key. Provider credentials are decrypted in worker memory and never returned
to clients.

This worker refuses to start outside `NODE_ENV=development`. Production use
requires a reviewed KMS implementation and deployment-managed key/runtime
configuration. Do not use development key management for production data.
