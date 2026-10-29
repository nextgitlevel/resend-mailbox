import { Pool } from "pg";

import { AuthService } from "./auth/auth-service.js";
import { buildApp } from "./app.js";
import { PostgresIdentityRepository } from "./persistence/identity-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : undefined;
const app = buildApp({
  authService: pool
    ? new AuthService(new PostgresIdentityRepository(pool), {
        bootstrapToken: process.env.BOOTSTRAP_TOKEN,
      })
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
