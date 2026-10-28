import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("secret scan completes successfully for the credential-free repository", () => {
  assert.doesNotThrow(() => {
    execFileSync("node", ["scripts/scan-secrets.mjs"], {
      cwd: new URL("..", import.meta.url),
      stdio: "pipe",
    });
  });
});
