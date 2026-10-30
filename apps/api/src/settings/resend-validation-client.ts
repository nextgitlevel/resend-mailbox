export type ConnectionValidationStatus =
  "connected" | "invalid_credentials" | "unavailable";

export interface ResendValidationClient {
  validate(credential: string): Promise<ConnectionValidationStatus>;
}

export type ResendValidationProbeResult =
  | { readonly kind: "success" }
  | { readonly kind: "http_error"; readonly status: number }
  | { readonly kind: "transient_provider_error" };

/**
 * Deliberately narrow provider boundary. A live implementation is deferred to
 * a later slice; fixtures implement it without network I/O.
 */
export interface ResendValidationTransport {
  probe(credential: string): Promise<ResendValidationProbeResult>;
}

export const resendValidationFixtures = {
  successful: { kind: "success" },
  unauthorized: { kind: "http_error", status: 401 },
  transientProviderFailure: { kind: "transient_provider_error" },
} as const satisfies Record<string, ResendValidationProbeResult>;

export class DeterministicResendValidationClient implements ResendValidationClient {
  public constructor(private readonly transport: ResendValidationTransport) {}

  public async validate(
    credential: string,
  ): Promise<ConnectionValidationStatus> {
    const result = await this.transport.probe(credential);

    if (result.kind === "success") {
      return "connected";
    }

    if (result.kind === "http_error" && result.status === 401) {
      return "invalid_credentials";
    }

    return "unavailable";
  }
}

/** Deterministic transport fixture; it never performs network I/O. */
export class FixtureResendValidationTransport implements ResendValidationTransport {
  public constructor(
    private readonly outcomes: Readonly<
      Record<string, ResendValidationProbeResult>
    >,
  ) {}

  public async probe(credential: string): Promise<ResendValidationProbeResult> {
    return this.outcomes[credential] ?? resendValidationFixtures.unauthorized;
  }
}

/** Convenience fixture client for focused tests. */
export class FixtureResendValidationClient extends DeterministicResendValidationClient {
  public constructor(
    outcomes: Readonly<Record<string, ResendValidationProbeResult>>,
  ) {
    super(new FixtureResendValidationTransport(outcomes));
  }
}
