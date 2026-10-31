import assert from "node:assert/strict";
import test from "node:test";

import { ResendDomainVerificationClient } from "../src/domains/resend-domain-verification-client.js";

const envelope = {
  ciphertext: "ciphertext",
  nonce: "nonce",
  wrappedDek: "wrapped",
  keyVersion: "v1",
  algorithm: "aes-256-gcm",
};

test("live domain verifier scopes the encrypted connection and maps Resend verification status", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ResendDomainVerificationClient(
    {
      findSecretEnvelopeForOrganization: async (input) =>
        input.organizationId === "org-1" &&
        input.connectionId === "connection-1"
          ? envelope
          : null,
    },
    { decrypt: async () => "re_test_key" } as never,
    async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({
        object: "list",
        has_more: false,
        data: [{ id: "domain-id", name: "example.test", status: "verified" }],
      });
    },
  );
  assert.equal(
    await client.verify({
      organizationId: "org-1",
      connectionId: "connection-1",
      domainName: "example.test",
    }),
    "verified",
  );
  assert.equal(requests[0]?.url, "https://api.resend.com/domains?limit=100");
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("Authorization"),
    "Bearer re_test_key",
  );
});

test("live domain verifier does not call Resend for a foreign connection", async () => {
  let calls = 0;
  const client = new ResendDomainVerificationClient(
    { findSecretEnvelopeForOrganization: async () => null },
    { decrypt: async () => "must-not-decrypt" } as never,
    async () => {
      calls += 1;
      return Response.json({});
    },
  );
  await assert.rejects(
    client.verify({
      organizationId: "org-2",
      connectionId: "foreign-connection",
      domainName: "example.test",
    }),
    /RESEND_CONNECTION_NOT_FOUND/,
  );
  assert.equal(calls, 0);
});

test("live domain verifier fails safely for invalid credentials or provider response", async () => {
  const client = new ResendDomainVerificationClient(
    { findSecretEnvelopeForOrganization: async () => envelope },
    { decrypt: async () => "re_test_key" } as never,
    async () =>
      Response.json({ message: "private provider details" }, { status: 401 }),
  );
  await assert.rejects(
    client.verify({
      organizationId: "org-1",
      connectionId: "connection-1",
      domainName: "example.test",
    }),
    /RESEND_CREDENTIAL_INVALID/,
  );
});
