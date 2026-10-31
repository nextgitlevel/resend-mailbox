import assert from "node:assert/strict";
import test from "node:test";

import {
  RecipientRouter,
  type RoutingDomain,
} from "../src/routing/recipient-router.js";

const verifiedDomain = (
  overrides: Partial<RoutingDomain> = {},
): RoutingDomain => ({
  id: "domain-nextlevel",
  organizationId: "organization-1",
  name: "nextlevelmaintenance.com",
  verificationStatus: "verified",
  fallback: { kind: "quarantine" },
  addresses: [],
  ...overrides,
});

test("an allowed recipient routes to only its assigned mailbox after normalization", () => {
  const router = new RecipientRouter();
  const result = router.route({
    organizationId: "organization-1",
    recipient: " Marcus@NextLevelMaintenance.com ",
    domains: [
      verifiedDomain({
        addresses: [{ localPart: "marcus", mailboxId: "mailbox-marcus" }],
      }),
    ],
  });

  assert.deepEqual(result, {
    kind: "mailbox",
    domainId: "domain-nextlevel",
    mailboxId: "mailbox-marcus",
  });
});

test("same local parts route independently by verified normalized domain", () => {
  const router = new RecipientRouter();
  const result = router.route({
    organizationId: "organization-1",
    recipient: "support@other.example",
    domains: [
      verifiedDomain({
        addresses: [{ localPart: "support", mailboxId: "mailbox-primary" }],
      }),
      verifiedDomain({
        id: "domain-other",
        name: "other.example",
        addresses: [{ localPart: "support", mailboxId: "mailbox-other" }],
      }),
    ],
  });

  assert.deepEqual(result, {
    kind: "mailbox",
    domainId: "domain-other",
    mailboxId: "mailbox-other",
  });
});

test("unknown recipients use the explicit catch-all, quarantine, or discard policy", () => {
  const router = new RecipientRouter();

  assert.deepEqual(
    router.route({
      organizationId: "organization-1",
      recipient: "unknown@nextlevelmaintenance.com",
      domains: [
        verifiedDomain({
          fallback: { kind: "catch_all", mailboxId: "mailbox-catchall" },
        }),
      ],
    }),
    {
      kind: "mailbox",
      domainId: "domain-nextlevel",
      mailboxId: "mailbox-catchall",
    },
  );
  assert.deepEqual(
    router.route({
      organizationId: "organization-1",
      recipient: "unknown@nextlevelmaintenance.com",
      domains: [verifiedDomain()],
    }),
    { kind: "quarantine", domainId: "domain-nextlevel" },
  );
  assert.deepEqual(
    router.route({
      organizationId: "organization-1",
      recipient: "unknown@nextlevelmaintenance.com",
      domains: [verifiedDomain({ fallback: { kind: "discard" } })],
    }),
    { kind: "discard", domainId: "domain-nextlevel" },
  );
});

test("unverified, foreign, malformed, and unknown domains never route mail", () => {
  const router = new RecipientRouter();
  const domain = verifiedDomain({
    addresses: [{ localPart: "marcus", mailboxId: "mailbox-marcus" }],
  });

  for (const input of [
    {
      recipient: "marcus@nextlevelmaintenance.com",
      domains: [{ ...domain, verificationStatus: "pending" as const }],
    },
    {
      recipient: "marcus@nextlevelmaintenance.com",
      domains: [{ ...domain, organizationId: "organization-2" }],
    },
    { recipient: "not-an-email", domains: [domain] },
    { recipient: "marcus@unknown.example", domains: [domain] },
  ]) {
    assert.deepEqual(
      router.route({ organizationId: "organization-1", ...input }),
      { kind: "reject" },
    );
  }
});
