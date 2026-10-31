import assert from "node:assert/strict";
import test from "node:test";

import { createMailApi, MailApiError } from "../src/lib/mail-api.js";

test("mail API uses credentialed requests and keeps bootstrap token out of body", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const api = createMailApi("http://localhost:3001/", async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      account: {
        userId: "u",
        organizationId: "o",
        email: "owner@example.test",
        role: "owner",
      },
    });
  });
  await api.bootstrap({
    email: "owner@example.test",
    organizationName: "Mailbox",
    password: "this is a long test password",
    bootstrapToken: "one-time-bootstrap-token",
  });
  assert.equal(requests[0]?.url, "http://localhost:3001/v1/bootstrap");
  assert.equal(requests[0]?.init?.credentials, "include");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("X-Bootstrap-Token"), "one-time-bootstrap-token");
  assert.equal(
    String(requests[0]?.init?.body).includes("one-time-bootstrap-token"),
    false,
  );
});

test("mail API sends one stable idempotency key with queued content and polls safe status", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const api = createMailApi("http://localhost:3001", async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      send: {
        id: "send-id",
        status: "queued",
        attemptCount: 0,
        createdAt: "2026-10-31T00:00:00.000Z",
        sentAt: null,
        nextAttemptAt: null,
        failureCode: null,
      },
    });
  });
  const queued = await api.send({
    from: "support@example.test",
    to: "person@example.test",
    subject: "Hello",
    text: "Body",
    idempotencyKey: "stable-test-key",
  });
  assert.equal(queued.id, "send-id");
  const payload = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(payload.idempotencyKey, "stable-test-key");
  assert.equal(requests[0]?.init?.credentials, "include");
  await api.status("send-id");
  assert.equal(
    requests[1]?.url,
    "http://localhost:3001/v1/outbound-sends/send-id",
  );
});

test("mail API reduces network failures to a safe error code", async () => {
  const api = createMailApi("http://localhost:3001", async () => {
    throw new Error("private network details");
  });
  await assert.rejects(api.senders(), (error: unknown) => {
    if (!(error instanceof MailApiError)) return false;
    assert.equal(error.code, "NETWORK_UNAVAILABLE");
    assert.equal(error.message.includes("private network details"), false);
    return true;
  });
});
