import assert from "node:assert/strict";
import test from "node:test";
import { AuthService, type AuthRepository } from "../src/auth/auth-service.js";
import { buildApp } from "../src/app.js";
import { OutboundSendService } from "../src/outbound/outbound-send-service.js";

const cookie =
  "resend_mailbox_session=outbound-route-token-that-is-long-enough";
const auth = (role: "owner" | "member" = "owner") =>
  new AuthService({
    hasOwner: async () => true,
    bootstrapOwnerWithPassword: async () => {
      throw new Error("NO");
    },
    findUserForLogin: async () => null,
    createSession: async () => {},
    findSessionByTokenHash: async () => ({
      userId: "owner",
      organizationId: "organization-1",
      email: "owner@example.test",
      role,
      expiresAt: new Date("2026-12-01"),
      revokedAt: null,
    }),
  } satisfies AuthRepository);
const service = (
  allowedSenders: { address: string; replyTo: string | null }[] = [],
) =>
  new OutboundSendService({
    listAllowedSenders: async () => allowedSenders,
    isAllowedSender: async () => ({
      connectionId: "connection-1",
      replyTo: null,
    }),
    queue: async (input) => ({
      id: "send-1",
      ...input,
      status: "queued",
      duplicate: false,
    }),
    findStatus: async () => null,
  });

test("outbound queue route is Owner-only and never accepts organization authority", async (t) => {
  const app = buildApp({ authService: auth(), outboundSendService: service() });
  const member = buildApp({
    authService: auth("member"),
    outboundSendService: service(),
  });
  t.after(async () => Promise.all([app.close(), member.close()]));
  const response = await app.inject({
    method: "POST",
    url: "/v1/outbound-sends",
    headers: { cookie },
    payload: {
      idempotencyKey: "key-1",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hi",
      text: "Body",
      organizationId: "foreign",
    },
  });
  const forbidden = await member.inject({
    method: "POST",
    url: "/v1/outbound-sends",
    headers: { cookie },
    payload: {
      idempotencyKey: "key-1",
      from: "support@example.test",
      to: "person@example.test",
      subject: "Hi",
      text: "Body",
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().send.organizationId, "organization-1");
  assert.equal(forbidden.statusCode, 403);
});

test("outbound status route conceals missing and foreign send identifiers", async (t) => {
  const app = buildApp({ authService: auth(), outboundSendService: service() });
  const member = buildApp({
    authService: auth("member"),
    outboundSendService: service(),
  });
  t.after(async () => Promise.all([app.close(), member.close()]));
  const missing = await app.inject({
    method: "GET",
    url: "/v1/outbound-sends/00000000-0000-4000-8000-000000000001",
    headers: { cookie },
  });
  const forbidden = await member.inject({
    method: "GET",
    url: "/v1/outbound-sends/00000000-0000-4000-8000-000000000001",
    headers: { cookie },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(forbidden.statusCode, 403);
});

test("API CORS allows credentials only from the configured exact client origin", async (t) => {
  const app = buildApp({ clientOrigin: "http://localhost:8081" });
  t.after(() => app.close());
  const allowed = await app.inject({
    method: "OPTIONS",
    url: "/v1/login",
    headers: {
      origin: "http://localhost:8081",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-bootstrap-token",
    },
  });
  const rejected = await app.inject({
    method: "OPTIONS",
    url: "/v1/login",
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(allowed.statusCode, 204);
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "http://localhost:8081",
  );
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.headers["access-control-allow-origin"], undefined);
});

test("outbound sender list is authenticated and organization scoped", async (t) => {
  const app = buildApp({
    authService: auth(),
    outboundSendService: service([
      { address: "support@example.test", replyTo: "reply@example.test" },
    ]),
  });
  const member = buildApp({
    authService: auth("member"),
    outboundSendService: service(),
  });
  t.after(async () => Promise.all([app.close(), member.close()]));
  const response = await app.inject({
    method: "GET",
    url: "/v1/outbound-senders",
    headers: { cookie },
  });
  const forbidden = await member.inject({
    method: "GET",
    url: "/v1/outbound-senders",
    headers: { cookie },
  });
  assert.deepEqual(response.json(), {
    senders: [
      { address: "support@example.test", replyTo: "reply@example.test" },
    ],
  });
  assert.equal(response.statusCode, 200);
  assert.equal(forbidden.statusCode, 403);
});
