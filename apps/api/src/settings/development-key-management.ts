import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { KeyManagementProvider } from "./credential-encryption.js";

const algorithm = "aes-256-gcm";
const keyLength = 32;
const nonceLength = 12;
const authTagLength = 16;

/** Local development only; production must inject a reviewed KMS provider. */
export class DevelopmentKeyManagementProvider implements KeyManagementProvider {
  public readonly activeKeyVersion = "development-v1";

  public constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== keyLength) {
      throw new Error("INVALID_DEVELOPMENT_ENCRYPTION_KEY");
    }
  }

  public static fromBase64Url(value: string | undefined) {
    if (!value) {
      return undefined;
    }

    const key = Buffer.from(value, "base64url");
    return key.length === keyLength
      ? new DevelopmentKeyManagementProvider(key)
      : undefined;
  }

  public async wrapKey(input: {
    plaintextDek: Buffer;
    keyVersion: string;
  }): Promise<string> {
    if (input.keyVersion !== this.activeKeyVersion) {
      throw new Error("UNKNOWN_KEY_VERSION");
    }

    const nonce = randomBytes(nonceLength);
    const cipher = createCipheriv(algorithm, this.masterKey, nonce, {
      authTagLength,
    });
    const encrypted = Buffer.concat([
      cipher.update(input.plaintextDek),
      cipher.final(),
      cipher.getAuthTag(),
    ]);

    return `${nonce.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  public async unwrapKey(input: {
    wrappedDek: string;
    keyVersion: string;
  }): Promise<Buffer> {
    if (input.keyVersion !== this.activeKeyVersion) {
      throw new Error("UNKNOWN_KEY_VERSION");
    }

    const [encodedNonce, encodedCiphertext] = input.wrappedDek.split(".");
    const nonce = decodeBase64Url(encodedNonce);
    const encrypted = decodeBase64Url(encodedCiphertext);

    if (nonce.length !== nonceLength || encrypted.length <= authTagLength) {
      throw new Error("INVALID_WRAPPED_KEY");
    }

    const decipher = createDecipheriv(algorithm, this.masterKey, nonce, {
      authTagLength,
    });
    decipher.setAuthTag(encrypted.subarray(-authTagLength));

    return Buffer.concat([
      decipher.update(encrypted.subarray(0, -authTagLength)),
      decipher.final(),
    ]);
  }
}

const decodeBase64Url = (value: string | undefined) => {
  if (!value) {
    return Buffer.alloc(0);
  }

  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : Buffer.alloc(0);
};
