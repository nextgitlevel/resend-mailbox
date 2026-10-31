import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicResendValidationClient,
  FixtureResendValidationTransport,
  FixtureResendValidationClient,
  ResendValidationHttpTransport,
  type ConnectionValidationStatus,
  resendValidationFixtures,
} from "../src/settings/resend-validation-client.js";

test("validation maps successful, unauthorized, and transient provider fixtures to safe statuses", async () => {
  const client = new DeterministicResendValidationClient(
    new FixtureResendValidationTransport({
      valid_fixture_credential: resendValidationFixtures.successful,
      rejected_fixture_credential: resendValidationFixtures.unauthorized,
      unavailable_fixture_credential:
        resendValidationFixtures.transientProviderFailure,
      unexpected_fixture_credential: { kind: "http_error", status: 500 },
    }),
  );

  const statuses: ConnectionValidationStatus[] = await Promise.all([
    client.validate("valid_fixture_credential"),
    client.validate("rejected_fixture_credential"),
    client.validate("unavailable_fixture_credential"),
    client.validate("unexpected_fixture_credential"),
  ]);

  assert.deepEqual(statuses, [
    "connected",
    "invalid_credentials",
    "unavailable",
    "unavailable",
  ]);
});

test("fixture validation does not use the global network API or return its credential", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network access is prohibited in fixture validation");
  };

  try {
    const credential = "credential_that_must_not_be_returned";
    const client = new FixtureResendValidationClient({
      [credential]: resendValidationFixtures.successful,
    });

    const result = await client.validate(credential);

    assert.equal(result, "connected");
    assert.notEqual(result, credential);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fixture validation treats an unmapped credential as invalid without exposing it", async () => {
  const client = new FixtureResendValidationClient({
    valid_fixture_credential: resendValidationFixtures.successful,
  });

  const result = await client.validate("unknown_fixture_credential");

  assert.equal(result, "invalid_credentials");
  assert.notEqual(result, "unknown_fixture_credential");
});

test("live validation probes Resend without returning the API credential", async () => {
  const credential = ["re", "secret", "fixture"].join("_");
  let captured: RequestInit | undefined;
  const transport = new ResendValidationHttpTransport(async (_input, init) => {
    captured = init;
    return Response.json({ object: "list", data: [], has_more: false });
  });
  const result = await new DeterministicResendValidationClient(
    transport,
  ).validate(credential);
  assert.equal(result, "connected");
  assert.equal(
    new Headers(captured?.headers).get("Authorization"),
    `Bearer ${credential}`,
  );
  assert.notEqual(result, credential);
});

test("live validation classifies unauthorized keys and network errors safely", async () => {
  const unauthorized = new ResendValidationHttpTransport(async () =>
    Response.json({ message: "secret error" }, { status: 401 }),
  );
  const networkFailure = new ResendValidationHttpTransport(async () => {
    throw new Error("private network details");
  });
  const client = new DeterministicResendValidationClient(unauthorized);
  assert.equal(await client.validate("re_invalid"), "invalid_credentials");
  assert.equal(
    await new DeterministicResendValidationClient(networkFailure).validate(
      "re_private",
    ),
    "unavailable",
  );
});
