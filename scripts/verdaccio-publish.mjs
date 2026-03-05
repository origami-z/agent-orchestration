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
 * Usage:
 *   node verdaccio-publish.mjs --library <path> [options]
 *   node verdaccio-publish.mjs [--config <path>]  (legacy mode)
 *
 * Options:
 *   --library <path>    Path to the library directory
 *   --port <port>       Verdaccio port (default: 4873)
 *   --config <path>     Path to orchestration.config.json (legacy mode)
 */

import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  port: 4873,
  storage: "/tmp/verdaccio-storage",
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--library":
        parsed.libraryPath = args[++i];
        break;
      case "--port":
        parsed.port = parseInt(args[++i], 10);
        break;
      case "--config":
        parsed.configPath = args[++i];
        break;
    }
  }

  return parsed;
}

function detectPackageManager(projectPath) {
  if (existsSync(resolve(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(projectPath, "yarn.lock"))) return "yarn";
  return "npm";
}

function detectBuildCommand(projectPath, packageManager) {
  const pkgPath = resolve(projectPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const scripts = pkg.scripts || {};

  if (!scripts.build) return null;

  if (packageManager === "pnpm") return "pnpm run build";
  if (packageManager === "yarn") return "yarn build";
  return "npm run build";
}

function isVerdaccioRunning(port) {
  try {
    execSync(`curl -sf http://localhost:${port}/-/ping`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function startVerdaccio(port, storage, libraryName) {
  if (isVerdaccioRunning(port)) {
    console.log(`Verdaccio already running on port ${port}`);
    return null;
  }

  if (!existsSync(storage)) {
    mkdirSync(storage, { recursive: true });
  }

  const verdaccioConfigPath = resolve(storage, "config.yaml");
  const libraryPackageBlock = libraryName
    ? `  "${libraryName}":\n    access: $all\n    publish: $all\n    unpublish: $all\n`
    : "";

  const verdaccioConfig = `
storage: ${storage}
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
${libraryPackageBlock}  "@*/*":
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
  const parsed = parseArgs(process.argv);

  let libraryPath;
  let port = parsed.port || DEFAULTS.port;
  let libraryName;

  // Legacy mode: read from config
  if (parsed.configPath || (!parsed.libraryPath && existsSync(resolve(__dirname, "..", "orchestration.config.json")))) {
    const configPath = parsed.configPath || resolve(__dirname, "..", "orchestration.config.json");
    const config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));
    libraryPath = resolve(dirname(configPath), config.library.path);
    port = config.verdaccio?.port || port;
    libraryName = config.library.name;
  } else if (parsed.libraryPath) {
    libraryPath = resolve(parsed.libraryPath);
    const pkg = JSON.parse(readFileSync(resolve(libraryPath, "package.json"), "utf-8"));
    libraryName = pkg.name;
  } else {
    console.error(
      "Usage:\n" +
        "  node verdaccio-publish.mjs --library <path> [--port <port>]\n" +
        "  node verdaccio-publish.mjs [--config <path>]  (legacy)\n"
    );
    process.exit(1);
  }

  const registryUrl = `http://localhost:${port}`;
  const packageManager = detectPackageManager(libraryPath);
  const storage = DEFAULTS.storage;

  console.log(`Library: ${libraryPath}`);
  console.log(`Package: ${libraryName}`);
  console.log(`Package manager: ${packageManager}`);
  console.log(`Registry: ${registryUrl}\n`);

  // Step 1: Ensure Verdaccio is running
  startVerdaccio(port, storage, libraryName);

  // Step 2: Build the library
  const buildCommand = detectBuildCommand(libraryPath, packageManager);
  if (buildCommand) {
    console.log("\n--- Building library ---");
    execSync(buildCommand, { cwd: libraryPath, stdio: "inherit" });
  } else {
    console.log("\n--- No build script found, skipping build ---");
  }

  // Step 3: Bump version with local tag
  const newVersion = bumpLocalVersion(libraryPath);

  // Step 4: Publish to local registry
  publish(libraryPath, registryUrl, packageManager);

  // Output the version for downstream consumers
  console.log(`\n✅ Published ${libraryName}@${newVersion}`);
  console.log(`Registry: ${registryUrl}`);

  // Write version to a temp file so other scripts can read it
  const versionFile = resolve(__dirname, "..", ".local-version");
  writeFileSync(versionFile, newVersion);
}

main();
