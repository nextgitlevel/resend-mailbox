import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { buildApp } from "../src/app.js";

const secret = `whsec_${Buffer.from("test-webhook-secret").toString("base64")}`;
const payload = JSON.stringify({
  type: "email.received",
  data: { email_id: "email-1" },
});
const headers = (body: string) => {
  const id = "msg_test";
  const timestamp = "1735689600";
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${createHmac("sha256", Buffer.from("test-webhook-secret")).update(`${id}.${timestamp}.${body}`).digest("base64")}`,
  };
};

test("Resend webhook accepts an exactly signed raw payload and rejects tampering", async (t) => {
  const app = buildApp({ resendWebhookSecret: secret });
  t.after(() => app.close());
  const accepted = await app.inject({
    method: "POST",
    url: "/v1/webhooks/resend",
    headers: headers(payload),
    payload,
  });
  const rejected = await app.inject({
    method: "POST",
    url: "/v1/webhooks/resend",
    headers: headers(payload),
    payload: `${payload} `,
  });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.json(), { received: true });
  assert.equal(rejected.statusCode, 400);
});
