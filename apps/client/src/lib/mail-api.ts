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
      method?: "GET" | "POST";
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
