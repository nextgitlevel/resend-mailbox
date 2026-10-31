import type { AuthAccount } from "../auth/auth-service.js";
import type {
  EncryptedSecretEnvelope,
  RedactedConnection,
} from "../persistence/identity-repository.js";
import { CredentialEncryptionService } from "./credential-encryption.js";

export interface ConnectionSettingsRepository {
  listConnectionsForOrganization?(
    organizationId: string,
  ): Promise<RedactedConnection[]>;
  updateConnectionSecretEnvelope?(input: {
    organizationId: string;
    connectionId: string;
    encryptedEnvelope: EncryptedSecretEnvelope;
  }): Promise<RedactedConnection | null>;
  createConnection(input: {
    organizationId: string;
    name: string;
    encryptedEnvelope: EncryptedSecretEnvelope;
  }): Promise<RedactedConnection>;
  findConnectionForOrganization(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<RedactedConnection | null>;
}

export class ConnectionSettingsService {
  public constructor(
    private readonly repository: ConnectionSettingsRepository,
    private readonly credentialEncryption: CredentialEncryptionService,
  ) {}

  public async listConnections(account: AuthAccount) {
    if (account.role !== "owner") throw new Error("OWNER_REQUIRED");
    if (!this.repository.listConnectionsForOrganization)
      throw new Error("CONNECTION_LIST_NOT_CONFIGURED");
    return this.repository.listConnectionsForOrganization(
      account.organizationId,
    );
  }

  public async replaceCredential(input: {
    account: AuthAccount;
    connectionId: string;
    apiKey: string;
  }) {
    if (input.account.role !== "owner") throw new Error("OWNER_REQUIRED");
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new Error("INVALID_CONNECTION_INPUT");
    if (!this.repository.updateConnectionSecretEnvelope)
      throw new Error("CONNECTION_UPDATE_NOT_CONFIGURED");
    if (
      !(await this.repository.findConnectionForOrganization({
        organizationId: input.account.organizationId,
        connectionId: input.connectionId,
      }))
    )
      throw new Error("CONNECTION_NOT_FOUND");
    const updated = await this.repository.updateConnectionSecretEnvelope({
      organizationId: input.account.organizationId,
      connectionId: input.connectionId,
      encryptedEnvelope: await this.credentialEncryption.encrypt(apiKey),
    });
    if (!updated) throw new Error("CONNECTION_NOT_FOUND");
    return updated;
  }

  public async createConnection(input: {
    account: AuthAccount;
    name: string;
    apiKey: string;
  }): Promise<RedactedConnection> {
    if (input.account.role !== "owner") {
      throw new Error("OWNER_REQUIRED");
    }

    const name = input.name.trim();
    const apiKey = input.apiKey.trim();

    if (name.length === 0 || name.length > 200 || apiKey.length === 0) {
      throw new Error("INVALID_CONNECTION_INPUT");
    }

    return this.repository.createConnection({
      organizationId: input.account.organizationId,
      name,
      encryptedEnvelope: await this.credentialEncryption.encrypt(apiKey),
    });
  }

  public async findConnection(input: {
    account: AuthAccount;
    connectionId: string;
  }): Promise<RedactedConnection | null> {
    if (input.account.role !== "owner") {
      throw new Error("OWNER_REQUIRED");
    }

    return this.repository.findConnectionForOrganization({
      organizationId: input.account.organizationId,
      connectionId: input.connectionId,
    });
  }
}
