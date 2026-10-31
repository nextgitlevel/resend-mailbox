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
const service = () =>
  new OutboundSendService({
    isAllowedSender: async () => true,
    queue: async (input) => ({
      id: "send-1",
      ...input,
      status: "queued",
      duplicate: false,
    }),
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
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().send.organizationId, "organization-1");
  assert.equal(forbidden.statusCode, 403);
});
