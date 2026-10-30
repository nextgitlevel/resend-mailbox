import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { EncryptedSecretEnvelope } from "../persistence/identity-repository.js";

export interface KeyManagementProvider {
  activeKeyVersion: string;
  wrapKey(input: { plaintextDek: Buffer; keyVersion: string }): Promise<string>;
  unwrapKey(input: { wrappedDek: string; keyVersion: string }): Promise<Buffer>;
}

const algorithm = "aes-256-gcm";
const dekLength = 32;
const nonceLength = 12;
const authTagLength = 16;

export class CredentialEncryptionService {
  public constructor(private readonly keyManagement: KeyManagementProvider) {}

  public async encrypt(plaintext: string): Promise<EncryptedSecretEnvelope> {
    if (plaintext.length === 0) {
      throw new Error("INVALID_CREDENTIAL");
    }

    const dek = randomBytes(dekLength);
    const nonce = randomBytes(nonceLength);
    const cipher = createCipheriv(algorithm, dek, nonce, { authTagLength });
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);

    return {
      ciphertext: ciphertext.toString("base64url"),
      nonce: nonce.toString("base64url"),
      wrappedDek: await this.keyManagement.wrapKey({
        plaintextDek: dek,
        keyVersion: this.keyManagement.activeKeyVersion,
      }),
      keyVersion: this.keyManagement.activeKeyVersion,
      algorithm,
    };
  }

  public async decrypt(envelope: EncryptedSecretEnvelope): Promise<string> {
    if (envelope.algorithm !== algorithm) {
      throw new Error("UNSUPPORTED_CREDENTIAL_ALGORITHM");
    }

    const nonce = Buffer.from(envelope.nonce, "base64url");
    const encrypted = Buffer.from(envelope.ciphertext, "base64url");
    const dek = await this.keyManagement.unwrapKey({
      wrappedDek: envelope.wrappedDek,
      keyVersion: envelope.keyVersion,
    });

    if (
      nonce.length !== nonceLength ||
      dek.length !== dekLength ||
      encrypted.length <= authTagLength
    ) {
      throw new Error("INVALID_CREDENTIAL_ENVELOPE");
    }

    const ciphertext = encrypted.subarray(0, -authTagLength);
    const authTag = encrypted.subarray(-authTagLength);
    const decipher = createDecipheriv(algorithm, dek, nonce, { authTagLength });
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}
