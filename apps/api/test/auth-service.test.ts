import assert from "node:assert/strict";
import test from "node:test";

import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";

const createRepository = (): AuthRepository & {
  passwords: string[];
  sessionHashes: string[];
  setSessionState(input: { expiresAt?: Date; revokedAt?: Date | null }): void;
} => {
  const passwords: string[] = [];
  const sessionHashes: string[] = [];
  let bootstrapped = false;
  let session: {
    id: string;
    userId: string;
    email: string;
    organizationId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null = null;

  return {
    passwords,
    sessionHashes,
    hasOwner: async () => bootstrapped,
    bootstrapOwnerWithPassword: async ({ passwordHash }) => {
      if (bootstrapped) {
        throw new Error("OWNER_ALREADY_BOOTSTRAPPED");
      }

      bootstrapped = true;
      passwords.push(passwordHash);
      return {
        userId: "user-1",
        organizationId: "organization-1",
        email: "owner@example.test",
      };
    },
    findUserForLogin: async () => ({
      userId: "user-1",
      organizationId: "organization-1",
      email: "owner@example.test",
      passwordHash: passwords[0] ?? null,
    }),
    createSession: async ({ tokenHash, expiresAt }) => {
      sessionHashes.push(tokenHash);
      session = {
        id: "session-1",
        userId: "user-1",
        organizationId: "organization-1",
        email: "owner@example.test",
        expiresAt,
        revokedAt: null,
      };
    },
    findSessionByTokenHash: async () => session,
    setSessionState: (input) => {
      if (!session) {
        throw new Error("SESSION_NOT_CREATED");
      }

      session = {
        ...session,
        expiresAt: input.expiresAt ?? session.expiresAt,
        revokedAt: input.revokedAt ?? session.revokedAt,
      };
    },
  };
};

test("bootstrap hashes the password and returns an opaque session without retaining its token", async () => {
  const repository = createRepository();
  const service = new AuthService(repository, {
    now: () => new Date("2026-10-29T00:00:00.000Z"),
    randomToken: () => "opaque-session-token-for-test-only",
    bootstrapToken: "test-bootstrap-token",
  });

  const result = await service.bootstrapOwner({
    email: "Owner@Example.Test",
    organizationName: "NextLevel",
    password: "a long test-only password",
    bootstrapToken: "test-bootstrap-token",
  });

  assert.equal(result.sessionToken, "opaque-session-token-for-test-only");
  assert.equal(result.account.email, "owner@example.test");
  assert.equal(repository.passwords.length, 1);
  assert.notEqual(repository.passwords[0], "a long test-only password");
  assert.equal(repository.sessionHashes.length, 1);
  assert.notEqual(repository.sessionHashes[0], result.sessionToken);
});

test("bootstrap is single-use and session authentication rejects malformed, expired, and revoked tokens", async () => {
  const repository = createRepository();
  const service = new AuthService(repository, {
    now: () => new Date("2026-10-29T00:00:00.000Z"),
    randomToken: () => "opaque-session-token-for-test-only",
    bootstrapToken: "test-bootstrap-token",
  });

  await service.bootstrapOwner({
    email: "owner@example.test",
    organizationName: "NextLevel",
    password: "a long test-only password",
    bootstrapToken: "test-bootstrap-token",
  });

  await assert.rejects(
    service.bootstrapOwner({
      email: "other@example.test",
      organizationName: "Other",
      password: "another long test-only password",
      bootstrapToken: "test-bootstrap-token",
    }),
    /OWNER_ALREADY_BOOTSTRAPPED/,
  );
  assert.equal(await service.authenticateSession("malformed"), null);
  assert.deepEqual(
    await service.authenticateSession("opaque-session-token-for-test-only"),
    {
      userId: "user-1",
      organizationId: "organization-1",
      email: "owner@example.test",
    },
  );
  repository.setSessionState({
    expiresAt: new Date("2026-10-28T23:59:59.000Z"),
  });
  assert.equal(
    await service.authenticateSession("opaque-session-token-for-test-only"),
    null,
  );
  repository.setSessionState({
    expiresAt: new Date("2026-11-29T00:00:00.000Z"),
    revokedAt: new Date("2026-10-29T00:00:00.000Z"),
  });
  assert.equal(
    await service.authenticateSession("opaque-session-token-for-test-only"),
    null,
  );
  assert.equal(
    await service.login({
      email: "owner@example.test",
      password: "the wrong test-only password",
    }),
    null,
  );
});
