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
        attempt: 1,
      }),
      markSent: async (id) => {
        events.push(["sent", id]);
      },
      markRetry: async () => {
        throw new Error("NOT_USED");
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

test("worker retries a transient dispatch exception", async () => {
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
        attempt: 1,
      }),
      markSent: async () => {
        throw new Error("NOT_USED");
      },
      markFailed: async () => {
        throw new Error("NOT_USED");
      },
      markRetry: async (id, delayMs) => {
        events.push([id, delayMs]);
      },
    },
    {
      dispatch: async () => {
        throw new Error("provider unavailable");
      },
    },
    { random: () => 0.5 },
  );
  assert.equal(await worker.deliverNext(), true);
  assert.deepEqual(events, [["send-1", 1_000]]);
});

test("worker schedules bounded retries for transient failures with the same idempotency key", async () => {
  const events: unknown[] = [];
  let attempt = 0;
  const worker = new OutboundDeliveryWorker(
    {
      claimNext: async () => {
        attempt += 1;
        return {
          id: "send-retry",
          organizationId: "organization-1",
          connectionId: "connection-1",
          idempotencyKey: "stable-key",
          from: "support@example.test",
          replyTo: null,
          to: "person@example.test",
          subject: "Hi",
          text: "Body",
          attempt,
        };
      },
      markSent: async () => {},
      markRetry: async (id, delayMs) => {
        events.push(["retry", id, delayMs]);
      },
      markFailed: async (id, code) => {
        events.push(["failed", id, code]);
      },
    },
    {
      dispatch: async (input) => {
        events.push(["dispatch", input.idempotencyKey]);
        return { kind: "retryable" as const };
      },
    },
    { random: () => 0.5 },
  );
  await worker.deliverNext();
  await worker.deliverNext();
  await worker.deliverNext();
  await worker.deliverNext();
  await worker.deliverNext();
  assert.deepEqual(events, [
    ["dispatch", "stable-key"],
    ["retry", "send-retry", 1_000],
    ["dispatch", "stable-key"],
    ["retry", "send-retry", 2_000],
    ["dispatch", "stable-key"],
    ["retry", "send-retry", 4_000],
    ["dispatch", "stable-key"],
    ["retry", "send-retry", 8_000],
    ["dispatch", "stable-key"],
    ["failed", "send-retry", "attempts_exhausted"],
  ]);
});

test("worker marks a non-retryable provider rejection terminally", async () => {
  const events: unknown[] = [];
  const worker = new OutboundDeliveryWorker(
    {
      claimNext: async () => ({
        id: "send-invalid",
        organizationId: "organization-1",
        connectionId: "connection-1",
        idempotencyKey: "key-invalid",
        from: "support@example.test",
        replyTo: null,
        to: "person@example.test",
        subject: "Hi",
        text: "Body",
        attempt: 1,
      }),
      markSent: async () => {
        throw new Error("NOT_USED");
      },
      markRetry: async () => {
        throw new Error("NOT_USED");
      },
      markFailed: async (_id, code) => {
        events.push(code);
      },
    },
    { dispatch: async () => ({ kind: "failed" }) },
  );
  await worker.deliverNext();
  assert.deepEqual(events, ["delivery_failed"]);
});
