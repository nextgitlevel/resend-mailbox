import type { AuthAccount } from "../auth/auth-service.js";
import type {
  ConnectionLookupInput,
  EncryptedSecretEnvelope,
} from "../persistence/identity-repository.js";
import { CredentialEncryptionService } from "./credential-encryption.js";
import {
  type ConnectionValidationStatus,
  type ResendValidationClient,
} from "./resend-validation-client.js";

export interface ConnectionValidationRepository {
  findSecretEnvelopeForOrganization(
    input: ConnectionLookupInput,
  ): Promise<EncryptedSecretEnvelope | null>;
}

export class ConnectionValidationService {
  public constructor(
    private readonly repository: ConnectionValidationRepository,
    private readonly credentialEncryption: CredentialEncryptionService,
    private readonly validationClient: ResendValidationClient,
  ) {}

  public async validateConnection(input: {
    account: AuthAccount;
    connectionId: string;
  }): Promise<ConnectionValidationStatus> {
    if (input.account.role !== "owner") {
      throw new Error("OWNER_REQUIRED");
    }

    const envelope = await this.repository.findSecretEnvelopeForOrganization({
      organizationId: input.account.organizationId,
      connectionId: input.connectionId,
    });

    if (!envelope) {
      throw new Error("CONNECTION_NOT_FOUND");
    }

    try {
      const credential = await this.credentialEncryption.decrypt(envelope);
      return await this.validationClient.validate(credential);
    } catch {
      return "unavailable";
    }
  }
}
