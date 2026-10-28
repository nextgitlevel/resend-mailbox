# Resend Mailbox — agent operating rules

## Product and deployment boundary

Resend Mailbox is an independent, self-hostable, open-source email client for
Resend. It is **not** part of the Property Intelligence system and must not
share its runtime, database, environment files, services, domains, release
directories, credentials, or deployment pipeline.

This checkout (`/home/mongleadmin/workspaces/resend-mailbox`) is a VPS
development workspace only. It must never be a required runtime, build, or
deployment input. A future deployment must consume an immutable, traceable
release artifact produced from a commit.

## Read first

Before changing code, read these files in order:

1. `README.md`
2. `docs/PLAN.md`
3. `docs/QUALITY_GATES.md`
4. `docs/trackers/ACTIVE.md`
5. `docs/trackers/COMPLETED.md`

Update the trackers as part of every task. Do not begin a new implementation
while `ACTIVE.md` has a different unresolved task unless the user explicitly
replaces it.

## Test-first implementation protocol

Every behavior change follows red → green → refactor:

1. State the acceptance criteria in `ACTIVE.md`.
2. Write one or more focused tests that fail for the missing behavior.
3. Run those tests and record the failing command/result in `ACTIVE.md`.
4. Implement the smallest safe change that makes the tests pass.
5. Run focused tests, then the applicable full suite, type checks, linting,
   formatting, and security checks.
6. Record commands, outcomes, and residual risk in `COMPLETED.md` and
   `OUTCOMES.md`.
7. Commit only after every required gate passes and only include deliberate,
   task-scoped files in that commit.

Never weaken, delete, skip, or rewrite a test merely to make a failing suite
green without explicit user approval and documented rationale. A bug fix must
include a regression test. A new feature must include success, authorization,
and error-path coverage where relevant.

## Security rules

- Never commit API keys, webhook signing secrets, encryption keys, passwords,
  private certificates, production data, or `.env` files.
- Keep all provider credentials server-side. The browser and mobile client must
  never receive Resend API keys or webhook secrets.
- Treat inbound email, HTML, headers, attachments, and webhook payloads as
  untrusted input. Verify webhook signatures against the raw body before
  parsing; validate and deduplicate every event.
- Enforce organization and mailbox authorization on every API operation.
- Use parameterized database access, allowlisted sender identities, idempotent
  outbound delivery, and auditable privileged actions.
- Do not log credentials, full raw email bodies, attachment contents, or
  personally identifiable data unless a documented, access-controlled audit
  purpose requires it.

## Required collaboration roles

When collaboration tools are available, use these independent roles for any
non-trivial implementation. A role may not approve its own work.

| Role | Responsibility | May edit production code? |
| --- | --- | --- |
| Implementer | Owns the scoped implementation and its focused tests. | Yes |
| Test runner | Runs prescribed focused and full verification; reports exact commands and raw result summary. | No |
| Quality watcher | Reviews diff for security, test adequacy, types, lint, formatting, docs, migrations, and deployment risks. | No |
| Commit steward | Confirms clean scope, tracker evidence, and passing gates; creates the task commit. | No, except tracker/commit metadata |

For small documentation-only changes, the implementer may also act as test
runner. For application changes, keep test runner and quality watcher
independent. The commit steward must not commit if any gate is missing,
failing, or unrecorded.

## Quality and commit gate

The authoritative gate list is `docs/QUALITY_GATES.md`. At minimum, a commit
requires a clean targeted test result, relevant full-suite result, lint/type
results, tracker updates, and `git diff --check`. Do not commit unrelated
existing worktree changes. Use conventional commit messages.

## Operational-change reporting

Whenever creating, moving, or changing runtime configuration, secrets,
systemd units, certificates, deployment artifacts, or other operational state,
report the authoritative path, every mirrored copy/symlink, and which path the
live service reads. Do not make VPS runtime changes from this development
checkout.
