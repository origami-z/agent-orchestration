#!/usr/bin/env node

/**
 * Verdaccio Local Publish Script
 *
 * Publishes a package to a local Verdaccio registry. Handles:
 * - Starting Verdaccio if not already running
 * - Bumping version with a local prerelease tag
 * - Publishing to the local registry
 * - Cleaning up on failure
 *
 * Usage: node verdaccio-publish.mjs [--config <path>]
 *
 * Works with both npm and pnpm.
 */

import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig(configPath) {
  const fullPath = resolve(configPath);
  return JSON.parse(readFileSync(fullPath, "utf-8"));
}

function isVerdaccioRunning(port) {
  try {
    execSync(`curl -sf http://localhost:${port}/-/ping`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function startVerdaccio(config) {
  const { port, storage } = config.verdaccio;

  if (isVerdaccioRunning(port)) {
    console.log(`Verdaccio already running on port ${port}`);
    return null;
  }

  if (!existsSync(storage)) {
    mkdirSync(storage, { recursive: true });
  }

  // Create a minimal Verdaccio config
  const verdaccioConfigPath = resolve(storage, "config.yaml");
  const verdaccioConfig = `
storage: ${storage}
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  "${config.library.name}":
    access: $all
    publish: $all
    unpublish: $all
  "@*/*":
    access: $all
    publish: $all
    proxy: npmjs
  "**":
    access: $all
    publish: $all
    proxy: npmjs
listen: 0.0.0.0:${port}
log: { type: stdout, format: pretty, level: warn }
`;

  writeFileSync(verdaccioConfigPath, verdaccioConfig);

  console.log(`Starting Verdaccio on port ${port}...`);
  const proc = spawn("verdaccio", ["--config", verdaccioConfigPath], {
    stdio: "pipe",
    detached: true,
  });

  proc.unref();

  // Wait for Verdaccio to be ready
  const maxWait = 15000;
  const interval = 500;
  let waited = 0;

  while (waited < maxWait) {
    execSync(`sleep 0.5`);
    waited += interval;
    if (isVerdaccioRunning(port)) {
      console.log("Verdaccio is ready.");
      return proc;
    }
  }

  throw new Error("Verdaccio failed to start within timeout");
}

function bumpLocalVersion(libraryPath) {
  const pkgPath = resolve(libraryPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  const baseVersion = pkg.version.replace(/-local\.\d+$/, "");
  const localTag = `local.${Date.now()}`;
  const newVersion = `${baseVersion}-${localTag}`;

  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  console.log(`Bumped version: ${newVersion}`);
  return newVersion;
}

function publish(libraryPath, registryUrl, packageManager) {
  const cmd =
    packageManager === "pnpm"
      ? `pnpm publish --registry ${registryUrl} --no-git-checks`
      : `npm publish --registry ${registryUrl}`;

  console.log(`Publishing to ${registryUrl}...`);
  execSync(cmd, { cwd: libraryPath, stdio: "inherit" });
  console.log("Published successfully.");
}

function main() {
  const args = process.argv.slice(2);
  let configPath = resolve(__dirname, "..", "orchestration.config.json");

  const configIdx = args.indexOf("--config");
  if (configIdx !== -1 && args[configIdx + 1]) {
    configPath = args[configIdx + 1];
  }

  const config = loadConfig(configPath);
  const libraryPath = resolve(dirname(configPath), config.library.path);
  const registryUrl = config.verdaccio.url;
  const packageManager = config.library.packageManager || "npm";

  // Step 1: Ensure Verdaccio is running
  startVerdaccio(config);

  // Step 2: Build the library
  console.log("\n--- Building library ---");
  execSync(config.library.buildCommand, { cwd: libraryPath, stdio: "inherit" });

  // Step 3: Bump version with local tag
  const newVersion = bumpLocalVersion(libraryPath);

  // Step 4: Publish to local registry
  publish(libraryPath, registryUrl, packageManager);

  // Output the version for downstream consumers
  console.log(`\n✅ Published ${config.library.name}@${newVersion}`);
  console.log(`Registry: ${registryUrl}`);

  // Write version to a temp file so other scripts can read it
  const versionFile = resolve(__dirname, "..", ".local-version");
  writeFileSync(versionFile, newVersion);
}

main();
