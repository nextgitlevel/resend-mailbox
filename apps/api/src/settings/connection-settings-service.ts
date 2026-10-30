import type { AuthAccount } from "../auth/auth-service.js";
import type {
  EncryptedSecretEnvelope,
  RedactedConnection,
} from "../persistence/identity-repository.js";
import { CredentialEncryptionService } from "./credential-encryption.js";

export interface ConnectionSettingsRepository {
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
