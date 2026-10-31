import assert from "node:assert/strict";
import test from "node:test";

import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";
import { buildApp } from "../src/app.js";
import { DomainVerificationService } from "../src/domains/domain-verification-service.js";

const cookie =
  "resend_mailbox_session=verification-route-token-that-is-long-enough";
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

const verificationService = (status: "pending" | "verified" = "verified") =>
  new DomainVerificationService(
    {
      findDomainForOrganization: async () => ({
        id: "domain-1",
        organizationId: "organization-1",
        connectionId: "connection-1",
        name: "example.test",
        verificationStatus: "pending",
        fallback: { kind: "quarantine" },
      }),
      updateDomainVerificationStatusForOrganization: async (input) => ({
        id: "domain-1",
        organizationId: input.organizationId,
        connectionId: "connection-1",
        name: "example.test",
        verificationStatus: input.verificationStatus,
        fallback: { kind: "quarantine" },
      }),
    },
    { verify: async () => status },
  );

test("domain verification refresh is Owner-only, session-scoped, and unavailable without composition", async (t) => {
  const configured = buildApp({
    authService: auth(),
    domainVerificationService: verificationService("pending"),
  });
  const member = buildApp({
    authService: auth("member"),
    domainVerificationService: verificationService(),
  });
  const unavailable = buildApp({ authService: auth() });
  t.after(async () =>
    Promise.all([configured.close(), member.close(), unavailable.close()]),
  );

  const success = await configured.inject({
    method: "POST",
    url: "/v1/domains/domain-1/verify",
    headers: { cookie },
    payload: { verificationStatus: "verified" },
  });
  const forbidden = await member.inject({
    method: "POST",
    url: "/v1/domains/domain-1/verify",
    headers: { cookie },
  });
  const unauthenticated = await configured.inject({
    method: "POST",
    url: "/v1/domains/domain-1/verify",
  });
  const unconfigured = await unavailable.inject({
    method: "POST",
    url: "/v1/domains/domain-1/verify",
    headers: { cookie },
  });

  assert.equal(success.statusCode, 200);
  assert.deepEqual(success.json().domain.verificationStatus, "pending");
  assert.equal(forbidden.statusCode, 403);
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unconfigured.statusCode, 503);
  assert.deepEqual(unconfigured.json(), {
    error: "DOMAIN_VERIFICATION_NOT_CONFIGURED",
  });
});
