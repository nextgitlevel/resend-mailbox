import type { AuthAccount } from "../auth/auth-service.js";
import type {
  DomainFallbackPolicy,
  DomainVerificationStatus,
} from "../routing/recipient-router.js";

export interface RedactedDomain {
  id: string;
  organizationId: string;
  connectionId: string;
  name: string;
  verificationStatus: DomainVerificationStatus;
  fallback: DomainFallbackPolicy;
}

export interface Mailbox {
  id: string;
  organizationId: string;
  name: string;
}

export interface AllowedAddress {
  id: string;
  organizationId: string;
  domainId: string;
  mailboxId: string;
  localPart: string;
}

export interface DomainSettingsRepository {
  findConnectionForOrganization(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ id: string } | null>;
  createDomain(input: {
    organizationId: string;
    connectionId: string;
    name: string;
    fallback: DomainFallbackPolicy;
  }): Promise<RedactedDomain>;
  createMailbox(input: {
    organizationId: string;
    name: string;
  }): Promise<Mailbox>;
  findDomainForOrganization(input: {
    organizationId: string;
    domainId: string;
  }): Promise<RedactedDomain | null>;
  findMailboxForOrganization(input: {
    organizationId: string;
    mailboxId: string;
  }): Promise<Mailbox | null>;
  createAllowedAddress(input: {
    organizationId: string;
    domainId: string;
    mailboxId: string;
    localPart: string;
  }): Promise<AllowedAddress>;
}

export class DomainSettingsService {
  public constructor(private readonly repository: DomainSettingsRepository) {}

  public async createDomain(input: {
    account: AuthAccount;
    connectionId: string;
    name: string;
    fallback: DomainFallbackPolicy;
  }): Promise<RedactedDomain> {
    requireOwner(input.account);
    const name = normalizeDomain(input.name);

    if (!isValidDomain(name) || !isValidFallback(input.fallback)) {
      throw new Error("INVALID_DOMAIN_INPUT");
    }

    if (
      !(await this.repository.findConnectionForOrganization({
        organizationId: input.account.organizationId,
        connectionId: input.connectionId,
      }))
    ) {
      throw new Error("CONNECTION_NOT_FOUND");
    }

    return this.repository.createDomain({
      organizationId: input.account.organizationId,
      connectionId: input.connectionId,
      name,
      fallback: input.fallback,
    });
  }

  public async createMailbox(input: {
    account: AuthAccount;
    name: string;
  }): Promise<Mailbox> {
    requireOwner(input.account);
    const name = input.name.trim();

    if (name.length === 0 || name.length > 200) {
      throw new Error("INVALID_MAILBOX_INPUT");
    }

    return this.repository.createMailbox({
      organizationId: input.account.organizationId,
      name,
    });
  }

  public async createAllowedAddress(input: {
    account: AuthAccount;
    domainId: string;
    mailboxId: string;
    localPart: string;
  }): Promise<AllowedAddress> {
    requireOwner(input.account);
    const localPart = normalizeLocalPart(input.localPart);

    if (!isValidLocalPart(localPart)) {
      throw new Error("INVALID_ALLOWED_ADDRESS_INPUT");
    }

    const organizationId = input.account.organizationId;
    const [domain, mailbox] = await Promise.all([
      this.repository.findDomainForOrganization({
        organizationId,
        domainId: input.domainId,
      }),
      this.repository.findMailboxForOrganization({
        organizationId,
        mailboxId: input.mailboxId,
      }),
    ]);

    if (!domain || !mailbox) {
      throw new Error("DOMAIN_OR_MAILBOX_NOT_FOUND");
    }

    if (domain.verificationStatus !== "verified") {
      throw new Error("DOMAIN_NOT_VERIFIED");
    }

    return this.repository.createAllowedAddress({
      organizationId,
      domainId: domain.id,
      mailboxId: mailbox.id,
      localPart,
    });
  }
}

const requireOwner = (account: AuthAccount) => {
  if (account.role !== "owner") {
    throw new Error("OWNER_REQUIRED");
  }
};

const normalizeDomain = (value: string) => value.trim().toLowerCase();

const normalizeLocalPart = (value: string) => value.trim().toLowerCase();

const isValidDomain = (value: string) =>
  value.length <= 253 &&
  value.split(".").length >= 2 &&
  value
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));

const isValidLocalPart = (value: string) =>
  value.length > 0 &&
  value.length <= 64 &&
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(value);

const isValidFallback = (fallback: DomainFallbackPolicy) =>
  fallback.kind !== "catch_all" || fallback.mailboxId.trim().length > 0;
