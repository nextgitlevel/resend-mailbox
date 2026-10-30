import assert from "node:assert/strict";
import test from "node:test";

import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";
import { buildApp } from "../src/app.js";
import {
  ConnectionSettingsService,
  type ConnectionSettingsRepository,
} from "../src/settings/connection-settings-service.js";
import {
  CredentialEncryptionService,
  type KeyManagementProvider,
} from "../src/settings/credential-encryption.js";

const createAuthService = (role: "owner" | "member" = "owner") => {
  const tokenHash = "session-hash";
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

  return new AuthService(repository, {
    now: () => new Date("2026-10-29T00:00:00.000Z"),
    randomToken: () => tokenHash,
  });
};

const createSettingsService = () => {
  const stored: unknown[] = [];
  const repository: ConnectionSettingsRepository = {
    createConnection: async (input) => {
      stored.push(input);
      return {
        id: "connection-1",
        organizationId: input.organizationId,
        name: input.name,
        secretConfigured: true,
        keyVersion: input.encryptedEnvelope.keyVersion,
      };
    },
    findConnectionForOrganization: async (input) => ({
      id: input.connectionId,
      organizationId: input.organizationId,
      name: "NextLevel Resend",
      secretConfigured: true,
      keyVersion: "test-kek-v1",
    }),
  };
  const keys: KeyManagementProvider = {
    activeKeyVersion: "test-kek-v1",
    wrapKey: async ({ plaintextDek, keyVersion }) =>
      `${keyVersion}:${plaintextDek.toString("base64url")}`,
    unwrapKey: async ({ wrappedDek }) =>
      Buffer.from(wrappedDek.split(":")[1] ?? "", "base64url"),
  };

  return {
    service: new ConnectionSettingsService(
      repository,
      new CredentialEncryptionService(keys),
    ),
    stored,
  };
};

test("only an authenticated Owner can create a redacted Resend connection", async (t) => {
  const settings = createSettingsService();
  const app = buildApp({
    authService: createAuthService(),
    connectionSettingsService: settings.service,
  });
  t.after(() => app.close());

  const payload = {
    name: "NextLevel Resend",
    apiKey: "test_api_credential_that_must_not_be_returned",
  };
  const rejected = await app.inject({
    method: "POST",
    url: "/v1/connections",
    payload,
  });
  const accepted = await app.inject({
    method: "POST",
    url: "/v1/connections",
    headers: {
      cookie: "resend_mailbox_session=opaque-session-token-for-route-test-only",
    },
    payload,
  });
  const status = await app.inject({
    method: "GET",
    url: "/v1/connections/connection-1",
    headers: {
      cookie: "resend_mailbox_session=opaque-session-token-for-route-test-only",
    },
  });

  assert.equal(rejected.statusCode, 401);
  assert.equal(accepted.statusCode, 201);
  assert.deepEqual(accepted.json(), {
    connection: {
      id: "connection-1",
      organizationId: "organization-1",
      name: "NextLevel Resend",
      secretConfigured: true,
      keyVersion: "test-kek-v1",
    },
  });
  assert.equal(accepted.body.includes(payload.apiKey), false);
  assert.equal(JSON.stringify(settings.stored).includes(payload.apiKey), false);
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), {
    connection: {
      id: "connection-1",
      organizationId: "organization-1",
      name: "NextLevel Resend",
      secretConfigured: true,
      keyVersion: "test-kek-v1",
    },
  });
});

test("connection settings reject invalid input and are unavailable without encryption wiring", async (t) => {
  const app = buildApp({ authService: createAuthService() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/connections",
    headers: {
      cookie: "resend_mailbox_session=opaque-session-token-for-route-test-only",
    },
    payload: { name: "", apiKey: "" },
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "SETTINGS_NOT_CONFIGURED" });
});

test("a non-Owner session cannot create or read connection settings", async (t) => {
  const settings = createSettingsService();
  const app = buildApp({
    authService: createAuthService("member"),
    connectionSettingsService: settings.service,
  });
  t.after(() => app.close());

  const headers = {
    cookie: "resend_mailbox_session=opaque-session-token-for-route-test-only",
  };
  const create = await app.inject({
    method: "POST",
    url: "/v1/connections",
    headers,
    payload: { name: "Member attempt", apiKey: "test_member_credential" },
  });
  const read = await app.inject({
    method: "GET",
    url: "/v1/connections/connection-1",
    headers,
  });

  assert.equal(create.statusCode, 403);
  assert.deepEqual(create.json(), { error: "OWNER_REQUIRED" });
  assert.equal(read.statusCode, 403);
  assert.deepEqual(read.json(), { error: "OWNER_REQUIRED" });
  assert.equal(settings.stored.length, 0);
});
