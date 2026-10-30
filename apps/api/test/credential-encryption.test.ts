import assert from "node:assert/strict";
import test from "node:test";

import {
  CredentialEncryptionService,
  type KeyManagementProvider,
} from "../src/settings/credential-encryption.js";

const createKeyProvider = (): KeyManagementProvider => ({
  activeKeyVersion: "test-kek-v1",
  wrapKey: async ({ plaintextDek, keyVersion }) =>
    `${keyVersion}:${plaintextDek.toString("base64url")}`,
  unwrapKey: async ({ wrappedDek, keyVersion }) => {
    const [storedVersion, encodedDek] = wrappedDek.split(":");

    if (storedVersion !== keyVersion || !encodedDek) {
      throw new Error("KEY_UNWRAP_FAILED");
    }

    return Buffer.from(encodedDek, "base64url");
  },
});

test("credentials are envelope-encrypted and never embedded in their stored envelope", async () => {
  const service = new CredentialEncryptionService(createKeyProvider());
  const credential = "test_credential_that_must_never_be_persisted_plaintext";

  const envelope = await service.encrypt(credential);

  assert.equal(envelope.keyVersion, "test-kek-v1");
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(envelope.ciphertext.includes(credential), false);
  assert.equal(envelope.wrappedDek.includes(credential), false);
  assert.equal(JSON.stringify(envelope).includes(credential), false);
  assert.equal(await service.decrypt(envelope), credential);
});

test("credential decryption fails closed when ciphertext is tampered or the KEK cannot unwrap", async () => {
  const service = new CredentialEncryptionService(createKeyProvider());
  const envelope = await service.encrypt("test_tamper_fixture");

  await assert.rejects(
    service.decrypt({ ...envelope, ciphertext: `${envelope.ciphertext}x` }),
  );

  const unavailableProvider: KeyManagementProvider = {
    ...createKeyProvider(),
    unwrapKey: async () => {
      throw new Error("KEY_UNWRAP_FAILED");
    },
  };

  await assert.rejects(
    new CredentialEncryptionService(unavailableProvider).decrypt(envelope),
    /KEY_UNWRAP_FAILED/,
  );
});
