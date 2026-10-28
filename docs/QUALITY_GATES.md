# Quality gates

## Definition of done

A task is done only when its acceptance criteria are met, its evidence is
recorded, and all applicable gates below pass. “It builds on my machine” is
not sufficient evidence.

## Required sequence

1. Add acceptance criteria to `docs/trackers/ACTIVE.md`.
2. Add a failing test that demonstrates the required behavior is absent.
3. Run and record the red test result.
4. Implement the narrowest solution.
5. Run focused tests.
6. Run applicable repository-wide tests and static checks.
7. Obtain independent test-runner and quality-watcher results for application
   changes.
8. Record evidence in `COMPLETED.md` and `OUTCOMES.md`.
9. Create one scoped conventional commit and push it to the configured
   upstream. Do not report the task complete until the push succeeds.

## Gate matrix

| Change type                  | Required evidence                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Documentation                | Link/format validation, `git diff --check`, manual review                                                                       |
| UI/client                    | Failing behavior test, component/unit tests, type check, lint, accessibility review, responsive web/native check where affected |
| API                          | Failing route/service tests, authz and validation tests, type/lint, integration test                                            |
| Database/migration           | Failing persistence test, migration up/down or equivalent validation, tenant/org isolation test, rollback note                  |
| Webhook/provider integration | Fixture-based signature, idempotency, retry, invalid-payload, and provider-error tests; never require live credentials in CI    |
| Security-sensitive change    | Threat-model note, negative authorization tests, secret scan, independent quality review                                        |
| Deployment artifact          | Reproducible build, artifact identity/version, configuration inventory, startup and health probes                               |

## Minimum command set

Until tooling is scaffolded, record `NOT YET CONFIGURED` rather than inventing
commands. Once present, run the project scripts rather than ad-hoc substitutes:

```bash
git diff --check
git status --short
# Future commands, once configured:
# pnpm test
# pnpm lint
# pnpm typecheck
# pnpm format:check
# pnpm test:e2e
```

## Test design requirements

- Tests name the user-visible behavior and precondition.
- Prefer deterministic fixtures; no network, clock, or production dependency.
- Test success and expected failure paths.
- Test authorization boundaries for every data access route.
- Use provider fixtures for Resend webhooks and API responses.
- Assert idempotency for sends and inbound events.
- A test that only asserts implementation details is not sufficient.

## Commit protocol

Before committing, the commit steward must verify:

- The diff contains only task-scoped work.
- No secret or environment file is staged.
- All required checks are recorded as passing.
- `ACTIVE.md` is cleared or advanced, and outcomes are recorded.
- The commit message follows Conventional Commits, for example
  `docs: establish project operating rules`.
- `git push` completes successfully for the task branch.

Never force-push, rewrite shared history, or commit generated secrets.
