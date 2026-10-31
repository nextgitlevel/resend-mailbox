export interface WebhookReceiptRepository {
  capture(input: {
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<boolean>;
}

export class WebhookReceiptService {
  public constructor(private readonly repository: WebhookReceiptRepository) {}

  public async capture(input: {
    eventId: string;
    payload: unknown;
  }): Promise<{ duplicate: boolean }> {
    if (!input.eventId || !isEvent(input.payload))
      throw new Error("INVALID_WEBHOOK_EVENT");
    return {
      duplicate: !(await this.repository.capture({
        eventId: input.eventId,
        eventType: input.payload.type,
        payload: input.payload,
      })),
    };
  }
}

const isEvent = (value: unknown): value is { type: string } =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof (value as { type?: unknown }).type === "string";
