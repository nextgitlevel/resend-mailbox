import assert from "node:assert/strict";
import test from "node:test";

import type { AuthAccount } from "../src/auth/auth-service.js";
import { DomainVerificationService } from "../src/domains/domain-verification-service.js";

const owner: AuthAccount = {
  userId: "owner-1",
  organizationId: "organization-1",
  email: "owner@example.test",
  role: "owner",
};

test("Owner refreshes only an organization-scoped domain using verifier output", async () => {
  const updates: unknown[] = [];
  const service = new DomainVerificationService(
    {
      findDomainForOrganization: async ({ organizationId, domainId }) =>
        organizationId === "organization-1" && domainId === "domain-1"
          ? {
              id: "domain-1",
              organizationId,
              connectionId: "connection-1",
              name: "example.test",
              verificationStatus: "pending",
              fallback: { kind: "quarantine" },
            }
          : null,
      updateDomainVerificationStatusForOrganization: async (input) => {
        updates.push(input);
        return {
          id: "domain-1",
          organizationId: "organization-1",
          connectionId: "connection-1",
          name: "example.test",
          verificationStatus: input.verificationStatus,
          fallback: { kind: "quarantine" },
        };
      },
    },
    { verify: async () => "verified" },
  );

  const result = await service.refreshDomain({
    account: owner,
    domainId: "domain-1",
  });

  assert.equal(result.verificationStatus, "verified");
  assert.deepEqual(updates, [
    {
      organizationId: "organization-1",
      domainId: "domain-1",
      verificationStatus: "verified",
    },
  ]);
});

test("refresh conceals a foreign domain, rejects members, and fails closed on invalid verifier output", async () => {
  let lookups = 0;
  const repository = {
    findDomainForOrganization: async ({ domainId }: { domainId: string }) => {
      lookups += 1;
      return domainId === "invalid-result"
        ? {
            id: "invalid-result",
            organizationId: "organization-1",
            connectionId: "connection-1",
            name: "example.test",
            verificationStatus: "pending" as const,
            fallback: { kind: "quarantine" as const },
          }
        : null;
    },
    updateDomainVerificationStatusForOrganization: async () => {
      throw new Error("NOT_USED");
    },
  };
  const service = new DomainVerificationService(repository, {
    verify: async () => "unexpected" as never,
  });

  await assert.rejects(
    service.refreshDomain({ account: owner, domainId: "foreign" }),
    /DOMAIN_NOT_FOUND/,
  );
  await assert.rejects(
    service.refreshDomain({
      account: { ...owner, role: "member" },
      domainId: "domain-1",
    }),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    service.refreshDomain({ account: owner, domainId: "invalid-result" }),
    /INVALID_DOMAIN_VERIFICATION_RESULT/,
  );
  assert.equal(lookups, 2);
});
