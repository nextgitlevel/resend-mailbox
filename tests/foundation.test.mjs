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
];

test("Sprint 0 publishes every required foundation file", () => {
  for (const file of requiredFiles) {
    assert.equal(existsSync(resolve(root, file)), true, `missing ${file}`);
  }
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
  assert.match(compose, /minio:/);
  assert.doesNotMatch(compose, /resend-mailbox-api|resend-mailbox-client/);
  assert.doesNotMatch(compose, /minio\/minio:latest/);
  assert.match(compose, /MINIO_ROOT_PASSWORD:\s*\$\{MINIO_ROOT_PASSWORD:\?/);
});
