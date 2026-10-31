import { Pool } from "pg";

import { AuthService } from "./auth/auth-service.js";
import { AddressPolicyService } from "./domains/address-policy-service.js";
import { buildApp } from "./app.js";
import { DomainSettingsService } from "./domains/domain-settings-service.js";
import { DomainVerificationService } from "./domains/domain-verification-service.js";
import { ResendDomainVerificationClient } from "./domains/resend-domain-verification-client.js";
import { WebhookReceiptService } from "./inbound/webhook-receipt-service.js";
import { OutboundSendService } from "./outbound/outbound-send-service.js";
import { PostgresIdentityRepository } from "./persistence/identity-repository.js";
import { ConnectionSettingsService } from "./settings/connection-settings-service.js";
import { ConnectionValidationService } from "./settings/connection-validation-service.js";
import { CredentialEncryptionService } from "./settings/credential-encryption.js";
import { DevelopmentKeyManagementProvider } from "./settings/development-key-management.js";
import {
  DeterministicResendValidationClient,
  ResendValidationHttpTransport,
} from "./settings/resend-validation-client.js";

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : undefined;
const keyManagement =
  process.env.NODE_ENV === "development"
    ? DevelopmentKeyManagementProvider.fromBase64Url(
        process.env.ENCRYPTION_MASTER_KEY,
      )
    : undefined;
const repository = pool ? new PostgresIdentityRepository(pool) : undefined;
const credentialEncryption = keyManagement
  ? new CredentialEncryptionService(keyManagement)
  : undefined;
const app = buildApp({
  authService: repository
    ? new AuthService(repository, {
        bootstrapToken: process.env.BOOTSTRAP_TOKEN,
      })
    : undefined,
  addressPolicyService: repository
    ? new AddressPolicyService(repository)
    : undefined,
  connectionSettingsService:
    repository && credentialEncryption
      ? new ConnectionSettingsService(repository, credentialEncryption)
      : undefined,
  connectionValidationService:
    repository && credentialEncryption
      ? new ConnectionValidationService(
          repository,
          credentialEncryption,
          new DeterministicResendValidationClient(
            new ResendValidationHttpTransport(),
          ),
        )
      : undefined,
  domainSettingsService: repository
    ? new DomainSettingsService(repository)
    : undefined,
  domainVerificationService:
    repository && credentialEncryption
      ? new DomainVerificationService(
          repository,
          new ResendDomainVerificationClient(repository, credentialEncryption),
        )
      : undefined,
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET,
  webhookReceiptService: repository
    ? new WebhookReceiptService(repository)
    : undefined,
  outboundSendService: repository
    ? new OutboundSendService(repository)
    : undefined,
});
const port = Number(process.env.PORT ?? 3001);

if (pool) {
  app.addHook("onClose", () => pool.end());
}

try {
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
