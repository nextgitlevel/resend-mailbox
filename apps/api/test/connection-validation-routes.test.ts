import assert from "node:assert/strict";
import test from "node:test";

import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";
import { buildApp } from "../src/app.js";
import { ConnectionValidationService } from "../src/settings/connection-validation-service.js";
import { CredentialEncryptionService } from "../src/settings/credential-encryption.js";
import { DevelopmentKeyManagementProvider } from "../src/settings/development-key-management.js";
import {
  FixtureResendValidationClient,
  resendValidationFixtures,
} from "../src/settings/resend-validation-client.js";

const createAuthService = (role: "owner" | "member" = "owner") => {
  const repository: AuthRepository = {
    hasOwner: async () => true,
    bootstrapOwnerWithPassword: async () => {
      throw new Error("NOT_USED");
    },
    findUserForLogin: async () => null,
    createSession: async () => {},
    findSessionByTokenHash: async () => ({
      userId: "owner-1",
      organizationId: "organization-1",
      email: "owner@example.test",
      role,
      expiresAt: new Date("2026-11-29T00:00:00.000Z"),
      revokedAt: null,
    }),
  };
  return new AuthService(repository, { randomToken: () => "session-hash" });
};

const sessionCookie =
  "resend_mailbox_session=opaque-session-token-for-route-test-only";

test("Owner validation route returns only a redacted fixture status", async (t) => {
  const credential = "route_credential_must_not_appear_in_response";
  const keyManagement = DevelopmentKeyManagementProvider.fromBase64Url(
    Buffer.alloc(32, 9).toString("base64url"),
  );

  if (!keyManagement) {
    throw new Error("test key fixture must be valid");
  }

  const encryption = new CredentialEncryptionService(keyManagement);
  const envelope = await encryption.encrypt(credential);
  const validationService = new ConnectionValidationService(
    {
      findSecretEnvelopeForOrganization: async ({
        organizationId,
        connectionId,
      }) =>
        organizationId === "organization-1" && connectionId === "connection-1"
          ? envelope
          : null,
    },
    encryption,
    new FixtureResendValidationClient({
      [credential]: resendValidationFixtures.transientProviderFailure,
    }),
  );
  const app = buildApp({
    authService: createAuthService(),
    connectionValidationService: validationService,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/connections/connection-1/validate",
    headers: { cookie: sessionCookie },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "unavailable" });
  assert.equal(response.body.includes(credential), false);

  const missing = await app.inject({
    method: "POST",
    url: "/v1/connections/foreign-connection/validate",
    headers: { cookie: sessionCookie },
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "CONNECTION_NOT_FOUND" });
  assert.equal(missing.body.includes(credential), false);
});

test("validation route enforces authentication, Owner role, and configuration", async (t) => {
  const unavailableApp = buildApp({ authService: createAuthService() });
  let memberLookups = 0;
  const memberApp = buildApp({
    authService: createAuthService("member"),
    connectionValidationService: new ConnectionValidationService(
      {
        findSecretEnvelopeForOrganization: async () => {
          memberLookups += 1;
          throw new Error("MEMBER_MUST_NOT_READ_ENVELOPES");
        },
      },
      new CredentialEncryptionService({
        activeKeyVersion: "test-only",
        wrapKey: async () => "unused",
        unwrapKey: async () => Buffer.alloc(32),
      }),
      { validate: async () => "connected" },
    ),
  });
  t.after(() => unavailableApp.close());
  t.after(() => memberApp.close());

  const unauthenticated = await unavailableApp.inject({
    method: "POST",
    url: "/v1/connections/connection-1/validate",
  });
  const unconfigured = await unavailableApp.inject({
    method: "POST",
    url: "/v1/connections/connection-1/validate",
    headers: { cookie: sessionCookie },
  });
  const member = await memberApp.inject({
    method: "POST",
    url: "/v1/connections/connection-1/validate",
    headers: { cookie: sessionCookie },
  });

  assert.deepEqual(unauthenticated.json(), { error: "UNAUTHENTICATED" });
  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(unconfigured.json(), { error: "VALIDATION_NOT_CONFIGURED" });
  assert.equal(unconfigured.statusCode, 503);
  assert.deepEqual(member.json(), { error: "OWNER_REQUIRED" });
  assert.equal(member.statusCode, 403);
  assert.equal(memberLookups, 0);
});
