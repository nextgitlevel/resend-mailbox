import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "apps/client/package.json",
  "apps/api/package.json",
  "compose.dev.yaml",
  ".env.example",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "docs/ARCHITECTURE.md",
  "docs/adr/0001-tenant-and-domain-isolation.md",
  "docs/adr/0002-inbound-message-lifecycle.md",
  "docs/adr/0003-encrypted-account-settings.md",
];

test("repository publishes every required foundation and architecture file", () => {
  for (const file of requiredFiles) {
    assert.equal(existsSync(resolve(root, file)), true, `missing ${file}`);
  }
});

test("Sprint 1 ADRs preserve the required security boundaries", () => {
  const tenantIsolation = readFileSync(
    resolve(root, "docs/adr/0001-tenant-and-domain-isolation.md"),
    "utf8",
  );
  const inboundLifecycle = readFileSync(
    resolve(root, "docs/adr/0002-inbound-message-lifecycle.md"),
    "utf8",
  );
  const encryptedSettings = readFileSync(
    resolve(root, "docs/adr/0003-encrypted-account-settings.md"),
    "utf8",
  );

  assert.match(
    tenantIsolation,
    /organization is the top-level authorization boundary/i,
  );
  assert.match(
    tenantIsolation,
    /Every\s+organization-owned\s+record carries `organization_id`/,
  );
  assert.match(inboundLifecycle, /raw-body verification/i);
  assert.match(inboundLifecycle, /verify signature against raw body/i);
  assert.match(inboundLifecycle, /idempotent state machine/i);
  assert.match(inboundLifecycle, /Replays are successful no-ops/i);
  assert.match(encryptedSettings, /envelope encryption/i);
  assert.match(encryptedSettings, /Rotation is dual-read/i);
  assert.match(encryptedSettings, /never return the stored secret/i);
});

test("root workspace provides reproducible quality commands", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  assert.match(manifest.packageManager ?? "", /^pnpm@/);
  for (const script of [
    "test",
    "lint",
    "typecheck",
    "format:check",
    "security:scan",
  ]) {
    assert.equal(
      typeof manifest.scripts?.[script],
      "string",
      `missing ${script} script`,
    );
  }
});

test("development compose is explicitly local-only and uses no application image", () => {
  const compose = readFileSync(resolve(root, "compose.dev.yaml"), "utf8");
  assert.match(compose, /name:\s*resend-mailbox-dev/);
  assert.match(compose, /postgres:/);
  assert.match(compose, /redis:/);
  assert.match(compose, /seaweedfs:/);
  assert.doesNotMatch(compose, /resend-mailbox-api|resend-mailbox-client/);
  assert.match(compose, /chrislusf\/seaweedfs:3\.91/);
  assert.doesNotMatch(compose, /minio\/minio/);
  assert.match(compose, /server -filer -s3/);
  assert.match(compose, /127\.0\.0\.1:15432:5432/);
  assert.match(compose, /127\.0\.0\.1:16379:6379/);
  assert.match(compose, /127\.0\.0\.1:19000:8333/);
  assert.doesNotMatch(compose, /127\.0\.0\.1:5432:5432/);
  assert.doesNotMatch(compose, /127\.0\.0\.1:6379:6379/);
  assert.doesNotMatch(compose, /[^:]19000:8333/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /wget -qO- http:\/\/127\.0\.0\.1:8333\//);
});
