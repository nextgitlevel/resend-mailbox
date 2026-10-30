import { Pool } from "pg";

import { AuthService } from "./auth/auth-service.js";
import { buildApp } from "./app.js";
import { PostgresIdentityRepository } from "./persistence/identity-repository.js";
import { ConnectionSettingsService } from "./settings/connection-settings-service.js";
import { CredentialEncryptionService } from "./settings/credential-encryption.js";
import { DevelopmentKeyManagementProvider } from "./settings/development-key-management.js";

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
const app = buildApp({
  authService: repository
    ? new AuthService(repository, {
        bootstrapToken: process.env.BOOTSTRAP_TOKEN,
      })
    : undefined,
  connectionSettingsService:
    repository && keyManagement
      ? new ConnectionSettingsService(
          repository,
          new CredentialEncryptionService(keyManagement),
        )
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
