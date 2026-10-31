import { randomUUID } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  AllowedAddress,
  DomainSettingsRepository,
  Mailbox,
  RedactedDomain,
} from "../domains/domain-settings-service.js";
import type { DomainFallbackPolicy } from "../routing/recipient-router.js";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type MembershipRole = "owner" | "admin" | "member";

export interface EncryptedSecretEnvelope {
  ciphertext: string;
  nonce: string;
  wrappedDek: string;
  keyVersion: string;
  algorithm: string;
}

export interface BootstrapOwnerInput {
  userEmail: string;
  organizationName: string;
  connectionName: string;
  encryptedEnvelope: EncryptedSecretEnvelope;
}

export interface BootstrapOwnerResult {
  userId: string;
  organizationId: string;
  connectionId: string;
}

export interface MembershipInput {
  organizationId: string;
  userId: string;
  role: MembershipRole;
}

export interface ConnectionLookupInput {
  organizationId: string;
  connectionId: string;
}

export interface RedactedConnection {
  id: string;
  organizationId: string;
  name: string;
  secretConfigured: boolean;
  keyVersion: string | null;
}

export interface CreateConnectionInput {
  organizationId: string;
  name: string;
  encryptedEnvelope: EncryptedSecretEnvelope;
}

interface ConnectionRow extends QueryResultRow {
  id: string;
  organization_id: string;
  name: string;
  secret_configured: boolean;
  key_version: string | null;
}

const upStatements = [
  `
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
      password_hash TEXT CHECK (char_length(password_hash) > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE organizations (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE organization_memberships (
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, user_id)
    )
  `,
  `
    CREATE TABLE resend_connections (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, name)
    )
  `,
  `
    CREATE TABLE connection_secret_envelopes (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL,
      connection_id UUID NOT NULL,
      ciphertext TEXT NOT NULL CHECK (char_length(ciphertext) > 0),
      nonce TEXT NOT NULL CHECK (char_length(nonce) > 0),
      wrapped_dek TEXT NOT NULL CHECK (char_length(wrapped_dek) > 0),
      key_version TEXT NOT NULL CHECK (char_length(key_version) BETWEEN 1 AND 200),
      algorithm TEXT NOT NULL CHECK (char_length(algorithm) BETWEEN 1 AND 200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (organization_id, connection_id)
        REFERENCES resend_connections (organization_id, id)
        ON DELETE CASCADE,
      UNIQUE (connection_id)
    )
  `,
  `
    CREATE TABLE mailboxes (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, id),
      UNIQUE (organization_id, name)
    )
  `,
  `
    CREATE TABLE domains (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      connection_id UUID NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE CHECK (normalized_name = lower(normalized_name)),
      verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified', 'failed')),
      fallback_kind TEXT NOT NULL CHECK (fallback_kind IN ('catch_all', 'quarantine', 'discard')),
      fallback_mailbox_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, connection_id)
        REFERENCES resend_connections (organization_id, id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id, fallback_mailbox_id)
        REFERENCES mailboxes (organization_id, id),
      CHECK (
        (fallback_kind = 'catch_all' AND fallback_mailbox_id IS NOT NULL) OR
        (fallback_kind IN ('quarantine', 'discard') AND fallback_mailbox_id IS NULL)
      )
    )
  `,
  `
    CREATE TABLE allowed_recipient_addresses (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain_id UUID NOT NULL,
      mailbox_id UUID NOT NULL,
      local_part TEXT NOT NULL CHECK (local_part = lower(local_part) AND char_length(local_part) BETWEEN 1 AND 64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (domain_id, local_part),
      FOREIGN KEY (organization_id, domain_id)
        REFERENCES domains (organization_id, id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id, mailbox_id)
        REFERENCES mailboxes (organization_id, id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) > 0),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE inbound_webhook_receipts (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE instance_bootstrap (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      owner_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `,
] as const;

const downStatements = [
  "DROP TABLE IF EXISTS instance_bootstrap",
  "DROP TABLE IF EXISTS sessions",
  "DROP TABLE IF EXISTS inbound_webhook_receipts",
  "DROP TABLE IF EXISTS allowed_recipient_addresses",
  "DROP TABLE IF EXISTS domains",
  "DROP TABLE IF EXISTS mailboxes",
  "DROP TABLE IF EXISTS connection_secret_envelopes",
  "DROP TABLE IF EXISTS resend_connections",
  "DROP TABLE IF EXISTS organization_memberships",
  "DROP TABLE IF EXISTS organizations",
  "DROP TABLE IF EXISTS users",
] as const;

export const applyIdentitySchema = async (database: Queryable) => {
  for (const statement of upStatements) {
    await database.query(statement);
  }
};

export const revertIdentitySchema = async (database: Queryable) => {
  for (const statement of downStatements) {
    await database.query(statement);
  }
};

export class PostgresIdentityRepository implements DomainSettingsRepository {
  public constructor(private readonly pool: Pool) {}

  public async bootstrapOwner(
    input: BootstrapOwnerInput,
  ): Promise<BootstrapOwnerResult> {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const connectionId = randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query({
        text: "INSERT INTO users (id, email) VALUES ($1, $2)",
        values: [userId, normalizeEmail(input.userEmail)],
      });
      await client.query({
        text: "INSERT INTO organizations (id, name) VALUES ($1, $2)",
        values: [organizationId, input.organizationName],
      });
      await this.insertMembership(client, {
        organizationId,
        userId,
        role: "owner",
      });
      await client.query({
        text: `
          INSERT INTO resend_connections (id, organization_id, name)
          VALUES ($1, $2, $3)
        `,
        values: [connectionId, organizationId, input.connectionName],
      });
      await client.query({
        text: `
          INSERT INTO connection_secret_envelopes (
            id, organization_id, connection_id, ciphertext, wrapped_dek,
            nonce, key_version, algorithm
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        values: [
          randomUUID(),
          organizationId,
          connectionId,
          input.encryptedEnvelope.ciphertext,
          input.encryptedEnvelope.wrappedDek,
          input.encryptedEnvelope.nonce,
          input.encryptedEnvelope.keyVersion,
          input.encryptedEnvelope.algorithm,
        ],
      });
      await client.query("COMMIT");

      return { userId, organizationId, connectionId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async addMembership(input: MembershipInput): Promise<void> {
    await this.insertMembership(this.pool, input);
  }

  public async createConnection(
    input: CreateConnectionInput,
  ): Promise<RedactedConnection> {
    const connectionId = randomUUID();

    await this.pool.query({
      text: `
        WITH created_connection AS (
          INSERT INTO resend_connections (id, organization_id, name)
          VALUES ($1, $2, $3)
          RETURNING id, organization_id, name
        ), created_envelope AS (
          INSERT INTO connection_secret_envelopes (
            id, organization_id, connection_id, ciphertext, nonce, wrapped_dek,
            key_version, algorithm
          )
          SELECT $4, organization_id, id, $5, $6, $7, $8, $9
          FROM created_connection
        )
        SELECT id, organization_id, name FROM created_connection
      `,
      values: [
        connectionId,
        input.organizationId,
        input.name,
        randomUUID(),
        input.encryptedEnvelope.ciphertext,
        input.encryptedEnvelope.nonce,
        input.encryptedEnvelope.wrappedDek,
        input.encryptedEnvelope.keyVersion,
        input.encryptedEnvelope.algorithm,
      ],
    });

    return {
      id: connectionId,
      organizationId: input.organizationId,
      name: input.name,
      secretConfigured: true,
      keyVersion: input.encryptedEnvelope.keyVersion,
    };
  }

  public async hasOwner(): Promise<boolean> {
    const result = await this.pool.query({
      text: "SELECT 1 FROM instance_bootstrap LIMIT 1",
    });

    return result.rowCount !== 0;
  }

  public async bootstrapOwnerWithPassword(input: {
    email: string;
    organizationName: string;
    passwordHash: string;
  }): Promise<{
    userId: string;
    organizationId: string;
    email: string;
    role: "owner";
  }> {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(240_019_001)");
      const existingOwner = await client.query({
        text: "SELECT 1 FROM instance_bootstrap LIMIT 1",
      });

      if (existingOwner.rowCount !== 0) {
        throw new Error("OWNER_ALREADY_BOOTSTRAPPED");
      }

      const email = normalizeEmail(input.email);
      await client.query({
        text: `
          INSERT INTO users (id, email, password_hash)
          VALUES ($1, $2, $3)
        `,
        values: [userId, email, input.passwordHash],
      });
      await client.query({
        text: "INSERT INTO organizations (id, name) VALUES ($1, $2)",
        values: [organizationId, input.organizationName],
      });
      await this.insertMembership(client, {
        organizationId,
        userId,
        role: "owner",
      });
      await client.query({
        text: `
          INSERT INTO instance_bootstrap (
            owner_user_id, owner_organization_id
          ) VALUES ($1, $2)
        `,
        values: [userId, organizationId],
      });
      await client.query("COMMIT");

      return { userId, organizationId, email, role: "owner" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async findUserForLogin(email: string): Promise<{
    userId: string;
    organizationId: string;
    email: string;
    role: MembershipRole;
    passwordHash: string | null;
  } | null> {
    const result = await this.pool.query<{
      user_id: string;
      organization_id: string;
      email: string;
      role: MembershipRole;
      password_hash: string | null;
    }>({
      text: `
        SELECT app_user.id AS user_id, membership.organization_id, app_user.email, membership.role,
          app_user.password_hash
        FROM users AS app_user
        INNER JOIN organization_memberships AS membership
          ON membership.user_id = app_user.id AND membership.role = 'owner'
        WHERE app_user.email = $1
      `,
      values: [normalizeEmail(email)],
    });
    const row = result.rows[0];

    return row
      ? {
          userId: row.user_id,
          organizationId: row.organization_id,
          email: row.email,
          role: row.role,
          passwordHash: row.password_hash,
        }
      : null;
  }

  public async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query({
      text: `
        INSERT INTO sessions (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
      `,
      values: [randomUUID(), input.userId, input.tokenHash, input.expiresAt],
    });
  }

  public async findSessionByTokenHash(tokenHash: string): Promise<{
    userId: string;
    organizationId: string;
    email: string;
    role: MembershipRole;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null> {
    const result = await this.pool.query<{
      user_id: string;
      organization_id: string;
      email: string;
      role: MembershipRole;
      expires_at: Date;
      revoked_at: Date | null;
    }>({
      text: `
        SELECT login_session.user_id, membership.organization_id, app_user.email, membership.role,
          login_session.expires_at, login_session.revoked_at
        FROM sessions AS login_session
        INNER JOIN users AS app_user ON app_user.id = login_session.user_id
        INNER JOIN organization_memberships AS membership
          ON membership.user_id = app_user.id AND membership.role = 'owner'
        WHERE login_session.token_hash = $1
      `,
      values: [tokenHash],
    });
    const row = result.rows[0];

    return row
      ? {
          userId: row.user_id,
          organizationId: row.organization_id,
          email: row.email,
          role: row.role,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        }
      : null;
  }

  public async findConnectionForOrganization(
    input: ConnectionLookupInput,
  ): Promise<RedactedConnection | null> {
    const result = await this.pool.query<ConnectionRow>({
      text: `
        SELECT
          connection.id,
          connection.organization_id,
          connection.name,
          envelope.id IS NOT NULL AS secret_configured,
          envelope.key_version
        FROM resend_connections AS connection
        LEFT JOIN connection_secret_envelopes AS envelope
          ON envelope.connection_id = connection.id
        WHERE connection.organization_id = $1 AND connection.id = $2
      `,
      values: [input.organizationId, input.connectionId],
    });
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      secretConfigured: row.secret_configured,
      keyVersion: row.key_version,
    };
  }

  public async createMailbox(input: {
    organizationId: string;
    name: string;
  }): Promise<Mailbox> {
    const id = randomUUID();
    await this.pool.query({
      text: "INSERT INTO mailboxes (id, organization_id, name) VALUES ($1, $2, $3)",
      values: [id, input.organizationId, input.name],
    });
    return { id, organizationId: input.organizationId, name: input.name };
  }

  public async findMailboxForOrganization(input: {
    organizationId: string;
    mailboxId: string;
  }): Promise<Mailbox | null> {
    const result = await this.pool.query<{
      id: string;
      organization_id: string;
      name: string;
    }>({
      text: "SELECT id, organization_id, name FROM mailboxes WHERE organization_id = $1 AND id = $2",
      values: [input.organizationId, input.mailboxId],
    });
    const row = result.rows[0];
    return row
      ? { id: row.id, organizationId: row.organization_id, name: row.name }
      : null;
  }

  public async createDomain(input: {
    organizationId: string;
    connectionId: string;
    name: string;
    fallback: DomainFallbackPolicy;
  }): Promise<RedactedDomain> {
    const id = randomUUID();
    const fallbackMailboxId =
      input.fallback.kind === "catch_all" ? input.fallback.mailboxId : null;
    await this.pool.query({
      text: `
        INSERT INTO domains (
          id, organization_id, connection_id, normalized_name, verification_status,
          fallback_kind, fallback_mailbox_id
        ) VALUES ($1, $2, $3, $4, 'pending', $5, $6)
      `,
      values: [
        id,
        input.organizationId,
        input.connectionId,
        input.name,
        input.fallback.kind,
        fallbackMailboxId,
      ],
    });
    return {
      id,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      name: input.name,
      verificationStatus: "pending",
      fallback: input.fallback,
    };
  }

  public async findDomainForOrganization(input: {
    organizationId: string;
    domainId: string;
  }): Promise<RedactedDomain | null> {
    const result = await this.pool.query<{
      id: string;
      organization_id: string;
      connection_id: string;
      normalized_name: string;
      verification_status: "pending" | "verified" | "failed";
      fallback_kind: "catch_all" | "quarantine" | "discard";
      fallback_mailbox_id: string | null;
    }>({
      text: `SELECT id, organization_id, connection_id, normalized_name, verification_status, fallback_kind, fallback_mailbox_id
             FROM domains WHERE organization_id = $1 AND id = $2`,
      values: [input.organizationId, input.domainId],
    });
    const row = result.rows[0];
    if (!row) return null;
    const fallback: DomainFallbackPolicy =
      row.fallback_kind === "catch_all"
        ? { kind: "catch_all", mailboxId: row.fallback_mailbox_id as string }
        : { kind: row.fallback_kind };
    return {
      id: row.id,
      organizationId: row.organization_id,
      connectionId: row.connection_id,
      name: row.normalized_name,
      verificationStatus: row.verification_status,
      fallback,
    };
  }

  public async createAllowedAddress(input: {
    organizationId: string;
    domainId: string;
    mailboxId: string;
    localPart: string;
  }): Promise<AllowedAddress> {
    const id = randomUUID();
    await this.pool.query({
      text: `INSERT INTO allowed_recipient_addresses (id, organization_id, domain_id, mailbox_id, local_part)
             VALUES ($1, $2, $3, $4, $5)`,
      values: [
        id,
        input.organizationId,
        input.domainId,
        input.mailboxId,
        input.localPart,
      ],
    });
    return { id, ...input };
  }

  public async capture(input: {
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<boolean> {
    const result = await this.pool.query({
      text: `INSERT INTO inbound_webhook_receipts (event_id, event_type, payload)
             VALUES ($1, $2, $3::jsonb) ON CONFLICT (event_id) DO NOTHING`,
      values: [input.eventId, input.eventType, JSON.stringify(input.payload)],
    });
    return result.rowCount === 1;
  }

  public async findSecretEnvelopeForOrganization(
    input: ConnectionLookupInput,
  ): Promise<EncryptedSecretEnvelope | null> {
    const result = await this.pool.query<{
      ciphertext: string;
      nonce: string;
      wrapped_dek: string;
      key_version: string;
      algorithm: string;
    }>({
      text: `
        SELECT envelope.ciphertext, envelope.nonce, envelope.wrapped_dek,
          envelope.key_version, envelope.algorithm
        FROM connection_secret_envelopes AS envelope
        INNER JOIN resend_connections AS connection
          ON connection.id = envelope.connection_id
          AND connection.organization_id = envelope.organization_id
        WHERE envelope.organization_id = $1 AND envelope.connection_id = $2
      `,
      values: [input.organizationId, input.connectionId],
    });
    const row = result.rows[0];

    return row
      ? {
          ciphertext: row.ciphertext,
          nonce: row.nonce,
          wrappedDek: row.wrapped_dek,
          keyVersion: row.key_version,
          algorithm: row.algorithm,
        }
      : null;
  }

  private async insertMembership(
    database: Queryable,
    input: MembershipInput,
  ): Promise<void> {
    await database.query({
      text: `
        INSERT INTO organization_memberships (organization_id, user_id, role)
        VALUES ($1, $2, $3)
      `,
      values: [input.organizationId, input.userId, input.role],
    });
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
