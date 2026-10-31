import type { AuthAccount } from "../auth/auth-service.js";
import type { DomainVerificationStatus } from "../routing/recipient-router.js";
import type { RedactedDomain } from "./domain-settings-service.js";
import type { DomainVerificationClient } from "./domain-verification-client.js";

interface DomainVerificationRepository {
  findDomainForOrganization(input: {
    organizationId: string;
    domainId: string;
  }): Promise<RedactedDomain | null>;
  updateDomainVerificationStatusForOrganization(input: {
    organizationId: string;
    domainId: string;
    verificationStatus: DomainVerificationStatus;
  }): Promise<RedactedDomain | null>;
}

export class DomainVerificationService {
  public constructor(
    private readonly repository: DomainVerificationRepository,
    private readonly client: DomainVerificationClient,
  ) {}

  public async refreshDomain(input: {
    account: AuthAccount;
    domainId: string;
  }): Promise<RedactedDomain> {
    if (input.account.role !== "owner") throw new Error("OWNER_REQUIRED");
    const domain = await this.repository.findDomainForOrganization({
      organizationId: input.account.organizationId,
      domainId: input.domainId,
    });
    if (!domain) throw new Error("DOMAIN_NOT_FOUND");

    const verificationStatus = await this.client.verify({
      connectionId: domain.connectionId,
      domainName: domain.name,
    });
    if (!isVerificationStatus(verificationStatus)) {
      throw new Error("INVALID_DOMAIN_VERIFICATION_RESULT");
    }
    const updated =
      await this.repository.updateDomainVerificationStatusForOrganization({
        organizationId: input.account.organizationId,
        domainId: domain.id,
        verificationStatus,
      });
    if (!updated) throw new Error("DOMAIN_NOT_FOUND");
    return updated;
  }
}

const isVerificationStatus = (
  value: unknown,
): value is DomainVerificationStatus =>
  value === "pending" || value === "verified" || value === "failed";
