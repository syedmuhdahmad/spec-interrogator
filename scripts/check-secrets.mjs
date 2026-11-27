#!/usr/bin/env node
/**
 * Fails if anything that looks like a credential is tracked by git.
 * Run by `npm run verify` and by CI on every push.
 *
 * The patterns are assembled from pieces so this file does not match itself.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "API key (s" + "k- prefix)", regex: new RegExp("\\bs" + "k-[A-Za-z0-9_-]{16,}") },
  { name: "GitHub token", regex: new RegExp("\\b(gh[pousr]_[A-Za-z0-9]{30,}|github_" + "pat_[A-Za-z0-9_]{30,})") },
  { name: "Bearer token", regex: /Bearer\s+[A-Za-z0-9._-]{24,}/ },
  { name: "private key", regex: new RegExp("-----BEGIN [A-Z ]*PRIVATE " + "KEY-----") },
  { name: "key assigned a value", regex: /^[ \t]*(LITELLM_API_KEY|GITHUB_TOKEN)[ \t]*=[ \t]*\S+/m },
  { name: "secret exposed to the browser", regex: /NEXT_PUBLIC_[A-Z0-9_]*(KEY|TOKEN|SECRET)/ },
];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const problems = [];
for (const file of files) {
  if (/^\.env(\..+)?$/.test(file) && file !== ".env.example") {
    problems.push(`${file}: env files must not be tracked`);
    continue;
  }
  if (/\.(png|jpg|jpeg|gif|ico|woff2?|lock)$/.test(file) || file === "package-lock.json") continue;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(text);
    if (match) {
      const line = text.slice(0, match.index).split("\n").length;
      problems.push(`${file}:${line}: looks like a ${name}`);
    }
  }
}

if (problems.length > 0) {
  console.error("Possible secrets found. Nothing here may be committed:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nIf a real key was ever committed, tell the organisers and get it replaced: deleting the file is not enough.");
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} files checked.`);
