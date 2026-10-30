import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { DevelopmentKeyManagementProvider } from "../src/settings/development-key-management.js";

test("development key management wraps a DEK and rejects tampering or a different master key", async () => {
  const provider = new DevelopmentKeyManagementProvider(randomBytes(32));
  const dek = randomBytes(32);
  const wrappedDek = await provider.wrapKey({
    plaintextDek: dek,
    keyVersion: provider.activeKeyVersion,
  });

  assert.deepEqual(
    await provider.unwrapKey({
      wrappedDek,
      keyVersion: provider.activeKeyVersion,
    }),
    dek,
  );
  await assert.rejects(
    provider.unwrapKey({
      wrappedDek: `${wrappedDek}x`,
      keyVersion: provider.activeKeyVersion,
    }),
  );
  await assert.rejects(
    new DevelopmentKeyManagementProvider(randomBytes(32)).unwrapKey({
      wrappedDek,
      keyVersion: provider.activeKeyVersion,
    }),
  );
});
