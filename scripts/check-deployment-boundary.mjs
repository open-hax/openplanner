#!/usr/bin/env node

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const retiredEntryPoints = [
  ".github/workflows/deploy-testing.yml",
  "packages/axxium/.github/workflows/deploy.yml",
  "service/docker-compose.knoxx.yml",
  "service/docker-compose.vps.yml",
  "service/docker-compose.legacy.yml",
  "service/cloud/nginx/promethean.conf",
  "service/ecosystem.vps.config.cjs",
];
const activePathspecs = [
  ".github/workflows",
  "service",
  "packages",
  "scripts",
  ".env",
  ".env.example",
  "Dockerfile",
  "docker-compose.yml",
  "nginx.conf",
  "prometheus.yml",
];
const rules = [
  ["retired Services workflow", /deploy-promethean\.ya?ml/],
  ["legacy VPS address", /\b104\.130\.159\.19\b/],
  ["legacy SSH identity", /\berror@(?:[^\s]+\.promethean\.rest|104\.130\.159\.19)\b/],
  ["legacy runtime root", /\/home\/error(?:\/|\b)/],
  ["unverified SSH policy", /StrictHostKeyChecking\s*(?:=|\s)\s*(?:accept-new|no)\b/i],
  ["unverified SSH host-key discovery", /\bssh-keyscan\b/],
  [
    "legacy SSH host default",
    /(?:DEPLOY_HOST|STAGING_HOST|TESTING_HOST|PRODUCTION_HOST|PROMETHEAN_SSH_HOST)[^\n]{0,200}(?:knoxx|proxx|ussy)[^\n]{0,80}\.promethean\.rest/,
  ],
  [
    "legacy SSH user default",
    /(?:DEPLOY_USER|STAGING_SSH_USER|TESTING_SSH_USER|PRODUCTION_SSH_USER|PROMETHEAN_SSH_USER)[^\n]{0,200}\berror\b/,
  ],
];

async function exists(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function trackedFilesBelow(pathspecs) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--", ...pathspecs],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .split("\0")
    .filter((relativePath) => relativePath && relativePath !== "scripts/check-deployment-boundary.mjs")
    .sort();
}

function violations(relativePath, text) {
  const found = [];
  for (const [lineIndex, line] of text.split("\n").entries()) {
    for (const [name, pattern] of rules) {
      if (pattern.test(line)) found.push({ relativePath, line: lineIndex + 1, name, source: line.trim() });
    }
  }
  return found;
}

function selfTest() {
  const bad = [
    "uses: open-hax/services/.github/workflows/deploy-promethean.yaml@main",
    "ssh error@104.130.159.19",
    "runtimeRoot: /home/error/devel/services/openplanner",
    "StrictHostKeyChecking no",
    "ssh-keyscan -H host.example",
    "DEPLOY_HOST: knoxx.promethean.rest",
    "DEPLOY_USER: error",
  ];
  const safe = [
    "PROXX_PUBLIC_HOST=proxx.promethean.rest",
    "runtimeRoot: /srv/open-hax",
    "sshUser: deploy",
    "StrictHostKeyChecking yes",
  ];
  const failures = [];
  for (const sample of bad) {
    if (violations("bad", sample).length === 0) failures.push(`missed forbidden sample: ${sample}`);
  }
  for (const sample of safe) {
    if (violations("safe", sample).length !== 0) failures.push(`rejected safe sample: ${sample}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    return 1;
  }
  console.log("deployment boundary classifier self-test passed");
  return 0;
}

async function scan() {
  const found = [];
  for (const relativePath of retiredEntryPoints) {
    if (await exists(relativePath)) {
      found.push({ relativePath, line: 1, name: "retired deploy entry point exists", source: relativePath });
    }
  }
  for (const relativePath of await trackedFilesBelow(activePathspecs)) {
    if (!(await exists(relativePath))) continue;
    if (!(await lstat(path.join(repositoryRoot, relativePath))).isFile()) continue;
    const text = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    found.push(...violations(relativePath, text));
  }
  if (found.length > 0) {
    for (const item of found) {
      console.error(`::error file=${item.relativePath},line=${item.line}::${item.name}: ${item.source}`);
    }
    console.error(`deployment boundary rejected ${found.length} legacy reference(s)`);
    return 1;
  }
  console.log("deployment boundary contains no active legacy deployment authority");
  return 0;
}

process.exitCode = process.argv.includes("--self-test") ? selfTest() : await scan();
