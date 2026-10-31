import type {
  ConnectionLookupInput,
  EncryptedSecretEnvelope,
} from "../persistence/identity-repository.js";
import { CredentialEncryptionService } from "../settings/credential-encryption.js";
import type { DomainVerificationClient } from "./domain-verification-client.js";

export interface DomainVerificationCredentialRepository {
  findSecretEnvelopeForOrganization(
    input: ConnectionLookupInput,
  ): Promise<EncryptedSecretEnvelope | null>;
}

export class ResendDomainVerificationClient implements DomainVerificationClient {
  public constructor(
    private readonly repository: DomainVerificationCredentialRepository,
    private readonly encryption: CredentialEncryptionService,
    private readonly request: typeof fetch = fetch,
  ) {}

  public async verify(input: {
    organizationId: string;
    connectionId: string;
    domainName: string;
  }) {
    const envelope = await this.repository.findSecretEnvelopeForOrganization({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });
    if (!envelope) throw new Error("RESEND_CONNECTION_NOT_FOUND");
    let credential: string;
    try {
      credential = await this.encryption.decrypt(envelope);
    } catch {
      throw new Error("RESEND_CREDENTIAL_DECRYPTION_FAILED");
    }

    let after: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ limit: "100" });
      if (after) query.set("after", after);
      let response: Response;
      try {
        response = await this.request(
          `https://api.resend.com/domains?${query.toString()}`,
          {
            headers: { Authorization: `Bearer ${credential}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch {
        throw new Error("RESEND_DOMAIN_VERIFICATION_UNAVAILABLE");
      }
      if (response.status === 401) throw new Error("RESEND_CREDENTIAL_INVALID");
      if (!response.ok)
        throw new Error("RESEND_DOMAIN_VERIFICATION_UNAVAILABLE");

      const payload: unknown = await response.json().catch(() => null);
      if (!isDomainList(payload))
        throw new Error("INVALID_RESEND_DOMAIN_RESPONSE");
      const domain = payload.data.find(
        (candidate) =>
          candidate.name.toLowerCase() === input.domainName.toLowerCase(),
      );
      if (domain) {
        if (domain.status === "verified") return "verified" as const;
        if (domain.status === "failed") return "failed" as const;
        return "pending" as const;
      }
      if (!payload.has_more) throw new Error("RESEND_DOMAIN_NOT_FOUND");
      after = payload.data.at(-1)?.id;
      if (!after) throw new Error("INVALID_RESEND_DOMAIN_RESPONSE");
    }
    throw new Error("RESEND_DOMAIN_NOT_FOUND");
  }
}

interface ResendDomainList {
  has_more: boolean;
  data: Array<{ id: string; name: string; status: string }>;
}

const isDomainList = (value: unknown): value is ResendDomainList =>
  typeof value === "object" &&
  value !== null &&
  "has_more" in value &&
  typeof value.has_more === "boolean" &&
  "data" in value &&
  Array.isArray(value.data) &&
  value.data.every(
    (domain) =>
      typeof domain === "object" &&
      domain !== null &&
      "id" in domain &&
      typeof domain.id === "string" &&
      "name" in domain &&
      typeof domain.name === "string" &&
      "status" in domain &&
      typeof domain.status === "string",
  );
