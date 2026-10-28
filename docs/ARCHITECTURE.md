# Architecture

Resend Mailbox is a standalone system. The Expo client is a universal web,
iOS, and Android application. The API is an independent Fastify service. The
future worker, database, queue, and object storage are separate from every
Property Intelligence runtime component.

Development dependencies are defined in `compose.dev.yaml` and bind only to
loopback addresses. SeaweedFS supplies the S3-compatible development endpoint
on port `19000`; it replaces the unavailable MinIO community image. Copy
`.env.example` to an ignored `.env` and replace every `CHANGE_ME` value before
starting the local services. That Compose file is not a production deployment
artifact. Its host ports deliberately use the `15432`, `16379`, and `19000`
range to avoid colliding with the VPS's existing services.
SeaweedFS is loopback-only and intentionally unauthenticated for local
development; it must not be used as a production object-store configuration.
Production will consume immutable release artifacts and separately managed
configuration/secrets.

Provider keys and webhook secrets remain server-side. The client communicates
only with the application API; it never talks to Resend using account keys.
