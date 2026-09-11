import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([
  ".git",
  "node_modules",
  ".nx",
  "dist",
  ".next",
  "coverage",
  "nexora-sdd-engineering-loop",
]);
const patterns = [
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

const matches = [];
for (const file of await walk(root)) {
  const text = await readFile(file, "utf8").catch(() => "");
  if (patterns.some((pattern) => pattern.test(text))) {
    matches.push(path.relative(root, file));
  }
}

if (matches.length > 0) {
  console.error(`Potential secrets found:\n${matches.join("\n")}`);
  process.exit(1);
}

console.log("No high-confidence secrets found.");
