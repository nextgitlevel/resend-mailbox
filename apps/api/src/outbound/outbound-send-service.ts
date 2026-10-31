import { createHash } from "node:crypto";
import type { AuthAccount } from "../auth/auth-service.js";

export interface QueuedOutboundSend {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  from: string;
  to: string;
  subject: string;
  fingerprint: string;
  status: "queued";
  duplicate: boolean;
}

export interface OutboundSendRepository {
  isAllowedSender(input: {
    organizationId: string;
    from: string;
  }): Promise<boolean>;
  queue(
    input: Omit<QueuedOutboundSend, "id" | "status" | "duplicate">,
  ): Promise<QueuedOutboundSend>;
}

export class OutboundSendService {
  public constructor(private readonly repository: OutboundSendRepository) {}

  public async queue(input: {
    account: AuthAccount;
    idempotencyKey: string;
    from: string;
    to: string;
    subject: string;
  }): Promise<QueuedOutboundSend> {
    if (input.account.role !== "owner") throw new Error("OWNER_REQUIRED");
    const from = normalizeEmail(input.from);
    const to = normalizeEmail(input.to);
    const idempotencyKey = input.idempotencyKey.trim();
    const subject = input.subject.trim();
    if (
      !isEmail(from) ||
      !isEmail(to) ||
      !idempotencyKey ||
      idempotencyKey.length > 200 ||
      !subject ||
      subject.length > 998
    )
      throw new Error("INVALID_OUTBOUND_SEND_INPUT");
    if (
      !(await this.repository.isAllowedSender({
        organizationId: input.account.organizationId,
        from,
      }))
    )
      throw new Error("SENDER_NOT_ALLOWED");
    return this.repository.queue({
      organizationId: input.account.organizationId,
      idempotencyKey,
      from,
      to,
      subject,
      fingerprint: createHash("sha256")
        .update(JSON.stringify({ from, to, subject }))
        .digest("base64url"),
    });
  }
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
