import {
  RecipientRouter,
  type RoutingDomain,
} from "../routing/recipient-router.js";

export interface InboundMessageRepository {
  domainsForRecipientDomain(domain: string): Promise<RoutingDomain[]>;
  project(input: {
    providerEmailId: string;
    mailboxId?: string;
    outcome: "mailbox" | "quarantine" | "discard" | "reject";
    recipient: string;
    subject: string;
  }): Promise<void>;
}

export class InboundMessageProjector {
  private readonly router = new RecipientRouter();
  public constructor(private readonly repository: InboundMessageRepository) {}

  public async project(event: unknown): Promise<void> {
    const parsed = parse(event);
    if (!parsed) return;
    const domains = await this.repository.domainsForRecipientDomain(
      parsed.recipient.split("@")[1] ?? "",
    );
    const organizationIds = [
      ...new Set(domains.map((domain) => domain.organizationId)),
    ];
    const outcome =
      organizationIds.length === 1
        ? this.router.route({
            organizationId: organizationIds[0]!,
            recipient: parsed.recipient,
            domains,
          })
        : { kind: "reject" as const };
    await this.repository.project({
      providerEmailId: parsed.emailId,
      recipient: parsed.recipient,
      subject: parsed.subject,
      outcome: outcome.kind,
      ...(outcome.kind === "mailbox" ? { mailboxId: outcome.mailboxId } : {}),
    });
  }
}

const parse = (
  value: unknown,
): { emailId: string; recipient: string; subject: string } | null => {
  if (typeof value !== "object" || value === null) return null;
  const event = value as {
    type?: unknown;
    data?: { email_id?: unknown; to?: unknown; subject?: unknown };
  };
  const recipient =
    Array.isArray(event.data?.to) && typeof event.data.to[0] === "string"
      ? event.data.to[0]
      : null;
  return event.type === "email.received" &&
    typeof event.data?.email_id === "string" &&
    recipient
    ? {
        emailId: event.data.email_id,
        recipient,
        subject:
          typeof event.data.subject === "string" ? event.data.subject : "",
      }
    : null;
};
