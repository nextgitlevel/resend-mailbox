import assert from "node:assert/strict";
import test from "node:test";

import type { AuthAccount } from "../src/auth/auth-service.js";
import {
  DomainSettingsService,
  type DomainSettingsRepository,
} from "../src/domains/domain-settings-service.js";

const owner: AuthAccount = {
  userId: "owner-1",
  organizationId: "organization-1",
  email: "owner@example.test",
  role: "owner",
};

const createRepository = (): DomainSettingsRepository & {
  createdDomains: unknown[];
  createdAddresses: unknown[];
} => {
  const createdDomains: unknown[] = [];
  const createdAddresses: unknown[] = [];
  return {
    createdDomains,
    createdAddresses,
    findConnectionForOrganization: async () => ({ id: "connection-1" }),
    createDomain: async (input) => {
      createdDomains.push(input);
      return { id: "domain-1", ...input, verificationStatus: "pending" };
    },
    createMailbox: async (input) => ({ id: "mailbox-1", ...input }),
    findDomainForOrganization: async () => ({
      id: "domain-1",
      organizationId: "organization-1",
      connectionId: "connection-1",
      name: "nextlevelmaintenance.com",
      verificationStatus: "verified",
      fallback: { kind: "quarantine" },
    }),
    findMailboxForOrganization: async () => ({
      id: "mailbox-1",
      organizationId: "organization-1",
      name: "Marcus",
    }),
    createAllowedAddress: async (input) => {
      createdAddresses.push(input);
      return { id: "address-1", ...input };
    },
  };
};

test("Owner creates a normalized pending domain with an explicit fallback policy", async () => {
  const repository = createRepository();
  const service = new DomainSettingsService(repository);

  const domain = await service.createDomain({
    account: owner,
    connectionId: "connection-1",
    name: " NextLevelMaintenance.COM ",
    fallback: { kind: "quarantine" },
  });

  assert.deepEqual(domain, {
    id: "domain-1",
    organizationId: "organization-1",
    connectionId: "connection-1",
    name: "nextlevelmaintenance.com",
    verificationStatus: "pending",
    fallback: { kind: "quarantine" },
  });
  assert.deepEqual(repository.createdDomains, [
    {
      organizationId: "organization-1",
      connectionId: "connection-1",
      name: "nextlevelmaintenance.com",
      fallback: { kind: "quarantine" },
    },
  ]);
});

test("only an Owner can configure domains, and a foreign connection is concealed", async () => {
  const repository = createRepository();
  repository.findConnectionForOrganization = async () => null;
  const service = new DomainSettingsService(repository);

  await assert.rejects(
    service.createDomain({
      account: { ...owner, role: "member" },
      connectionId: "connection-1",
      name: "nextlevelmaintenance.com",
      fallback: { kind: "discard" },
    }),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    service.createDomain({
      account: owner,
      connectionId: "foreign-connection",
      name: "nextlevelmaintenance.com",
      fallback: { kind: "discard" },
    }),
    /CONNECTION_NOT_FOUND/,
  );
});

test("a catch-all domain rejects a mailbox outside the Owner organization before persistence", async () => {
  const repository = createRepository();
  repository.findMailboxForOrganization = async () => null;
  const service = new DomainSettingsService(repository);

  await assert.rejects(
    service.createDomain({
      account: owner,
      connectionId: "connection-1",
      name: "nextlevelmaintenance.com",
      fallback: { kind: "catch_all", mailboxId: "foreign-mailbox" },
    }),
    /DOMAIN_FALLBACK_MAILBOX_NOT_FOUND/,
  );
  assert.deepEqual(repository.createdDomains, []);
});

test("an allowed recipient requires a verified domain and mailbox in the same organization", async () => {
  const repository = createRepository();
  const service = new DomainSettingsService(repository);

  const address = await service.createAllowedAddress({
    account: owner,
    domainId: "domain-1",
    mailboxId: "mailbox-1",
    localPart: " Support ",
  });

  assert.deepEqual(address, {
    id: "address-1",
    organizationId: "organization-1",
    domainId: "domain-1",
    mailboxId: "mailbox-1",
    localPart: "support",
  });

  repository.findDomainForOrganization = async () => ({
    id: "domain-1",
    organizationId: "organization-1",
    connectionId: "connection-1",
    name: "nextlevelmaintenance.com",
    verificationStatus: "pending",
    fallback: { kind: "quarantine" },
  });
  await assert.rejects(
    service.createAllowedAddress({
      account: owner,
      domainId: "domain-1",
      mailboxId: "mailbox-1",
      localPart: "support",
    }),
    /DOMAIN_NOT_VERIFIED/,
  );
});
