import assert from "node:assert/strict";
import test from "node:test";

import type { AuthAccount } from "../src/auth/auth-service.js";
import { AddressPolicyService } from "../src/domains/address-policy-service.js";

const owner: AuthAccount = {
  userId: "owner-1",
  organizationId: "organization-1",
  email: "owner@example.test",
  role: "owner",
};

test("Owner configures a same-domain reply-to and default sender", async () => {
  const updates: unknown[] = [];
  const service = new AddressPolicyService({
    findAllowedAddressForOrganization: async () => ({
      id: "address-1",
      organizationId: "organization-1",
      domainId: "domain-1",
      mailboxId: "mailbox-1",
      localPart: "support",
      replyTo: null,
      isDefaultSender: false,
    }),
    findDomainForOrganization: async () => ({
      id: "domain-1",
      organizationId: "organization-1",
      connectionId: "connection-1",
      name: "example.test",
      verificationStatus: "verified",
      fallback: { kind: "quarantine" },
    }),
    updateAllowedAddressPolicyForOrganization: async (input) => {
      updates.push(input);
      return {
        id: "address-1",
        organizationId: "organization-1",
        domainId: "domain-1",
        mailboxId: "mailbox-1",
        localPart: "support",
        replyTo: input.replyTo,
        isDefaultSender: input.isDefaultSender,
      };
    },
  });

  const address = await service.configure({
    account: owner,
    addressId: "address-1",
    replyTo: "Reply@Example.Test",
    isDefaultSender: true,
  });
  assert.equal(address.replyTo, "reply@example.test");
  assert.equal(address.isDefaultSender, true);
  assert.deepEqual(updates, [
    {
      organizationId: "organization-1",
      addressId: "address-1",
      replyTo: "reply@example.test",
      isDefaultSender: true,
    },
  ]);
});

test("policy rejects members, foreign addresses, unverified domains, and foreign reply-to domains", async () => {
  const service = new AddressPolicyService({
    findAllowedAddressForOrganization: async () => null,
    findDomainForOrganization: async () => null,
    updateAllowedAddressPolicyForOrganization: async () => {
      throw new Error("NOT_USED");
    },
  });
  await assert.rejects(
    service.configure({
      account: { ...owner, role: "member" },
      addressId: "address-1",
      replyTo: null,
      isDefaultSender: false,
    }),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    service.configure({
      account: owner,
      addressId: "foreign",
      replyTo: null,
      isDefaultSender: false,
    }),
    /ALLOWED_ADDRESS_NOT_FOUND/,
  );

  const address = {
    id: "address-1",
    organizationId: "organization-1",
    domainId: "domain-1",
    mailboxId: "mailbox-1",
    localPart: "support",
    replyTo: null,
    isDefaultSender: false,
  };
  const unverified = new AddressPolicyService({
    findAllowedAddressForOrganization: async () => address,
    findDomainForOrganization: async () => ({
      id: "domain-1",
      organizationId: "organization-1",
      connectionId: "connection-1",
      name: "example.test",
      verificationStatus: "pending",
      fallback: { kind: "quarantine" },
    }),
    updateAllowedAddressPolicyForOrganization: async () => {
      throw new Error("NOT_USED");
    },
  });
  await assert.rejects(
    unverified.configure({
      account: owner,
      addressId: "address-1",
      replyTo: null,
      isDefaultSender: true,
    }),
    /DOMAIN_NOT_VERIFIED/,
  );

  const verified = new AddressPolicyService({
    findAllowedAddressForOrganization: async () => address,
    findDomainForOrganization: async () => ({
      id: "domain-1",
      organizationId: "organization-1",
      connectionId: "connection-1",
      name: "example.test",
      verificationStatus: "verified",
      fallback: { kind: "quarantine" },
    }),
    updateAllowedAddressPolicyForOrganization: async () => {
      throw new Error("NOT_USED");
    },
  });
  await assert.rejects(
    verified.configure({
      account: owner,
      addressId: "address-1",
      replyTo: "bad@example.test.attacker",
      isDefaultSender: false,
    }),
    /INVALID_REPLY_TO/,
  );
  await assert.rejects(
    verified.configure({
      account: owner,
      addressId: "address-1",
      replyTo: "two@@example.test",
      isDefaultSender: false,
    }),
    /INVALID_REPLY_TO/,
  );
});
