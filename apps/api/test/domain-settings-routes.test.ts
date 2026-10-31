import assert from "node:assert/strict";
import test from "node:test";

import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";
import { buildApp } from "../src/app.js";
import {
  DomainSettingsService,
  type DomainSettingsRepository,
} from "../src/domains/domain-settings-service.js";

const cookie = "resend_mailbox_session=route-session-token-for-test-only";
const createAuthService = (role: "owner" | "member" = "owner") =>
  new AuthService(
    {
      hasOwner: async () => true,
      bootstrapOwnerWithPassword: async () => {
        throw new Error("NOT_USED");
      },
      findUserForLogin: async () => null,
      createSession: async () => {},
      findSessionByTokenHash: async () => ({
        userId: "owner-1",
        organizationId: "organization-1",
        email: "owner@example.test",
        role,
        expiresAt: new Date("2026-12-01"),
        revokedAt: null,
      }),
    } satisfies AuthRepository,
    { randomToken: () => "route-session-token-for-test-only" },
  );

const createDomainService = () =>
  new DomainSettingsService({
    findConnectionForOrganization: async () => ({ id: "connection-1" }),
    createDomain: async (input) => ({
      id: "domain-1",
      ...input,
      verificationStatus: "pending",
    }),
    createMailbox: async (input) => ({ id: "mailbox-1", ...input }),
    findDomainForOrganization: async () => null,
    findMailboxForOrganization: async () => null,
    createAllowedAddress: async () => {
      throw new Error("NOT_USED");
    },
  } satisfies DomainSettingsRepository);

test("domain and mailbox configuration routes require an Owner and derive organization from the session", async (t) => {
  const app = buildApp({
    authService: createAuthService(),
    domainSettingsService: createDomainService(),
  });
  t.after(() => app.close());
  const domain = await app.inject({
    method: "POST",
    url: "/v1/connections/connection-1/domains",
    headers: { cookie },
    payload: {
      name: "NextLevelMaintenance.com",
      fallback: { kind: "quarantine" },
    },
  });
  const mailbox = await app.inject({
    method: "POST",
    url: "/v1/mailboxes",
    headers: { cookie },
    payload: { name: "Primary" },
  });
  const unauthenticated = await app.inject({
    method: "POST",
    url: "/v1/mailboxes",
    payload: { name: "Primary" },
  });
  assert.equal(domain.statusCode, 201);
  assert.deepEqual(domain.json(), {
    domain: {
      id: "domain-1",
      organizationId: "organization-1",
      connectionId: "connection-1",
      name: "nextlevelmaintenance.com",
      verificationStatus: "pending",
      fallback: { kind: "quarantine" },
    },
  });
  assert.equal(mailbox.statusCode, 201);
  assert.equal(unauthenticated.statusCode, 401);
});

test("allowed-address configuration is Owner-only and derives its organization from the session", async (t) => {
  const createdAddresses: unknown[] = [];
  const domainSettingsService = new DomainSettingsService({
    findConnectionForOrganization: async () => ({ id: "connection-1" }),
    createDomain: async () => {
      throw new Error("NOT_USED");
    },
    createMailbox: async () => {
      throw new Error("NOT_USED");
    },
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
      name: "Primary",
    }),
    createAllowedAddress: async (input) => {
      createdAddresses.push(input);
      return { id: "address-1", ...input };
    },
  } satisfies DomainSettingsRepository);
  const app = buildApp({
    authService: createAuthService(),
    domainSettingsService,
  });
  const memberApp = buildApp({
    authService: createAuthService("member"),
    domainSettingsService,
  });
  t.after(async () => Promise.all([app.close(), memberApp.close()]));

  const created = await app.inject({
    method: "POST",
    url: "/v1/domains/domain-1/addresses",
    headers: { cookie },
    payload: { mailboxId: "mailbox-1", localPart: "Support" },
  });
  const unauthenticated = await app.inject({
    method: "POST",
    url: "/v1/domains/domain-1/addresses",
    payload: { mailboxId: "mailbox-1", localPart: "Support" },
  });
  const forbidden = await memberApp.inject({
    method: "POST",
    url: "/v1/domains/domain-1/addresses",
    headers: { cookie },
    payload: { mailboxId: "mailbox-1", localPart: "Support" },
  });

  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json(), {
    address: {
      id: "address-1",
      organizationId: "organization-1",
      domainId: "domain-1",
      mailboxId: "mailbox-1",
      localPart: "support",
    },
  });
  assert.deepEqual(createdAddresses, [
    {
      organizationId: "organization-1",
      domainId: "domain-1",
      mailboxId: "mailbox-1",
      localPart: "support",
    },
  ]);
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
});
