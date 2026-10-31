import type {
  ConnectionLookupInput,
  EncryptedSecretEnvelope,
} from "../persistence/identity-repository.js";
import { CredentialEncryptionService } from "../settings/credential-encryption.js";

export interface OutboundCredentialRepository {
  findSecretEnvelopeForOrganization(
    input: ConnectionLookupInput,
  ): Promise<EncryptedSecretEnvelope | null>;
}

export interface ResendSendClient {
  send(input: {
    credential: string;
    idempotencyKey: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    replyTo: string | null;
  }): Promise<{ kind: "sent" } | { kind: "retryable" } | { kind: "failed" }>;
}

export class ResendOutboundTransport {
  public constructor(
    private readonly repository: OutboundCredentialRepository,
    private readonly encryption: CredentialEncryptionService,
    private readonly client: ResendSendClient,
  ) {}

  public async dispatch(input: {
    organizationId: string;
    connectionId: string;
    idempotencyKey: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    replyTo: string | null;
  }): Promise<{ kind: "sent" } | { kind: "retryable" } | { kind: "failed" }> {
    const envelope = await this.repository.findSecretEnvelopeForOrganization({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });
    if (!envelope) return { kind: "failed" };
    let credential: string;
    try {
      credential = await this.encryption.decrypt(envelope);
    } catch {
      return { kind: "failed" };
    }
    try {
      return await this.client.send({
        credential,
        idempotencyKey: input.idempotencyKey,
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        replyTo: input.replyTo,
      });
    } catch {
      return { kind: "retryable" };
    }
  }
}
