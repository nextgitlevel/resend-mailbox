export type DomainVerificationStatus = "pending" | "verified" | "failed";

export type DomainFallbackPolicy =
  | { kind: "catch_all"; mailboxId: string }
  | { kind: "quarantine" }
  | { kind: "discard" };

export interface AllowedRecipientAddress {
  localPart: string;
  mailboxId: string;
}

export interface RoutingDomain {
  id: string;
  organizationId: string;
  name: string;
  verificationStatus: DomainVerificationStatus;
  fallback: DomainFallbackPolicy;
  addresses: AllowedRecipientAddress[];
}

export type RecipientRoutingOutcome =
  | { kind: "mailbox"; domainId: string; mailboxId: string }
  | { kind: "quarantine"; domainId: string }
  | { kind: "discard"; domainId: string }
  | { kind: "reject" };

/**
 * Applies the organization-scoped recipient policy after an inbound provider
 * has authenticated an envelope recipient. It deliberately has no persistence
 * or provider dependency so webhook workers can use the exact same policy.
 */
export class RecipientRouter {
  public route(input: {
    organizationId: string;
    recipient: string;
    domains: RoutingDomain[];
  }): RecipientRoutingOutcome {
    const recipient = parseRecipient(input.recipient);

    if (!recipient) {
      return { kind: "reject" };
    }

    const domain = input.domains.find(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.verificationStatus === "verified" &&
        normalizeDomain(candidate.name) === recipient.domain,
    );

    if (!domain) {
      return { kind: "reject" };
    }

    const address = domain.addresses.find(
      (candidate) =>
        normalizeLocalPart(candidate.localPart) === recipient.localPart,
    );

    if (address) {
      return {
        kind: "mailbox",
        domainId: domain.id,
        mailboxId: address.mailboxId,
      };
    }

    if (domain.fallback.kind === "catch_all") {
      return {
        kind: "mailbox",
        domainId: domain.id,
        mailboxId: domain.fallback.mailboxId,
      };
    }

    return domain.fallback.kind === "quarantine"
      ? { kind: "quarantine", domainId: domain.id }
      : { kind: "discard", domainId: domain.id };
  }
}

const parseRecipient = (value: string) => {
  const normalized = value.trim();
  const separator = normalized.lastIndexOf("@");

  if (
    separator <= 0 ||
    separator !== normalized.indexOf("@") ||
    separator === normalized.length - 1
  ) {
    return null;
  }

  const localPart = normalizeLocalPart(normalized.slice(0, separator));
  const domain = normalizeDomain(normalized.slice(separator + 1));

  return localPart && domain ? { localPart, domain } : null;
};

const normalizeLocalPart = (value: string) => value.trim().toLowerCase();

const normalizeDomain = (value: string) => value.trim().toLowerCase();
