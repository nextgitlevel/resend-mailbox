import Fastify from "fastify";

import { AuthService } from "./auth/auth-service.js";
import { ConnectionSettingsService } from "./settings/connection-settings-service.js";
import { ConnectionValidationService } from "./settings/connection-validation-service.js";

export interface AppOptions {
  authService?: AuthService;
  connectionSettingsService?: ConnectionSettingsService;
  connectionValidationService?: ConnectionValidationService;
  secureCookies?: boolean;
}

export const buildApp = (options: AppOptions = {}) => {
  const app = Fastify({ logger: true });
  const secureCookies =
    options.secureCookies ?? process.env.NODE_ENV === "production";

  app.get("/health", async () => ({
    status: "ok",
    service: "resend-mailbox-api",
  }));

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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "UNKNOWN_ERROR";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
