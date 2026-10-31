import assert from "node:assert/strict";
import test from "node:test";

import { ResendSdkSendClient } from "../src/outbound/resend-sdk-send-client.js";

test("Resend HTTP client maps plain text, reply-to, and idempotency without exposing secrets", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = new ResendSdkSendClient(async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ id: "email-provider-id" }, { status: 200 });
  });
  const result = await client.send({
    credential: "re_test_secret",
    idempotencyKey: "key-123",
    from: "support@example.test",
    to: "person@example.test",
    subject: "Hello",
    text: "Plain text body",
    replyTo: "replies@example.test",
  });
  assert.deepEqual(result, { kind: "sent" });
  assert.equal(request?.url, "https://api.resend.com/emails");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer re_test_secret");
  assert.equal(headers.get("Idempotency-Key"), "key-123");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    from: "support@example.test",
    to: "person@example.test",
    subject: "Hello",
    text: "Plain text body",
    reply_to: "replies@example.test",
  });
  assert.equal(JSON.stringify(result).includes("re_test_secret"), false);
});

test("Resend HTTP client converts HTTP and malformed responses to safe failure", async () => {
  const client = new ResendSdkSendClient(async () =>
    Response.json({ message: "credential rejected" }, { status: 401 }),
  );
  assert.deepEqual(
    await client.send({
      credential: "re_test_secret",
      idempotencyKey: "key-401",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hello",
      text: "Body",
      replyTo: null,
    }),
    { kind: "failed" },
  );
  const malformed = new ResendSdkSendClient(async () =>
    Response.json({ error: "missing id" }, { status: 200 }),
  );
  assert.deepEqual(
    await malformed.send({
      credential: "re_test_secret",
      idempotencyKey: "key-malformed",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hello",
      text: "Body",
      replyTo: null,
    }),
    { kind: "failed" },
  );
});
