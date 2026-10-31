import { createHash } from "node:crypto";
import type { AuthAccount } from "../auth/auth-service.js";

export interface QueuedOutboundSend {
  id: string;
  organizationId: string;
  connectionId: string;
  idempotencyKey: string;
  from: string;
  replyTo: string | null;
  to: string;
  subject: string;
  text: string;
  fingerprint: string;
  status: "queued";
  duplicate: boolean;
}

export interface OutboundSendRepository {
  isAllowedSender(input: {
    organizationId: string;
    from: string;
  }): Promise<{ connectionId: string; replyTo: string | null } | null>;
  queue(
    input: Omit<QueuedOutboundSend, "id" | "status" | "duplicate">,
  ): Promise<QueuedOutboundSend>;
  findStatus(input: {
    organizationId: string;
    sendId: string;
  }): Promise<OutboundSendStatus | null>;
}

export interface OutboundSendStatus {
  id: string;
  status: "queued" | "claimed" | "sent" | "failed";
  attemptCount: number;
  createdAt: Date;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
  failureCode:
    | "attempts_exhausted"
    | "delivery_failed"
    | "delivery_outcome_unknown"
    | null;
}

export class OutboundSendService {
  public constructor(private readonly repository: OutboundSendRepository) {}

  public async status(input: { account: AuthAccount; sendId: string }) {
    if (input.account.role !== "owner") throw new Error("OWNER_REQUIRED");
    return this.repository.findStatus({
      organizationId: input.account.organizationId,
      sendId: input.sendId,
    });
  }

  public async queue(input: {
    account: AuthAccount;
    idempotencyKey: string;
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<QueuedOutboundSend> {
    if (input.account.role !== "owner") throw new Error("OWNER_REQUIRED");
    const from = normalizeEmail(input.from);
    const to = normalizeEmail(input.to);
    const idempotencyKey = input.idempotencyKey.trim();
    const subject = input.subject.trim();
    const text = input.text.trim();
    if (
      !isEmail(from) ||
      !isEmail(to) ||
      !idempotencyKey ||
      idempotencyKey.length > 200 ||
      !subject ||
      subject.length > 998 ||
      !text ||
      text.length > 100_000
    )
      throw new Error("INVALID_OUTBOUND_SEND_INPUT");
    const sender = await this.repository.isAllowedSender({
      organizationId: input.account.organizationId,
      from,
    });
    if (!sender) throw new Error("SENDER_NOT_ALLOWED");
    return this.repository.queue({
      organizationId: input.account.organizationId,
      connectionId: sender.connectionId,
      idempotencyKey,
      from,
      replyTo: sender.replyTo,
      to,
      subject,
      text,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            connectionId: sender.connectionId,
            from,
            replyTo: sender.replyTo,
            to,
            subject,
            text,
          }),
        )
        .digest("base64url"),
    });
  }
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
