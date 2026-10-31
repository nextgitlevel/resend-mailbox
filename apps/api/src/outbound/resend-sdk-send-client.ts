import type { CreateEmailOptions } from "resend";
import type { ResendSendClient } from "./resend-outbound-transport.js";

export class ResendSdkSendClient implements ResendSendClient {
  public constructor(private readonly request: typeof fetch = fetch) {}

  public async send(input: Parameters<ResendSendClient["send"]>[0]) {
    try {
      const response = await this.request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.credential}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: input.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        } satisfies CreateEmailOptions),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        if (response.status === 409) {
          const error: unknown = await response.json().catch(() => null);
          return isConcurrentIdempotencyConflict(error)
            ? { kind: "retryable" as const }
            : { kind: "failed" as const };
        }
        return response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500
          ? { kind: "retryable" as const }
          : { kind: "failed" as const };
      }
      const result: unknown = await response.json();
      return isSendResponse(result)
        ? { kind: "sent" as const }
        : { kind: "failed" as const };
    } catch {
      return { kind: "retryable" as const };
    }
  }
}

const isSendResponse = (value: unknown): value is { id: string } =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  value.id.length > 0;

const isConcurrentIdempotencyConflict = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  (("name" in value && value.name === "concurrent_idempotent_requests") ||
    ("code" in value && value.code === "concurrent_idempotent_requests"));
