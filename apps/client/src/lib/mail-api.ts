export interface MailAccount {
  userId: string;
  organizationId: string;
  email: string;
  role: "owner" | "admin" | "member";
}

export interface AllowedSender {
  address: string;
  replyTo: string | null;
}

export interface ResendConnection {
  id: string;
  name: string;
  secretConfigured: boolean;
  keyVersion: string | null;
}

export interface Mailbox {
  id: string;
  name: string;
}

export interface ConfiguredDomain {
  id: string;
  connectionId: string;
  name: string;
  verificationStatus: "pending" | "verified" | "failed";
}

export interface OutboundSendStatus {
  id: string;
  status: "queued" | "claimed" | "sent" | "failed";
  attemptCount: number;
  createdAt: string;
  sentAt: string | null;
  nextAttemptAt: string | null;
  failureCode:
    | "attempts_exhausted"
    | "delivery_failed"
    | "delivery_outcome_unknown"
    | null;
}

export interface MailApi {
  session(): Promise<MailAccount | null>;
  login(input: { email: string; password: string }): Promise<MailAccount>;
  bootstrap(input: {
    email: string;
    organizationName: string;
    password: string;
    bootstrapToken: string;
  }): Promise<MailAccount>;
  senders(): Promise<AllowedSender[]>;
  connections(): Promise<ResendConnection[]>;
  createConnection(input: {
    name: string;
    apiKey: string;
  }): Promise<ResendConnection>;
  replaceConnectionKey(
    connectionId: string,
    apiKey: string,
  ): Promise<ResendConnection>;
  validateConnection(connectionId: string): Promise<string>;
  mailboxes(): Promise<Mailbox[]>;
  createMailbox(name: string): Promise<Mailbox>;
  domains(): Promise<ConfiguredDomain[]>;
  createDomain(connectionId: string, name: string): Promise<ConfiguredDomain>;
  refreshDomain(domainId: string): Promise<ConfiguredDomain>;
  createAddress(
    domainId: string,
    mailboxId: string,
    localPart: string,
  ): Promise<void>;
  send(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    idempotencyKey?: string;
  }): Promise<OutboundSendStatus>;
  status(sendId: string): Promise<OutboundSendStatus>;
}

export class MailApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export const createMailApi = (
  baseUrl: string,
  request: typeof fetch = fetch,
): MailApi => {
  const base = baseUrl.replace(/\/$/, "");
  const call = async <T>(
    path: string,
    input: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
      headers?: Record<string, string>;
      allowUnauthorized?: boolean;
    } = {},
  ): Promise<T | null> => {
    let response: Response;
    try {
      response = await request(`${base}${path}`, {
        method: input.method ?? "GET",
        credentials: "include",
        headers: {
          ...(input.body ? { "Content-Type": "application/json" } : {}),
          ...input.headers,
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      });
    } catch {
      throw new MailApiError(0, "NETWORK_UNAVAILABLE");
    }
    if (response.status === 401 && input.allowUnauthorized) return null;
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "REQUEST_FAILED";
      throw new MailApiError(response.status, code);
    }
    return result as T;
  };
  const account = async (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => {
    const result = await call<{ account: MailAccount }>(path, {
      method: "POST",
      body,
      headers,
    });
    if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
    return result.account;
  };

  return {
    async session() {
      const result = await call<{ account: MailAccount }>("/v1/session", {
        allowUnauthorized: true,
      });
      return result?.account ?? null;
    },
    login: (input) => account("/v1/login", input),
    bootstrap: ({ bootstrapToken, ...body }) =>
      account("/v1/bootstrap", body, { "X-Bootstrap-Token": bootstrapToken }),
    async senders() {
      const result = await call<{ senders: AllowedSender[] }>(
        "/v1/outbound-senders",
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.senders;
    },
    async connections() {
      const result = await call<{ connections: ResendConnection[] }>(
        "/v1/connections",
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.connections;
    },
    async createConnection(input) {
      const result = await call<{ connection: ResendConnection }>(
        "/v1/connections",
        { method: "POST", body: input },
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.connection;
    },
    async validateConnection(connectionId) {
      const result = await call<{ status: string }>(
        `/v1/connections/${encodeURIComponent(connectionId)}/validate`,
        { method: "POST", body: {} },
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.status;
    },
    async replaceConnectionKey(connectionId, apiKey) {
      const result = await call<{ connection: ResendConnection }>(
        `/v1/connections/${encodeURIComponent(connectionId)}/credential`,
        { method: "PUT", body: { apiKey } },
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.connection;
    },
    async mailboxes() {
      const result = await call<{ mailboxes: Mailbox[] }>("/v1/mailboxes");
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.mailboxes;
    },
    async createMailbox(name) {
      const result = await call<{ mailbox: Mailbox }>("/v1/mailboxes", {
        method: "POST",
        body: { name },
      });
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.mailbox;
    },
    async domains() {
      const result = await call<{ domains: ConfiguredDomain[] }>("/v1/domains");
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.domains;
    },
    async createDomain(connectionId, name) {
      const result = await call<{ domain: ConfiguredDomain }>(
        `/v1/connections/${encodeURIComponent(connectionId)}/domains`,
        {
          method: "POST",
          body: { name, fallback: { kind: "quarantine" } },
        },
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.domain;
    },
    async refreshDomain(domainId) {
      const result = await call<{ domain: ConfiguredDomain }>(
        `/v1/domains/${encodeURIComponent(domainId)}/verify`,
        { method: "POST", body: {} },
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.domain;
    },
    async createAddress(domainId, mailboxId, localPart) {
      await call<{ address: unknown }>(
        `/v1/domains/${encodeURIComponent(domainId)}/addresses`,
        { method: "POST", body: { mailboxId, localPart } },
      );
    },
    async send(input) {
      const result = await call<{ send: OutboundSendStatus }>(
        "/v1/outbound-sends",
        {
          method: "POST",
          body: {
            ...input,
            idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
          },
        },
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.send;
    },
    async status(sendId) {
      const result = await call<{ send: OutboundSendStatus }>(
        `/v1/outbound-sends/${encodeURIComponent(sendId)}`,
      );
      if (!result) throw new MailApiError(0, "INVALID_API_RESPONSE");
      return result.send;
    },
  };
};

export const createIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};
