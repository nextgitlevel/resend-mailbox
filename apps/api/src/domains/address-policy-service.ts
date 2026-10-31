import type { AuthAccount } from "../auth/auth-service.js";
import type { RedactedDomain } from "./domain-settings-service.js";

export interface AddressPolicyAddress {
  id: string;
  organizationId: string;
  domainId: string;
  mailboxId: string;
  localPart: string;
  replyTo: string | null;
  isDefaultSender: boolean;
}

export interface AddressPolicyRepository {
  findAllowedAddressForOrganization(input: {
    organizationId: string;
    addressId: string;
  }): Promise<AddressPolicyAddress | null>;
  findDomainForOrganization(input: {
    organizationId: string;
    domainId: string;
  }): Promise<RedactedDomain | null>;
  updateAllowedAddressPolicyForOrganization(input: {
    organizationId: string;
    addressId: string;
    replyTo: string | null;
    isDefaultSender: boolean;
  }): Promise<AddressPolicyAddress | null>;
}

export class AddressPolicyService {
  public constructor(private readonly repository: AddressPolicyRepository) {}

  public async configure(input: {
    account: AuthAccount;
    addressId: string;
    replyTo: string | null;
    isDefaultSender: boolean;
  }): Promise<AddressPolicyAddress> {
    if (input.account.role !== "owner") throw new Error("OWNER_REQUIRED");
    const address = await this.repository.findAllowedAddressForOrganization({
      organizationId: input.account.organizationId,
      addressId: input.addressId,
    });
    if (!address) throw new Error("ALLOWED_ADDRESS_NOT_FOUND");
    const domain = await this.repository.findDomainForOrganization({
      organizationId: input.account.organizationId,
      domainId: address.domainId,
    });
    if (!domain || domain.verificationStatus !== "verified")
      throw new Error("DOMAIN_NOT_VERIFIED");
    const replyTo =
      input.replyTo === null
        ? null
        : normalizeReplyTo(input.replyTo, domain.name);
    if (input.replyTo !== null && !replyTo) throw new Error("INVALID_REPLY_TO");
    const updated =
      await this.repository.updateAllowedAddressPolicyForOrganization({
        organizationId: input.account.organizationId,
        addressId: address.id,
        replyTo,
        isDefaultSender: input.isDefaultSender,
      });
    if (!updated) throw new Error("ALLOWED_ADDRESS_NOT_FOUND");
    return updated;
  }
}

const normalizeReplyTo = (value: string, domain: string) => {
  const normalized = value.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator !== normalized.indexOf("@")) return null;
  const localPart = normalized.slice(0, separator);
  const replyDomain = normalized.slice(separator + 1);
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) &&
    replyDomain === domain
    ? normalized
    : null;
};
