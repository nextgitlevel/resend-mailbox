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
        organizationId: send.organizationId,
        connectionId: send.connectionId,
        from: send.from,
        replyTo: send.replyTo,
        to: send.to,
        subject: send.subject,
        text: send.text,
      });
      if (result.kind === "sent") await this.repository.markSent(send.id);
      else await this.repository.markFailed(send.id, "provider_unavailable");
    } catch {
      await this.repository.markFailed(send.id, "provider_unavailable");
    }
    return true;
  }
}
