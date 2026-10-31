import assert from "node:assert/strict";
import test from "node:test";

import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";
import { buildApp } from "../src/app.js";
import { AddressPolicyService } from "../src/domains/address-policy-service.js";

const cookie =
  "resend_mailbox_session=address-policy-route-token-that-is-long-enough";
const auth = (role: "owner" | "member" = "owner") =>
  new AuthService({
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
  } satisfies AuthRepository);

const policy = () =>
  new AddressPolicyService({
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
    updateAllowedAddressPolicyForOrganization: async (input) => ({
      id: "address-1",
      organizationId: input.organizationId,
      domainId: "domain-1",
      mailboxId: "mailbox-1",
      localPart: "support",
      replyTo: input.replyTo,
      isDefaultSender: input.isDefaultSender,
    }),
  });

test("address policy route is Owner-only and session-scoped", async (t) => {
  const app = buildApp({ authService: auth(), addressPolicyService: policy() });
  const member = buildApp({
    authService: auth("member"),
    addressPolicyService: policy(),
  });
  t.after(async () => Promise.all([app.close(), member.close()]));
  const success = await app.inject({
    method: "POST",
    url: "/v1/addresses/address-1/policy",
    headers: { cookie },
    payload: { replyTo: "Reply@Example.Test", isDefaultSender: true },
  });
  const denied = await member.inject({
    method: "POST",
    url: "/v1/addresses/address-1/policy",
    headers: { cookie },
    payload: { replyTo: null, isDefaultSender: false },
  });
  const invalid = await app.inject({
    method: "POST",
    url: "/v1/addresses/address-1/policy",
    headers: { cookie },
    payload: { replyTo: 1, isDefaultSender: true },
  });
  assert.equal(success.statusCode, 200);
  assert.equal(success.json().address.replyTo, "reply@example.test");
  assert.equal(denied.statusCode, 403);
  assert.equal(invalid.statusCode, 400);
});
