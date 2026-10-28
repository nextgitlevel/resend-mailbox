import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";

test("health endpoint returns the credential-free API identity", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "resend-mailbox-api",
  });
});

test("health endpoint does not accept an unsupported write method", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/health" });

  assert.equal(response.statusCode, 404);
});
