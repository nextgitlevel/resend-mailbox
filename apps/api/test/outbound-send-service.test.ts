import assert from "node:assert/strict";
import test from "node:test";

import type { AuthAccount } from "../src/auth/auth-service.js";
import { OutboundSendService } from "../src/outbound/outbound-send-service.js";

const owner: AuthAccount = {
  userId: "owner-1",
  organizationId: "organization-1",
  email: "owner@example.test",
  role: "owner",
};

test("Owner queues an idempotent normalized outbound send without a provider call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network prohibited");
  };
  try {
    const records: unknown[] = [];
    const service = new OutboundSendService({
      listAllowedSenders: async () => [],
      isAllowedSender: async () => ({
        connectionId: "connection-1",
        replyTo: null,
      }),
      queue: async (input) => {
        records.push(input);
        return {
          id: "send-1",
          duplicate: records.length > 1,
          ...input,
          status: "queued" as const,
        };
      },
      findStatus: async () => null,
    });
    const first = await service.queue({
      account: owner,
      idempotencyKey: "key-1",
      from: "Support@Example.Test",
      to: "Recipient@Example.Test",
      subject: "Hello",
      text: "Body",
    });
    assert.equal(first.status, "queued");
    assert.equal(first.from, "support@example.test");
    assert.equal(records.length, 1);
    assert.match(JSON.stringify(records[0]), /"fingerprint":"[A-Za-z0-9_-]+"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("outbound queue rejects unauthorized, invalid, foreign, and mismatched idempotency requests", async () => {
  const service = new OutboundSendService({
    listAllowedSenders: async () => [],
    isAllowedSender: async () => null,
    queue: async () => {
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    },
    findStatus: async () => null,
  });
  await assert.rejects(
    service.queue({
      account: { ...owner, role: "member" },
      idempotencyKey: "key",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hi",
      text: "Body",
    }),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    service.queue({
      account: owner,
      idempotencyKey: "",
      from: "bad",
      to: "person@example.test",
      subject: "Hi",
      text: "Body",
    }),
    /INVALID_OUTBOUND_SEND_INPUT/,
  );
  await assert.rejects(
    service.queue({
      account: owner,
      idempotencyKey: "key",
      from: "foreign@example.test",
      to: "person@example.test",
      subject: "Hi",
      text: "Body",
    }),
    /SENDER_NOT_ALLOWED/,
  );
  const contentService = new OutboundSendService({
    listAllowedSenders: async () => [],
    isAllowedSender: async () => ({
      connectionId: "connection-1",
      replyTo: null,
    }),
    queue: async () => {
      throw new Error("MUST_NOT_QUEUE");
    },
    findStatus: async () => null,
  });
  await assert.rejects(
    contentService.queue({
      account: owner,
      idempotencyKey: "key",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hi",
      text: "",
    } as never),
    /INVALID_OUTBOUND_SEND_INPUT/,
  );
});
