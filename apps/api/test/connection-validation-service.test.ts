import assert from "node:assert/strict";
import test from "node:test";

import type { AuthAccount } from "../src/auth/auth-service.js";
import {
  ConnectionValidationService,
  type ConnectionValidationRepository,
} from "../src/settings/connection-validation-service.js";
import { CredentialEncryptionService } from "../src/settings/credential-encryption.js";
import { DevelopmentKeyManagementProvider } from "../src/settings/development-key-management.js";
import {
  FixtureResendValidationClient,
  resendValidationFixtures,
} from "../src/settings/resend-validation-client.js";

const owner: AuthAccount = {
  userId: "owner-1",
  organizationId: "organization-1",
  email: "owner@example.test",
  role: "owner",
};

const testKeyManagement = DevelopmentKeyManagementProvider.fromBase64Url(
  Buffer.alloc(32, 7).toString("base64url"),
);

if (!testKeyManagement) {
  throw new Error("test key fixture must be valid");
}

const encryption = new CredentialEncryptionService(testKeyManagement);

test("Owner validation decrypts only its connection and returns a redacted status", async () => {
  const credential = "credential_never_returned_to_caller";
  const encryptedEnvelope = await encryption.encrypt(credential);
  const lookups: Array<{ organizationId: string; connectionId: string }> = [];
  const repository: ConnectionValidationRepository = {
    findSecretEnvelopeForOrganization: async (input) => {
      lookups.push(input);
      return input.connectionId === "connection-1" ? encryptedEnvelope : null;
    },
  };
  const service = new ConnectionValidationService(
    repository,
    encryption,
    new FixtureResendValidationClient({
      [credential]: resendValidationFixtures.successful,
    }),
  );

  const result = await service.validateConnection({
    account: owner,
    connectionId: "connection-1",
  });

  assert.equal(result, "connected");
  assert.deepEqual(lookups, [
    { organizationId: owner.organizationId, connectionId: "connection-1" },
  ]);
  assert.notEqual(result, credential);
});

test("validation conceals missing or foreign envelopes and fails closed when unavailable", async () => {
  let lookups = 0;
  const repository: ConnectionValidationRepository = {
    findSecretEnvelopeForOrganization: async () => {
      lookups += 1;
      return null;
    },
  };
  const service = new ConnectionValidationService(
    repository,
    encryption,
    new FixtureResendValidationClient({}),
  );

  await assert.rejects(
    service.validateConnection({
      account: owner,
      connectionId: "foreign-connection",
    }),
    /CONNECTION_NOT_FOUND/,
  );
  await assert.rejects(
    service.validateConnection({
      account: { ...owner, role: "member" },
      connectionId: "connection-1",
    }),
    /OWNER_REQUIRED/,
  );
  assert.equal(lookups, 1);
});

test("validation fails closed when decryption fails and does not invoke the client", async () => {
  let clientCalls = 0;
  const service = new ConnectionValidationService(
    {
      findSecretEnvelopeForOrganization: async () => ({
        ciphertext: "invalid",
        nonce: "invalid",
        wrappedDek: "invalid",
        keyVersion: "unknown-key-version",
        algorithm: "unsupported-algorithm",
      }),
    },
    encryption,
    {
      validate: async () => {
        clientCalls += 1;
        return "connected";
      },
    },
  );

  assert.equal(
    await service.validateConnection({
      account: owner,
      connectionId: "connection-1",
    }),
    "unavailable",
  );
  assert.equal(clientCalls, 0);
});

test("validation preserves safe unauthorized and transient fixture outcomes", async () => {
  const credential = "fixture_credential";
  const envelope = await encryption.encrypt(credential);
  const repository: ConnectionValidationRepository = {
    findSecretEnvelopeForOrganization: async () => envelope,
  };

  const unauthorized = new ConnectionValidationService(
    repository,
    encryption,
    new FixtureResendValidationClient({
      [credential]: resendValidationFixtures.unauthorized,
    }),
  );
  const transient = new ConnectionValidationService(
    repository,
    encryption,
    new FixtureResendValidationClient({
      [credential]: resendValidationFixtures.transientProviderFailure,
    }),
  );

  assert.equal(
    await unauthorized.validateConnection({
      account: owner,
      connectionId: "connection-1",
    }),
    "invalid_credentials",
  );
  assert.equal(
    await transient.validateConnection({
      account: owner,
      connectionId: "connection-1",
    }),
    "unavailable",
  );
});
