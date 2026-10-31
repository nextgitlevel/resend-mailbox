export interface ClaimedOutboundSend {
  id: string;
  organizationId: string;
  connectionId: string;
  idempotencyKey: string;
  from: string;
  replyTo: string | null;
  to: string;
  subject: string;
  text: string;
  attempt: number;
}

export interface OutboundDeliveryRepository {
  claimNext(): Promise<ClaimedOutboundSend | null>;
  markSent(id: string): Promise<void>;
  markRetry(id: string, delayMs: number): Promise<void>;
  markFailed(
    id: string,
    code: "attempts_exhausted" | "delivery_failed",
  ): Promise<void>;
}

export interface OutboundDeliveryTransport {
  dispatch(
    input: Omit<ClaimedOutboundSend, "id" | "attempt">,
  ): Promise<{ kind: "sent" } | { kind: "retryable" } | { kind: "failed" }>;
}

export class OutboundDeliveryWorker {
  public constructor(
    private readonly repository: OutboundDeliveryRepository,
    private readonly transport: OutboundDeliveryTransport,
    private readonly options: { random?: () => number } = {},
  ) {}

  private static readonly maxAttempts = 5;

  public async deliverNext(): Promise<boolean> {
    const send = await this.repository.claimNext();
    if (!send) return false;
    try {
      const result = await this.transport.dispatch({
        idempotencyKey: send.idempotencyKey,
        organizationId: send.organizationId,
        connectionId: send.connectionId,
        from: send.from,
        replyTo: send.replyTo,
        to: send.to,
        subject: send.subject,
        text: send.text,
      });
      if (result.kind === "sent") await this.repository.markSent(send.id);
      else if (result.kind === "failed")
        await this.repository.markFailed(send.id, "delivery_failed");
      else if (send.attempt >= OutboundDeliveryWorker.maxAttempts)
        await this.repository.markFailed(send.id, "attempts_exhausted");
      else
        await this.repository.markRetry(send.id, this.retryDelay(send.attempt));
    } catch {
      if (send.attempt >= OutboundDeliveryWorker.maxAttempts)
        await this.repository.markFailed(send.id, "attempts_exhausted");
      else
        await this.repository.markRetry(send.id, this.retryDelay(send.attempt));
    }
    return true;
  }

  private retryDelay(attempt: number) {
    const base = Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 60_000);
    const random = Math.min(
      1,
      Math.max(0, this.options.random?.() ?? Math.random()),
    );
    return Math.round(base * (0.5 + random));
  }
}
