import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import { AuthService } from "../src/auth/auth-service.js";
import {
  applyIdentitySchema,
  PostgresIdentityRepository,
  revertIdentitySchema,
} from "../src/persistence/identity-repository.js";
import { ConnectionSettingsService } from "../src/settings/connection-settings-service.js";
import {
  CredentialEncryptionService,
  type KeyManagementProvider,
} from "../src/settings/credential-encryption.js";

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

const encryptedEnvelope = {
  ciphertext: "base64-ciphertext-fixture",
  nonce: "base64-nonce-fixture",
  wrappedDek: "base64-wrapped-dek-fixture",
  keyVersion: "test-kek-v1",
  algorithm: "test-aead",
};

const integrationKeyProvider: KeyManagementProvider = {
  activeKeyVersion: "integration-kek-v1",
  wrapKey: async ({ plaintextDek, keyVersion }) =>
    `${keyVersion}:${plaintextDek.toString("base64url")}`,
  unwrapKey: async ({ wrappedDek, keyVersion }) => {
    const [storedVersion, encodedDek] = wrappedDek.split(":");

    if (storedVersion !== keyVersion || !encodedDek) {
      throw new Error("KEY_UNWRAP_FAILED");
    }

    return Buffer.from(encodedDek, "base64url");
  },
};

const createIsolatedSchema = async () => {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for persistence integration tests",
    );
  }

  const schema = `identity_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  await adminPool.query(`CREATE SCHEMA ${schema}`);

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c search_path=${schema}`,
  });
  try {
    await applyIdentitySchema(pool);
  } catch (error) {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
    throw error;
  }

  return {
    schema,
    pool,
    cleanup: async () => {
      await revertIdentitySchema(pool);
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema}`);
      await adminPool.end();
    },
  };
};

integrationTest(
  "Owner connection configuration stores an encrypted credential without its plaintext",
  async (t) => {
    const { pool, cleanup } = await createIsolatedSchema();
    const repository = new PostgresIdentityRepository(pool);
    const authService = new AuthService(repository, {
      bootstrapToken: "test-bootstrap-token",
      randomToken: () => "owner-session-token-for-integration-test-only",
    });
    const settingsService = new ConnectionSettingsService(
      repository,
      new CredentialEncryptionService(integrationKeyProvider),
    );
    const apiKey =
      "test_integration_credential_that_must_not_be_stored_plaintext";

    t.after(cleanup);

    const { account } = await authService.bootstrapOwner({
      email: "owner@example.test",
      organizationName: "NextLevel",
      password: "a long test-only password",
      bootstrapToken: "test-bootstrap-token",
    });
    const connection = await settingsService.createConnection({
      account,
      name: "Primary Resend",
      apiKey,
    });
    const stored = await pool.query<{
      ciphertext: string;
      nonce: string;
      wrapped_dek: string;
    }>(
      "SELECT ciphertext, nonce, wrapped_dek FROM connection_secret_envelopes",
    );

    assert.equal(connection.secretConfigured, true);
    assert.equal(stored.rowCount, 1);
    assert.equal(JSON.stringify(stored.rows).includes(apiKey), false);
  },
);

integrationTest(
  "organization bootstrap persists a redacted encrypted connection and isolates other organizations",
  async (t) => {
    const { pool, cleanup } = await createIsolatedSchema();
    const repository = new PostgresIdentityRepository(pool);

    t.after(cleanup);

    const first = await repository.bootstrapOwner({
      userEmail: "owner-one@example.test",
      organizationName: "First organization",
      connectionName: "First Resend account",
      encryptedEnvelope,
    });
    const second = await repository.bootstrapOwner({
      userEmail: "owner-two@example.test",
      organizationName: "Second organization",
      connectionName: "Second Resend account",
      encryptedEnvelope,
    });
    const ownConnection = await repository.findConnectionForOrganization({
      organizationId: first.organizationId,
      connectionId: first.connectionId,
    });
    const foreignConnection = await repository.findConnectionForOrganization({
      organizationId: second.organizationId,
      connectionId: first.connectionId,
    });

    assert.deepEqual(ownConnection, {
      id: first.connectionId,
      organizationId: first.organizationId,
      name: "First Resend account",
      secretConfigured: true,
      keyVersion: "test-kek-v1",
    });
    assert.equal(foreignConnection, null);
    assert.equal(JSON.stringify(ownConnection).includes("ciphertext"), false);
    assert.equal(JSON.stringify(ownConnection).includes("wrappedDek"), false);
  },
);

integrationTest(
  "Owner bootstrap stores a password hash and authenticates only a hashed session token",
  async (t) => {
    const { pool, cleanup } = await createIsolatedSchema();
    const repository = new PostgresIdentityRepository(pool);
    const service = new AuthService(repository, {
      now: () => new Date("2026-10-29T00:00:00.000Z"),
      randomToken: () => "auth-session-token-for-postgres-test-only",
      bootstrapToken: "test-bootstrap-token",
    });

    t.after(cleanup);

    const result = await service.bootstrapOwner({
      email: "owner@example.test",
      organizationName: "NextLevel",
      password: "a long test-only password",
      bootstrapToken: "test-bootstrap-token",
    });
    const storedUser = await repository.findUserForLogin("owner@example.test");

    assert.equal(await repository.hasOwner(), true);
    assert.notEqual(storedUser?.passwordHash, "a long test-only password");
    assert.deepEqual(
      await service.authenticateSession(result.sessionToken),
      result.account,
    );
    assert.equal(
      await service.authenticateSession(
        "unknown_session_token_that_is_long_enough_123",
      ),
      null,
    );
    assert.equal(await service.authenticateSession("malformed"), null);
    await assert.rejects(
      service.bootstrapOwner({
        email: "second@example.test",
        organizationName: "Second",
        password: "another long test-only password",
        bootstrapToken: "test-bootstrap-token",
      }),
      /OWNER_ALREADY_BOOTSTRAPPED/,
    );
  },
);

integrationTest(
  "identity schema rejects duplicate membership and cross-organization secret envelopes",
  async (t) => {
    const { schema, pool, cleanup } = await createIsolatedSchema();
    const repository = new PostgresIdentityRepository(pool);

    t.after(cleanup);

    const first = await repository.bootstrapOwner({
      userEmail: "owner-one@example.test",
      organizationName: "First organization",
      connectionName: "First Resend account",
      encryptedEnvelope,
    });
    const second = await repository.bootstrapOwner({
      userEmail: "owner-two@example.test",
      organizationName: "Second organization",
      connectionName: "Second Resend account",
      encryptedEnvelope,
    });
    const unassignedFirstConnectionId = randomUUID();

    await pool.query({
      text: `
        INSERT INTO ${schema}.resend_connections (id, organization_id, name)
        VALUES ($1, $2, $3)
      `,
      values: [
        unassignedFirstConnectionId,
        first.organizationId,
        "Unassigned first connection",
      ],
    });

    await assert.rejects(
      repository.addMembership({
        organizationId: first.organizationId,
        userId: first.userId,
        role: "owner",
      }),
      /duplicate key/i,
    );

    await assert.rejects(
      pool.query({
        text: `
          INSERT INTO ${schema}.connection_secret_envelopes (
            id, organization_id, connection_id, ciphertext, nonce, wrapped_dek,
            key_version, algorithm
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        values: [
          randomUUID(),
          second.organizationId,
          unassignedFirstConnectionId,
          encryptedEnvelope.ciphertext,
          encryptedEnvelope.nonce,
          encryptedEnvelope.wrappedDek,
          encryptedEnvelope.keyVersion,
          encryptedEnvelope.algorithm,
        ],
      }),
      /foreign key/i,
    );
  },
);
