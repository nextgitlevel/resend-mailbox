import type { DomainVerificationStatus } from "../routing/recipient-router.js";

export interface DomainVerificationClient {
  verify(input: {
    organizationId: string;
    connectionId: string;
    domainName: string;
  }): Promise<DomainVerificationStatus>;
}

/** Deterministic test fixture; it never performs network I/O. */
export class FixtureDomainVerificationClient implements DomainVerificationClient {
  public constructor(
    private readonly outcomes: Readonly<
      Record<string, DomainVerificationStatus>
    >,
  ) {}

  public async verify(input: {
    connectionId: string;
    domainName: string;
  }): Promise<DomainVerificationStatus> {
    return (
      this.outcomes[`${input.connectionId}:${input.domainName}`] ?? "pending"
    );
  }
}
