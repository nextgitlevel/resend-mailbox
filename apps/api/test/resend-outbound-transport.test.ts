import assert from "node:assert/strict";
import test from "node:test";

import { ResendOutboundTransport } from "../src/outbound/resend-outbound-transport.js";

test("Resend outbound transport decrypts only its scoped connection and maps queued send idempotency", async () => {
  const calls: unknown[] = [];
  const transport = new ResendOutboundTransport(
    {
      findSecretEnvelopeForOrganization: async ({
        organizationId,
        connectionId,
      }) =>
        organizationId === "organization-1" && connectionId === "connection-1"
          ? {
              ciphertext: "fixture",
              nonce: "fixture",
              wrappedDek: "fixture",
              keyVersion: "fixture",
              algorithm: "fixture",
            }
          : null,
    },
    { decrypt: async () => "credential-not-returned" } as never,
    {
      send: async (input) => {
        calls.push(input);
        return { kind: "sent" as const };
      },
    },
  );

  assert.deepEqual(
    await transport.dispatch({
      idempotencyKey: "key-1",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hello",
      text: "Body",
      replyTo: "reply@example.test",
      organizationId: "organization-1",
      connectionId: "connection-1",
    }),
    { kind: "sent" },
  );
  assert.deepEqual(calls, [
    {
      credential: "credential-not-returned",
      idempotencyKey: "key-1",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hello",
      text: "Body",
      replyTo: "reply@example.test",
    },
  ]);
});

test("Resend outbound transport fails closed for a missing scoped connection", async () => {
  let decryptCalls = 0;
  let sendCalls = 0;
  const transport = new ResendOutboundTransport(
    { findSecretEnvelopeForOrganization: async () => null },
    {
      decrypt: async () => {
        decryptCalls += 1;
        return "secret";
      },
    } as never,
    {
      send: async () => {
        sendCalls += 1;
        return { kind: "sent" };
      },
    },
  );
  assert.deepEqual(
    await transport.dispatch({
      organizationId: "organization-2",
      connectionId: "foreign-connection",
      idempotencyKey: "key-2",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hello",
      text: "Body",
      replyTo: null,
    }),
    { kind: "failed" },
  );
  assert.equal(decryptCalls, 0);
  assert.equal(sendCalls, 0);
});

test("Resend outbound transport does not expose credential or provider error details", async () => {
  const transport = new ResendOutboundTransport(
    {
      findSecretEnvelopeForOrganization: async () => ({
        ciphertext: "x",
        nonce: "x",
        wrappedDek: "x",
        keyVersion: "x",
        algorithm: "x",
      }),
    },
    { decrypt: async () => "secret" } as never,
    {
      send: async () => {
        throw new Error("secret provider response");
      },
    },
  );
  assert.deepEqual(
    await transport.dispatch({
      organizationId: "organization-1",
      connectionId: "connection-1",
      idempotencyKey: "key-3",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hello",
      text: "Body",
      replyTo: null,
    }),
    { kind: "failed" },
  );
});
