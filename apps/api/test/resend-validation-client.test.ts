import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicResendValidationClient,
  FixtureResendValidationTransport,
  FixtureResendValidationClient,
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
