import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\n")
  .filter(Boolean);

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:^|[^A-Za-z0-9_])(?:re|sk|whsec)_[A-Za-z0-9_-]{12,}/,
];

const findings = [];
for (const file of trackedFiles) {
  if (!statSync(file).isFile()) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (patterns.some((pattern) => pattern.test(line))) {
      findings.push(`${file}:${index + 1}: possible credential material`);
    }
  }
}

if (findings.length) {
  console.error("Potential secret detected:\n" + findings.join("\n"));
  process.exit(1);
}

console.log("No likely secrets found in tracked or unignored project files.");
