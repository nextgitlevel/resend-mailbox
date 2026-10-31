import assert from "node:assert/strict";
import test from "node:test";

import { FixtureDomainVerificationClient } from "../src/domains/domain-verification-client.js";

test("domain verification fixtures perform no network I/O and default to pending", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network is prohibited in fixture verification");
  };
  try {
    const client = new FixtureDomainVerificationClient({
      "connection-1:example.test": "verified",
    });
    assert.equal(
      await client.verify({
        connectionId: "connection-1",
        domainName: "example.test",
      }),
      "verified",
    );
    assert.equal(
      await client.verify({
        connectionId: "connection-1",
        domainName: "unknown.test",
      }),
      "pending",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
