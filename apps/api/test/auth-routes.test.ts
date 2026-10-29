import assert from "node:assert/strict";
import test from "node:test";

import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";
import { buildApp } from "../src/app.js";

const createAuthService = () => {
  let bootstrapped = false;
  let passwordHash: string | null = null;
  let tokenHash: string | null = null;

  const repository: AuthRepository = {
    hasOwner: async () => bootstrapped,
    bootstrapOwnerWithPassword: async (input) => {
      bootstrapped = true;
      passwordHash = input.passwordHash;
      return {
        userId: "user-1",
        organizationId: "organization-1",
        email: input.email,
      };
    },
    findUserForLogin: async () => ({
      userId: "user-1",
      organizationId: "organization-1",
      email: "owner@example.test",
      passwordHash,
    }),
    createSession: async (input) => {
      tokenHash = input.tokenHash;
    },
    findSessionByTokenHash: async (candidate) => {
      if (candidate !== tokenHash) {
        return null;
      }

      return {
        userId: "user-1",
        organizationId: "organization-1",
        email: "owner@example.test",
        expiresAt: new Date("2026-11-29T00:00:00.000Z"),
        revokedAt: null,
      };
    },
  };

  return new AuthService(repository, {
    now: () => new Date("2026-10-29T00:00:00.000Z"),
    randomToken: () => "opaque-session-token-for-route-test-only",
    bootstrapToken: "test-bootstrap-token",
  });
};

test("bootstrap sets an HttpOnly session cookie without returning its token", async (t) => {
  const app = buildApp({ authService: createAuthService() });
  t.after(() => app.close());

  const payload = {
    email: "owner@example.test",
    organizationName: "NextLevel",
    password: "a long test-only password",
  };
  const unauthorized = await app.inject({
    method: "POST",
    url: "/v1/bootstrap",
    payload,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/bootstrap",
    headers: { "x-bootstrap-token": "test-bootstrap-token" },
    payload,
  });

  assert.equal(unauthorized.statusCode, 403);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), {
    account: {
      userId: "user-1",
      organizationId: "organization-1",
      email: "owner@example.test",
    },
  });
  assert.equal(
    response.body.includes("opaque-session-token-for-route-test-only"),
    false,
  );
  const setCookie = readHeaderValue(response.headers["set-cookie"]);

  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const session = await app.inject({
    method: "GET",
    url: "/v1/session",
    headers: { cookie: setCookie },
  });

  assert.equal(session.statusCode, 200);
  assert.deepEqual(session.json(), {
    account: {
      userId: "user-1",
      organizationId: "organization-1",
      email: "owner@example.test",
    },
  });
});

const readHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

test("session endpoint rejects an absent or malformed cookie", async (t) => {
  const app = buildApp({ authService: createAuthService() });
  t.after(() => app.close());

  const absent = await app.inject({ method: "GET", url: "/v1/session" });
  const malformed = await app.inject({
    method: "GET",
    url: "/v1/session",
    headers: { cookie: "resend_mailbox_session=malformed" },
  });
  const invalidEncoding = await app.inject({
    method: "GET",
    url: "/v1/session",
    headers: { cookie: "resend_mailbox_session=%" },
  });
  const unknownToken = await app.inject({
    method: "GET",
    url: "/v1/session",
    headers: {
      cookie:
        "resend_mailbox_session=unknown_session_token_that_is_long_enough_123",
    },
  });

  assert.equal(absent.statusCode, 401);
  assert.equal(malformed.statusCode, 401);
  assert.equal(invalidEncoding.statusCode, 401);
  assert.equal(unknownToken.statusCode, 401);
});
