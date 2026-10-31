import assert from "node:assert/strict";
import test from "node:test";
import { OutboundDeliveryWorker } from "../src/outbound/outbound-delivery-worker.js";

test("worker claims a queued send once, dispatches with its idempotency key, and records sent", async () => {
  const events: unknown[] = [];
  const worker = new OutboundDeliveryWorker(
    {
      claimNext: async () => ({
        id: "send-1",
        organizationId: "organization-1",
        connectionId: "connection-1",
        idempotencyKey: "key-1",
        from: "support@example.test",
        replyTo: null,
        to: "person@example.test",
        subject: "Hi",
        text: "Body",
      }),
      markSent: async (id) => {
        events.push(["sent", id]);
      },
      markFailed: async () => {
        throw new Error("NOT_USED");
      },
    },
    {
      dispatch: async (input) => {
        events.push(["dispatch", input]);
        return { kind: "sent" as const };
      },
    },
  );
  assert.equal(await worker.deliverNext(), true);
  assert.deepEqual(events, [
    [
      "dispatch",
      {
        organizationId: "organization-1",
        connectionId: "connection-1",
        idempotencyKey: "key-1",
        from: "support@example.test",
        replyTo: null,
        to: "person@example.test",
        subject: "Hi",
        text: "Body",
      },
    ],
    ["sent", "send-1"],
  ]);
});

test("worker records a safe failure once when dispatch fails", async () => {
  const events: unknown[] = [];
  const worker = new OutboundDeliveryWorker(
    {
      claimNext: async () => ({
        id: "send-1",
        organizationId: "organization-1",
        connectionId: "connection-1",
        idempotencyKey: "key-1",
        from: "support@example.test",
        replyTo: null,
        to: "person@example.test",
        subject: "Hi",
        text: "Body",
      }),
      markSent: async () => {
        throw new Error("NOT_USED");
      },
      markFailed: async (id, code) => {
        events.push([id, code]);
      },
    },
    {
      dispatch: async () => {
        throw new Error("provider unavailable");
      },
    },
  );
  assert.equal(await worker.deliverNext(), true);
  assert.deepEqual(events, [["send-1", "provider_unavailable"]]);
});
