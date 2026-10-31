export interface ClaimedOutboundSend {
  id: string;
  idempotencyKey: string;
  from: string;
  to: string;
  subject: string;
}

export interface OutboundDeliveryRepository {
  claimNext(): Promise<ClaimedOutboundSend | null>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, code: "provider_unavailable"): Promise<void>;
}

export interface OutboundDeliveryTransport {
  dispatch(
    input: Omit<ClaimedOutboundSend, "id">,
  ): Promise<{ kind: "sent" } | { kind: "failed" }>;
}

export class OutboundDeliveryWorker {
  public constructor(
    private readonly repository: OutboundDeliveryRepository,
    private readonly transport: OutboundDeliveryTransport,
  ) {}

  public async deliverNext(): Promise<boolean> {
    const send = await this.repository.claimNext();
    if (!send) return false;
    try {
      const result = await this.transport.dispatch({
        idempotencyKey: send.idempotencyKey,
        from: send.from,
        to: send.to,
        subject: send.subject,
      });
      if (result.kind === "sent") await this.repository.markSent(send.id);
      else await this.repository.markFailed(send.id, "provider_unavailable");
    } catch {
      await this.repository.markFailed(send.id, "provider_unavailable");
    }
    return true;
  }
}
