import { randomUUID } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type MembershipRole = "owner" | "admin" | "member";

export interface EncryptedSecretEnvelope {
  ciphertext: string;
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
] as const;

const downStatements = [
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

export class PostgresIdentityRepository {
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
            key_version, algorithm
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        values: [
          randomUUID(),
          organizationId,
          connectionId,
          input.encryptedEnvelope.ciphertext,
          input.encryptedEnvelope.wrappedDek,
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
