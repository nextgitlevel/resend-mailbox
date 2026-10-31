import assert from "node:assert/strict";
import test from "node:test";
import { InboundMessageProjector } from "../src/inbound/inbound-message-projector.js";

test("received mail projects only to its explicitly assigned mailbox", async () => {
  const projected: unknown[] = [];
  const projector = new InboundMessageProjector({
    domainsForRecipientDomain: async () => [
      {
        id: "d",
        organizationId: "o",
        name: "nextlevelmaintenance.com",
        verificationStatus: "verified",
        fallback: { kind: "quarantine" },
        addresses: [{ localPart: "marcus", mailboxId: "m" }],
      },
    ],
    project: async (input) => {
      projected.push(input);
    },
  });
  await projector.project({
    type: "email.received",
    data: {
      email_id: "e",
      to: ["marcus@nextlevelmaintenance.com"],
      subject: "Reply",
    },
  });
  assert.deepEqual(projected, [
    {
      providerEmailId: "e",
      recipient: "marcus@nextlevelmaintenance.com",
      subject: "Reply",
      outcome: "mailbox",
      mailboxId: "m",
    },
  ]);
});
