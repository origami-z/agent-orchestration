#!/usr/bin/env node

/**
 * Consumer Update Script
 *
 * Updates a consumer app to use the locally-published library version.
 * Handles:
 * - Pointing the consumer at the local Verdaccio registry
 * - Installing the new version of the library
 * - Running verification steps (build, test, lint) auto-detected from package.json
 *
 * Usage:
 *   node consumer-update.mjs --consumer <path> --library-name <name> [options]
 *   node consumer-update.mjs <consumer-name> [--config <path>]  (legacy mode)
 *
 * Options:
 *   --consumer <path>        Path to the consumer app directory
 *   --library-name <name>    npm package name of the library (e.g. @myorg/components)
 *   --port <port>            Verdaccio port (default: 4873)
 *   --steps <steps>          Comma-separated verify steps (default: auto-detect from package.json)
 *   --config <path>          Path to orchestration.config.json (legacy mode)
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  port: 4873,
  steps: ["build", "test", "lint"],
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--consumer":
        parsed.consumerPath = args[++i];
        break;
      case "--library-name":
        parsed.libraryName = args[++i];
        break;
      case "--port":
        parsed.port = parseInt(args[++i], 10);
        break;
      case "--steps":
        parsed.steps = args[++i].split(",");
        break;
      case "--config":
        parsed.configPath = args[++i];
        break;
      default:
        if (!args[i].startsWith("--") && !parsed.legacyConsumerName) {
          parsed.legacyConsumerName = args[i];
        }
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

function detectVerifySteps(projectPath) {
  const pkgPath = resolve(projectPath, "package.json");
  if (!existsSync(pkgPath)) return [];

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const scripts = pkg.scripts || {};
  const detected = [];

  for (const step of DEFAULTS.steps) {
    if (scripts[step]) {
      detected.push(step);
    }
  }

  return detected;
}

function buildCommand(packageManager, scriptName) {
  if (packageManager === "pnpm") return `pnpm run ${scriptName}`;
  if (packageManager === "yarn") return `yarn ${scriptName}`;
  return `npm run ${scriptName}`;
}

function getLocalVersion() {
  const versionFile = resolve(__dirname, "..", ".local-version");
  if (!existsSync(versionFile)) {
    throw new Error(
      "No .local-version file found. Run verdaccio-publish.mjs first."
    );
  }
  return readFileSync(versionFile, "utf-8").trim();
}

function setRegistry(consumerPath, registryUrl) {
  const npmrcPath = resolve(consumerPath, ".npmrc");
  const existingNpmrc = existsSync(npmrcPath)
    ? readFileSync(npmrcPath, "utf-8")
    : "";

  if (existingNpmrc) {
    writeFileSync(npmrcPath + ".bak", existingNpmrc);
  }

  const registryLine = `registry=${registryUrl}`;
  const lines = existingNpmrc.split("\n").filter((l) => !l.startsWith("registry="));
  lines.push(registryLine);
  writeFileSync(npmrcPath, lines.join("\n") + "\n");

  console.log(`Set registry to ${registryUrl}`);
}

function restoreRegistry(consumerPath) {
  const npmrcPath = resolve(consumerPath, ".npmrc");
  const backupPath = npmrcPath + ".bak";

  if (existsSync(backupPath)) {
    const backup = readFileSync(backupPath, "utf-8");
    writeFileSync(npmrcPath, backup);
    execSync(`rm ${backupPath}`);
    console.log("Restored original .npmrc");
  }
}

function installDependency(consumerPath, depName, version, packageManager, registryUrl) {
  const versionSpec = `${depName}@${version}`;
  let cmd;

  if (packageManager === "pnpm") {
    cmd = `pnpm add ${versionSpec} --registry ${registryUrl}`;
  } else if (packageManager === "yarn") {
    cmd = `yarn add ${versionSpec} --registry ${registryUrl}`;
  } else {
    cmd = `npm install ${versionSpec} --registry ${registryUrl}`;
  }

  console.log(`Installing ${versionSpec}...`);
  execSync(cmd, { cwd: consumerPath, stdio: "inherit" });
}

function runVerification(consumerPath, packageManager, steps) {
  const results = {};

  for (const step of steps) {
    const command = buildCommand(packageManager, step);
    console.log(`\n--- Running ${step}: ${command} ---`);
    try {
      execSync(command, { cwd: consumerPath, stdio: "inherit" });
      results[step] = { status: "passed" };
      console.log(`${step}: PASSED`);
    } catch (error) {
      results[step] = {
        status: "failed",
        error: error.message,
        exitCode: error.status,
      };
      console.log(`${step}: FAILED (exit code ${error.status})`);
    }
  }

  return results;
}

function loadLegacyConfig(configPath) {
  return JSON.parse(readFileSync(resolve(configPath), "utf-8"));
}

function runLegacy(consumerName, configPath) {
  const config = loadLegacyConfig(configPath);
  const consumer = config.consumers.find((c) => c.name === consumerName);

  if (!consumer) {
    console.error(
      `Consumer "${consumerName}" not found in config. Available: ${config.consumers.map((c) => c.name).join(", ")}`
    );
    process.exit(1);
  }

  const consumerPath = resolve(dirname(configPath), consumer.path);
  const registryUrl = config.verdaccio?.url || `http://localhost:${DEFAULTS.port}`;
  const version = getLocalVersion();
  const steps = config.orchestration?.verifySteps || detectVerifySteps(consumerPath);
  const packageManager = consumer.packageManager || detectPackageManager(consumerPath);

  console.log(`\n=== Updating ${consumer.name} to ${config.library.name}@${version} ===\n`);

  try {
    setRegistry(consumerPath, registryUrl, packageManager);
    installDependency(consumerPath, consumer.dependencyName, version, packageManager, registryUrl);
    const results = runVerification(consumerPath, packageManager, steps);
    writeResults(consumer.name, version, results);
  } finally {
    restoreRegistry(consumerPath);
  }
}

function writeResults(name, version, results) {
  const allPassed = Object.values(results).every(
    (r) => r.status === "passed" || r.status === "skipped"
  );

  console.log("\n=== Results ===");
  for (const [step, result] of Object.entries(results)) {
    console.log(`  ${step}: ${result.status}`);
  }

  const resultsFile = resolve(__dirname, "..", `.results-${name}.json`);
  writeFileSync(
    resultsFile,
    JSON.stringify({ consumer: name, version, results, allPassed }, null, 2)
  );

  if (!allPassed) {
    console.log(`\n❌ ${name}: Verification FAILED`);
    process.exit(1);
  }

  console.log(`\n✅ ${name}: All checks passed`);
}

function main() {
  const parsed = parseArgs(process.argv);

  // Legacy mode: consumer-update.mjs <name> [--config <path>]
  if (parsed.legacyConsumerName && !parsed.consumerPath) {
    const configPath =
      parsed.configPath || resolve(__dirname, "..", "orchestration.config.json");
    if (!existsSync(configPath)) {
      console.error(
        "Legacy mode requires orchestration.config.json. Use --consumer and --library-name flags instead."
      );
      process.exit(1);
    }
    return runLegacy(parsed.legacyConsumerName, configPath);
  }

  // New mode: --consumer <path> --library-name <name>
  if (!parsed.consumerPath) {
    console.error(
      "Usage:\n" +
        "  node consumer-update.mjs --consumer <path> --library-name <name> [--port <port>] [--steps build,test]\n" +
        "  node consumer-update.mjs <consumer-name> [--config <path>]  (legacy)\n"
    );
    process.exit(1);
  }

  if (!parsed.libraryName) {
    console.error("--library-name is required (e.g. @myorg/components)");
    process.exit(1);
  }

  const consumerPath = resolve(parsed.consumerPath);
  const port = parsed.port || DEFAULTS.port;
  const registryUrl = `http://localhost:${port}`;
  const packageManager = detectPackageManager(consumerPath);
  const steps = parsed.steps || detectVerifySteps(consumerPath);
  const version = getLocalVersion();
  const consumerName = basename(consumerPath);

  if (steps.length === 0) {
    console.warn("Warning: no verify steps detected in package.json (looked for: build, test, lint)");
  }

  console.log(`\n=== Updating ${consumerName} to ${parsed.libraryName}@${version} ===`);
  console.log(`  Package manager: ${packageManager}`);
  console.log(`  Verify steps: ${steps.join(", ") || "(none)"}`);
  console.log(`  Registry: ${registryUrl}\n`);

  try {
    setRegistry(consumerPath, registryUrl);
    installDependency(consumerPath, parsed.libraryName, version, packageManager, registryUrl);
    const results = runVerification(consumerPath, packageManager, steps);
    writeResults(consumerName, version, results);
  } finally {
    restoreRegistry(consumerPath);
  }
}

main();
