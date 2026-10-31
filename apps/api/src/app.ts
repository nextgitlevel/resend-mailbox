import { createHmac, timingSafeEqual } from "node:crypto";
import { Transform } from "node:stream";
import Fastify from "fastify";

import { AuthService } from "./auth/auth-service.js";
import { DomainSettingsService } from "./domains/domain-settings-service.js";
import { WebhookReceiptService } from "./inbound/webhook-receipt-service.js";
import { ConnectionSettingsService } from "./settings/connection-settings-service.js";
import { ConnectionValidationService } from "./settings/connection-validation-service.js";

export interface AppOptions {
  authService?: AuthService;
  connectionSettingsService?: ConnectionSettingsService;
  connectionValidationService?: ConnectionValidationService;
  domainSettingsService?: DomainSettingsService;
  resendWebhookSecret?: string;
  webhookReceiptService?: WebhookReceiptService;
  secureCookies?: boolean;
}

export const buildApp = (options: AppOptions = {}) => {
  const app = Fastify({ logger: true });
  const secureCookies =
    options.secureCookies ?? process.env.NODE_ENV === "production";

  app.addHook("preParsing", (request, _reply, payload, done) => {
    const chunks: Buffer[] = [];
    const capture = new Transform({
      transform(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback(null, chunk);
      },
      flush(callback) {
        (request as typeof request & { rawBody?: Buffer }).rawBody =
          Buffer.concat(chunks);
        callback();
      },
    });
    done(null, payload.pipe(capture));
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "resend-mailbox-api",
  }));

  app.post("/v1/webhooks/resend", async (request, reply) => {
    if (!options.resendWebhookSecret) {
      return reply.code(503).send({ error: "WEBHOOK_NOT_CONFIGURED" });
    }
    const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody;
    const id = readHeaderValue(request.headers["svix-id"]);
    const timestamp = readHeaderValue(request.headers["svix-timestamp"]);
    const signature = readHeaderValue(request.headers["svix-signature"]);
    if (
      !rawBody ||
      !verifyResendWebhook({
        id,
        timestamp,
        signature,
        rawBody,
        secret: options.resendWebhookSecret,
      })
    ) {
      return reply.code(400).send({ error: "INVALID_WEBHOOK_SIGNATURE" });
    }
    if (!options.webhookReceiptService)
      return reply.code(503).send({ error: "WEBHOOK_RECEIPTS_NOT_CONFIGURED" });
    try {
      const receipt = await options.webhookReceiptService.capture({
        eventId: id,
        payload: request.body,
      });
      return reply
        .code(202)
        .send({ received: true, duplicate: receipt.duplicate });
    } catch {
      return reply.code(400).send({ error: "INVALID_WEBHOOK_EVENT" });
    }
  });

  app.post("/v1/bootstrap", async (request, reply) => {
    if (!options.authService) {
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    }

    const input = readBootstrapRequest(
      request.body,
      readHeaderValue(request.headers["x-bootstrap-token"]),
    );

    if (!input) {
      return reply.code(400).send({ error: "INVALID_BOOTSTRAP_INPUT" });
    }

    try {
      const result = await options.authService.bootstrapOwner(input);
      reply.header(
        "set-cookie",
        buildSessionCookie(result.sessionToken, secureCookies),
      );

      return reply.code(201).send({ account: result.account });
    } catch (error) {
      return reply.code(bootstrapErrorStatus(error)).send({
        error: bootstrapErrorCode(error),
      });
    }
  });

  app.post("/v1/login", async (request, reply) => {
    if (!options.authService) {
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    }

    const input = readLoginRequest(request.body);

    if (!input) {
      return reply.code(400).send({ error: "INVALID_LOGIN_INPUT" });
    }

    const result = await options.authService.login(input);

    if (!result) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    reply.header(
      "set-cookie",
      buildSessionCookie(result.sessionToken, secureCookies),
    );

    return reply.send({ account: result.account });
  });

  app.get("/v1/session", async (request, reply) => {
    if (!options.authService) {
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    }

    const token = readSessionCookie(request.headers.cookie);
    const account = token
      ? await options.authService.authenticateSession(token)
      : null;

    if (!account) {
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }

    return { account };
  });

  app.post("/v1/connections", async (request, reply) => {
    if (!options.authService) {
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    }

    if (!options.connectionSettingsService) {
      return reply.code(503).send({ error: "SETTINGS_NOT_CONFIGURED" });
    }

    const account = await authenticateRequest(
      request.headers.cookie,
      options.authService,
    );

    if (!account) {
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }

    const input = readConnectionRequest(request.body);

    if (!input) {
      return reply.code(400).send({ error: "INVALID_CONNECTION_INPUT" });
    }

    try {
      const connection =
        await options.connectionSettingsService.createConnection({
          account,
          ...input,
        });

      return reply.code(201).send({ connection });
    } catch (error) {
      const code = connectionErrorCode(error);
      return reply
        .code(code === "OWNER_REQUIRED" ? 403 : 400)
        .send({ error: code });
    }
  });

  app.get("/v1/connections/:connectionId", async (request, reply) => {
    if (!options.authService) {
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    }

    if (!options.connectionSettingsService) {
      return reply.code(503).send({ error: "SETTINGS_NOT_CONFIGURED" });
    }

    const account = await authenticateRequest(
      request.headers.cookie,
      options.authService,
    );

    if (!account) {
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }

    const { connectionId } = request.params as { connectionId?: string };

    if (!connectionId) {
      return reply.code(400).send({ error: "INVALID_CONNECTION_ID" });
    }

    try {
      const connection = await options.connectionSettingsService.findConnection(
        {
          account,
          connectionId,
        },
      );

      if (!connection) {
        return reply.code(404).send({ error: "CONNECTION_NOT_FOUND" });
      }

      return { connection };
    } catch (error) {
      const code = connectionErrorCode(error);
      return reply
        .code(code === "OWNER_REQUIRED" ? 403 : 400)
        .send({ error: code });
    }
  });

  app.post("/v1/connections/:connectionId/validate", async (request, reply) => {
    if (!options.authService) {
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    }

    const account = await authenticateRequest(
      request.headers.cookie,
      options.authService,
    );

    if (!account) {
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }

    if (account.role !== "owner") {
      return reply.code(403).send({ error: "OWNER_REQUIRED" });
    }

    if (!options.connectionValidationService) {
      return reply.code(503).send({ error: "VALIDATION_NOT_CONFIGURED" });
    }

    const { connectionId } = request.params as { connectionId?: string };

    if (!connectionId) {
      return reply.code(400).send({ error: "INVALID_CONNECTION_ID" });
    }

    try {
      return {
        status: await options.connectionValidationService.validateConnection({
          account,
          connectionId,
        }),
      };
    } catch (error) {
      const code = validationErrorCode(error);
      return reply
        .code(code === "OWNER_REQUIRED" ? 403 : 404)
        .send({ error: code });
    }
  });

  app.post("/v1/connections/:connectionId/domains", async (request, reply) => {
    if (!options.authService)
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    if (!options.domainSettingsService)
      return reply.code(503).send({ error: "DOMAINS_NOT_CONFIGURED" });
    const account = await authenticateRequest(
      request.headers.cookie,
      options.authService,
    );
    if (!account) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const { connectionId } = request.params as { connectionId?: string };
    const input = readDomainRequest(request.body);
    if (!connectionId || !input)
      return reply.code(400).send({ error: "INVALID_DOMAIN_INPUT" });
    try {
      return reply.code(201).send({
        domain: await options.domainSettingsService.createDomain({
          account,
          connectionId,
          ...input,
        }),
      });
    } catch (error) {
      const code = domainErrorCode(error);
      return reply
        .code(
          code === "OWNER_REQUIRED"
            ? 403
            : code === "CONNECTION_NOT_FOUND"
              ? 404
              : 400,
        )
        .send({ error: code });
    }
  });

  app.post("/v1/mailboxes", async (request, reply) => {
    if (!options.authService)
      return reply.code(503).send({ error: "AUTH_NOT_CONFIGURED" });
    if (!options.domainSettingsService)
      return reply.code(503).send({ error: "DOMAINS_NOT_CONFIGURED" });
    const account = await authenticateRequest(
      request.headers.cookie,
      options.authService,
    );
    if (!account) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = request.body;
    if (!isRecord(body) || typeof body.name !== "string")
      return reply.code(400).send({ error: "INVALID_MAILBOX_INPUT" });
    try {
      return reply.code(201).send({
        mailbox: await options.domainSettingsService.createMailbox({
          account,
          name: body.name,
        }),
      });
    } catch (error) {
      const code = domainErrorCode(error);
      return reply
        .code(code === "OWNER_REQUIRED" ? 403 : 400)
        .send({ error: code });
    }
  });

  return app;
};

const readBootstrapRequest = (body: unknown, bootstrapToken: string) => {
  if (!isRecord(body)) {
    return null;
  }

  const { email, organizationName, password } = body;

  if (
    typeof email !== "string" ||
    typeof organizationName !== "string" ||
    typeof password !== "string"
  ) {
    return null;
  }

  return { email, organizationName, password, bootstrapToken };
};

const readLoginRequest = (body: unknown) => {
  if (
    !isRecord(body) ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  ) {
    return null;
  }

  return { email: body.email, password: body.password };
};

const readConnectionRequest = (body: unknown) => {
  if (
    !isRecord(body) ||
    typeof body.name !== "string" ||
    typeof body.apiKey !== "string"
  ) {
    return null;
  }

  return { name: body.name, apiKey: body.apiKey };
};

const readDomainRequest = (body: unknown) => {
  if (
    !isRecord(body) ||
    typeof body.name !== "string" ||
    !isRecord(body.fallback) ||
    typeof body.fallback.kind !== "string"
  )
    return null;
  if (
    body.fallback.kind === "catch_all" &&
    typeof body.fallback.mailboxId === "string"
  )
    return {
      name: body.name,
      fallback: {
        kind: "catch_all" as const,
        mailboxId: body.fallback.mailboxId,
      },
    };
  if (body.fallback.kind === "quarantine")
    return { name: body.name, fallback: { kind: "quarantine" as const } };
  if (body.fallback.kind === "discard")
    return { name: body.name, fallback: { kind: "discard" as const } };
  return null;
};

const authenticateRequest = (
  cookieHeader: string | undefined,
  authService: AuthService,
) => {
  const token = readSessionCookie(cookieHeader);

  return token ? authService.authenticateSession(token) : null;
};

const readHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const readSessionCookie = (cookieHeader: string | undefined) => {
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("resend_mailbox_session="));

  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.slice("resend_mailbox_session=".length));
  } catch {
    return null;
  }
};

const buildSessionCookie = (token: string, secure: boolean) =>
  [
    `resend_mailbox_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=2592000",
    ...(secure ? ["Secure"] : []),
  ].join("; ");

const bootstrapErrorStatus = (error: unknown) => {
  const message = errorMessage(error);

  if (message === "OWNER_ALREADY_BOOTSTRAPPED") {
    return 409;
  }

  if (message === "BOOTSTRAP_UNAVAILABLE") {
    return 503;
  }

  return message === "BOOTSTRAP_NOT_AUTHORIZED" ? 403 : 400;
};

const bootstrapErrorCode = (error: unknown) =>
  ({
    OWNER_ALREADY_BOOTSTRAPPED: "OWNER_ALREADY_BOOTSTRAPPED",
    BOOTSTRAP_UNAVAILABLE: "BOOTSTRAP_UNAVAILABLE",
    BOOTSTRAP_NOT_AUTHORIZED: "BOOTSTRAP_NOT_AUTHORIZED",
  })[errorMessage(error)] ?? "INVALID_BOOTSTRAP_INPUT";

const connectionErrorCode = (error: unknown) =>
  ["INVALID_CONNECTION_INPUT", "OWNER_REQUIRED"].includes(errorMessage(error))
    ? errorMessage(error)
    : "CONNECTION_CONFIGURATION_FAILED";

const validationErrorCode = (error: unknown) =>
  errorMessage(error) === "OWNER_REQUIRED"
    ? "OWNER_REQUIRED"
    : "CONNECTION_NOT_FOUND";

const domainErrorCode = (error: unknown) => {
  const message = errorMessage(error);
  return [
    "OWNER_REQUIRED",
    "CONNECTION_NOT_FOUND",
    "INVALID_DOMAIN_INPUT",
    "INVALID_MAILBOX_INPUT",
  ].includes(message)
    ? message
    : "DOMAIN_CONFIGURATION_FAILED";
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "UNKNOWN_ERROR";

const verifyResendWebhook = (input: {
  id: string;
  timestamp: string;
  signature: string;
  rawBody: Buffer;
  secret: string;
}) => {
  if (
    !input.id ||
    !input.timestamp ||
    !input.signature ||
    !input.secret.startsWith("whsec_")
  )
    return false;
  const secret = Buffer.from(input.secret.slice("whsec_".length), "base64");
  if (secret.length === 0) return false;
  const expected = createHmac("sha256", secret)
    .update(`${input.id}.${input.timestamp}.${input.rawBody.toString("utf8")}`)
    .digest("base64");
  return input.signature.split(" ").some((value) => {
    const [, candidate] = value.split(",", 2);
    const encoded = candidate ?? "";
    const supplied = Buffer.from(encoded);
    const calculated = Buffer.from(expected);
    return (
      supplied.length === calculated.length &&
      timingSafeEqual(supplied, calculated)
    );
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
