import { Pool } from "pg";
import { OutboundDeliveryWorker } from "./outbound/outbound-delivery-worker.js";
import { runDeliveryWorker } from "./outbound/delivery-worker-runtime.js";
import { ResendOutboundTransport } from "./outbound/resend-outbound-transport.js";
import { ResendSdkSendClient } from "./outbound/resend-sdk-send-client.js";
import { PostgresIdentityRepository } from "./persistence/identity-repository.js";
import { CredentialEncryptionService } from "./settings/credential-encryption.js";
import { DevelopmentKeyManagementProvider } from "./settings/development-key-management.js";

if (process.env.NODE_ENV !== "development") {
  throw new Error("OUTBOUND_WORKER_REQUIRES_REVIEWED_KEY_MANAGEMENT");
}

const databaseUrl = process.env.DATABASE_URL;
const keyManagement = DevelopmentKeyManagementProvider.fromBase64Url(
  process.env.ENCRYPTION_MASTER_KEY,
);
if (!databaseUrl || !keyManagement) {
  throw new Error("OUTBOUND_WORKER_CONFIGURATION_REQUIRED");
}

const pool = new Pool({ connectionString: databaseUrl });
const repository = new PostgresIdentityRepository(pool);
const transport = new ResendOutboundTransport(
  repository,
  new CredentialEncryptionService(keyManagement),
  new ResendSdkSendClient(),
);
const worker = new OutboundDeliveryWorker(repository, transport);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
  await runDeliveryWorker({ worker, pool, signal: controller.signal });
} catch (error) {
  await pool.end();
  throw error;
}
