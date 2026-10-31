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
  "outbound queue is idempotent, rejects mismatched reuse, and isolates organizations",
  async (t) => {
    const { pool, cleanup } = await createIsolatedSchema();
    const repository = new PostgresIdentityRepository(pool);
    t.after(cleanup);
    const first = await repository.bootstrapOwner({
      userEmail: "outbound-one@example.test",
      organizationName: "One",
      connectionName: "One",
      encryptedEnvelope,
    });
    const second = await repository.bootstrapOwner({
      userEmail: "outbound-two@example.test",
      organizationName: "Two",
      connectionName: "Two",
      encryptedEnvelope,
    });
    const input = {
      organizationId: first.organizationId,
      idempotencyKey: "same-key",
      connectionId: first.connectionId,
      from: "support@example.test",
      replyTo: null,
      to: "person@example.test",
      subject: "Hello",
      text: "Body",
      fingerprint: "fingerprint-one",
    };
    const queued = await repository.queue(input);
    const duplicate = await repository.queue(input);
    assert.equal(queued.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.id, queued.id);
    assert.equal(
      (
        await repository.findStatus({
          organizationId: first.organizationId,
          sendId: queued.id,
        })
      )?.status,
      "queued",
    );
    assert.equal(
      await repository.findStatus({
        organizationId: second.organizationId,
        sendId: queued.id,
      }),
      null,
    );
    await assert.rejects(
      repository.queue({
        ...input,
        subject: "Changed",
        fingerprint: "fingerprint-two",
      }),
      /IDEMPOTENCY_KEY_REUSED/,
    );
    const isolated = await repository.queue({
      ...input,
      organizationId: second.organizationId,
    });
    assert.equal(isolated.duplicate, false);
    assert.notEqual(isolated.id, queued.id);
  },
);

integrationTest(
  "outbound worker claims a queued send once and persists terminal outcomes",
  async (t) => {
    const { pool, cleanup } = await createIsolatedSchema();
    const repository = new PostgresIdentityRepository(pool);
    t.after(cleanup);
    const owner = await repository.bootstrapOwner({
      userEmail: "worker@example.test",
      organizationName: "Worker",
      connectionName: "Worker",
      encryptedEnvelope,
    });
    const queued = await repository.queue({
      organizationId: owner.organizationId,
      idempotencyKey: "worker-key",
      connectionId: owner.connectionId,
      from: "support@example.test",
      replyTo: null,
      to: "person@example.test",
      subject: "Hi",
      text: "Body",
      fingerprint: "worker-fingerprint",
    });
    const [first, second] = await Promise.all([
      repository.claimNext(),
      repository.claimNext(),
    ]);
    assert.deepEqual([first?.id, second?.id].filter(Boolean), [queued.id]);
    assert.equal(first?.attempt, 1);
    await pool.query(
      "UPDATE outbound_sends SET claimed_at = now() - INTERVAL '121 seconds' WHERE id = $1",
      [queued.id],
    );
    const recovered = await repository.claimNext();
    assert.equal(recovered?.id, queued.id);
    assert.equal(recovered?.idempotencyKey, "worker-key");
    assert.equal(recovered?.attempt, 2);
    await repository.markFailed(queued.id, "attempts_exhausted");
    const failed = await pool.query<{
      status: string;
      failure_code: string | null;
    }>("SELECT status, failure_code FROM outbound_sends WHERE id = $1", [
      queued.id,
    ]);
    assert.deepEqual(failed.rows[0], {
      status: "failed",
      failure_code: "attempts_exhausted",
    });
    assert.equal(await repository.claimNext(), null);
  },
);

integrationTest(
  "outbound retry stops after Resend's idempotency retention window",
  async (t) => {
    const { pool, cleanup } = await createIsolatedSchema();
    const repository = new PostgresIdentityRepository(pool);
    t.after(cleanup);
    const owner = await repository.bootstrapOwner({
      userEmail: "retry-window@example.test",
      organizationName: "Retry Window",
      connectionName: "Retry Window",
      encryptedEnvelope,
    });
    const send = await repository.queue({
      organizationId: owner.organizationId,
      connectionId: owner.connectionId,
      idempotencyKey: "retry-window-key",
      from: "support@example.test",
      replyTo: null,
      to: "person@example.test",
      subject: "Hi",
      text: "Body",
      fingerprint: "retry-window-fingerprint",
    });
    await repository.claimNext();
    await repository.markRetry(send.id, 0);
    await pool.query(
      "UPDATE outbound_sends SET created_at = now() - INTERVAL '25 hours' WHERE id = $1",
      [send.id],
    );
    assert.equal(await repository.claimNext(), null);
    assert.equal(
      (
        await repository.findStatus({
          organizationId: owner.organizationId,
          sendId: send.id,
        })
      )?.failureCode,
      "delivery_outcome_unknown",
    );
  },
);

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
    const ownEnvelope = await repository.findSecretEnvelopeForOrganization({
      organizationId: first.organizationId,
      connectionId: first.connectionId,
    });
    const foreignEnvelope = await repository.findSecretEnvelopeForOrganization({
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
    assert.deepEqual(ownEnvelope, encryptedEnvelope);
    assert.equal(foreignEnvelope, null);
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

integrationTest(
  "domain persistence normalizes global domain ownership and scopes mailboxes and addresses to an organization",
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
    const mailbox = await repository.createMailbox({
      organizationId: first.organizationId,
      name: "Primary inbox",
    });
    const foreignMailbox = await repository.createMailbox({
      organizationId: second.organizationId,
      name: "Foreign inbox",
    });
    const domain = await repository.createDomain({
      organizationId: first.organizationId,
      connectionId: first.connectionId,
      name: "nextlevelmaintenance.com",
      fallback: { kind: "quarantine" },
    });
    assert.equal(domain.verificationStatus, "pending");
    await assert.rejects(
      repository.createAllowedAddress({
        organizationId: first.organizationId,
        domainId: domain.id,
        mailboxId: mailbox.id,
        localPart: "marcus",
      }),
      /ALLOWED_ADDRESS_REQUIRES_VERIFIED_DOMAIN/,
    );
    assert.equal(
      await repository.updateDomainVerificationStatusForOrganization({
        organizationId: second.organizationId,
        domainId: domain.id,
        verificationStatus: "verified",
      }),
      null,
    );
    assert.equal(
      (
        await repository.updateDomainVerificationStatusForOrganization({
          organizationId: first.organizationId,
          domainId: domain.id,
          verificationStatus: "verified",
        })
      )?.verificationStatus,
      "verified",
    );
    await assert.rejects(
      repository.createAllowedAddress({
        organizationId: first.organizationId,
        domainId: domain.id,
        mailboxId: foreignMailbox.id,
        localPart: "foreign",
      }),
      /ALLOWED_ADDRESS_REQUIRES_VERIFIED_DOMAIN/,
    );
    const address = await repository.createAllowedAddress({
      organizationId: first.organizationId,
      domainId: domain.id,
      mailboxId: mailbox.id,
      localPart: "marcus",
    });
    const secondAddress = await repository.createAllowedAddress({
      organizationId: first.organizationId,
      domainId: domain.id,
      mailboxId: mailbox.id,
      localPart: "support",
    });
    await repository.updateAllowedAddressPolicyForOrganization({
      organizationId: first.organizationId,
      addressId: address.id,
      replyTo: "reply@nextlevelmaintenance.com",
      isDefaultSender: true,
    });
    assert.deepEqual(
      await repository.listAllowedSenders(first.organizationId),
      [
        {
          address: "marcus@nextlevelmaintenance.com",
          replyTo: "reply@nextlevelmaintenance.com",
        },
        { address: "support@nextlevelmaintenance.com", replyTo: null },
      ],
    );
    assert.deepEqual(
      await repository.listAllowedSenders(second.organizationId),
      [],
    );
    const secondPolicy =
      await repository.updateAllowedAddressPolicyForOrganization({
        organizationId: first.organizationId,
        addressId: secondAddress.id,
        replyTo: null,
        isDefaultSender: true,
      });
    assert.equal(secondPolicy?.isDefaultSender, true);
    assert.equal(
      (
        await repository.findAllowedAddressForOrganization({
          organizationId: first.organizationId,
          addressId: address.id,
        })
      )?.isDefaultSender,
      false,
    );
    assert.equal(
      await repository.updateAllowedAddressPolicyForOrganization({
        organizationId: second.organizationId,
        addressId: secondAddress.id,
        replyTo: null,
        isDefaultSender: false,
      }),
      null,
    );
    assert.equal(
      await repository.updateAllowedAddressPolicyForOrganization({
        organizationId: first.organizationId,
        addressId: secondAddress.id,
        replyTo: "attacker@nextlevelmaintenance.com.bad",
        isDefaultSender: false,
      }),
      null,
    );
    assert.equal(
      (
        await repository.findAllowedAddressForOrganization({
          organizationId: first.organizationId,
          addressId: secondAddress.id,
        })
      )?.isDefaultSender,
      true,
    );

    assert.deepEqual(address, {
      id: address.id,
      organizationId: first.organizationId,
      domainId: domain.id,
      mailboxId: mailbox.id,
      localPart: "marcus",
    });
    assert.equal(
      await repository.findDomainForOrganization({
        organizationId: second.organizationId,
        domainId: domain.id,
      }),
      null,
    );
    await assert.rejects(
      repository.createDomain({
        organizationId: second.organizationId,
        connectionId: second.connectionId,
        name: "NEXTLEVELMAINTENANCE.COM",
        fallback: { kind: "discard" },
      }),
      /duplicate key/,
    );
  },
);
