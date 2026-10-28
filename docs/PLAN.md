# Resend Mailbox plan

## Vision

Resend Mailbox is an unofficial, self-hostable, multi-domain email client
designed for a user’s own Resend account. Version one serves a single Owner;
the architecture supports future organizations, employees, roles, independent
mailboxes, and separate domains without changing the security model.

## Product principles

- Standalone from all NextLevel Property Intelligence systems.
- Server-side provider credentials only.
- One account can manage multiple Resend connections and domains.
- An allowed-recipient address maps to a mailbox; unknown recipients use an
  explicit quarantine or discard rule.
- Self-hosting and operational clarity are first-class features.
- Web is the primary desktop experience; Expo clients provide web, iOS, and
  Android delivery with platform-specific UI where needed.

## Target architecture

```text
Expo web / iOS / Android client
              |
              v
Independent authenticated API
  |        |          |         |
Postgres  worker     storage   Resend API/webhooks
```

The API owns authentication, role checks, encryption, inbox data, event
deduplication, and audit history. A worker handles outbound sends, inbound
event processing, attachment retrieval/scanning, and retries. Object storage
holds attachments outside the web root.

## Sprint plan

### Sprint 0 — repository and engineering foundation

**Goal:** establish a safe, reproducible, contributor-friendly project.

- Monorepo layout and documented toolchain.
- License, contribution, security, code-of-conduct, and architecture docs.
- CI for tests, types, lint, formatting, dependency/security checks.
- Development-only Docker Compose for Postgres, object storage, and queue.
- Test fixtures and test-first workflow.

**Exit proof:** clean clone can install dependencies, run checks, and start
local dependencies without external credentials.

### Sprint 1 — identity, organizations, and secure settings

**Goal:** one Owner can securely configure a standalone instance.

- Owner bootstrap and authenticated sessions.
- Organization, user, membership, role, and audit data model.
- Encryption-at-rest abstraction for provider credentials.
- Settings UI for Resend connections; validation without exposing stored keys.
- Account/device session management.

**Exit proof:** an Owner creates an organization and connection, persists an
encrypted key, and an unauthorized user cannot read or modify it.

### Sprint 2 — domains, addresses, and routing policy

**Goal:** configure multiple domains and separate mailboxes.

- Domain setup/verification status.
- Allowed-recipient address creation, ownership, default sender, and reply-to.
- Mailbox assignment and per-domain catch-all/quarantine/discard policy.
- UI for `marcus@...`, `support@...`, and future independent-domain inboxes.

**Exit proof:** a domain/address policy produces deterministic mailbox routing
and rejects or quarantines unauthorized recipients.

### Sprint 3 — reliable outbound email

**Goal:** send secure, traceable mail.

- Compose, drafts, attachments, replies, and forwarding.
- Thread/message model and sender allowlist.
- Idempotent queued sends, retries, delivery events, and audit records.
- Desktop-first web compose UI plus mobile compose flow.

**Exit proof:** duplicate requests do not send duplicate mail; delivery failure
and retry states are visible; an unassigned sender cannot send.

### Sprint 4 — inbound email and attachments

**Goal:** receive, validate, and organize incoming email.

- Signature-verified Resend webhook endpoint using raw-body verification.
- Event deduplication, mailbox routing, thread matching, and replay safety.
- Attachment retrieval, type/size policy, malware-scan interface, and object
  storage access controls.
- Inbox, thread, unread/archive/trash/quarantine views.

**Exit proof:** fixture-backed webhook tests prove valid delivery, invalid
signature rejection, duplicate-event safety, and allowed-recipient routing.

### Sprint 5 — client experience

**Goal:** make daily email work excellent on every intended device.

- Desktop web three-pane inbox, keyboard shortcuts, search, and safe HTML
  preview.
- Expo iOS/Android list-detail flow, attachment picker, push notifications,
  and encrypted local session storage.
- Domain/mailbox switcher for same-device separation.
- PWA installation and offline-read cache policy.

**Exit proof:** responsive and accessibility checks pass; web and native views
show only assigned mailbox data.

### Sprint 6 — multi-user, operations, and public release

**Goal:** support employees and outside contributors safely.

- Invites, roles, mailbox grants, and admin audit views.
- Retention, export, backup/restore, health endpoints, metrics, alerts.
- Immutable release artifact, deployment documentation, and self-hosting guide.
- Threat model, security disclosure process, release checklist, and demo data.

**Exit proof:** a second user accesses only assigned mailboxes; a clean
self-hosted deployment completes documented setup and passes health checks.

## Non-goals for the first release

- Acting as an SMTP server or replacing Resend.
- End-to-end encryption of external SMTP email.
- Automatic catch-all acceptance without a visible policy.
- Direct browser/mobile access to Resend API keys.
- Dependency on Property Intelligence runtime or data.
