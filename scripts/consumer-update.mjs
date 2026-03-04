#!/usr/bin/env node

/**
 * Consumer Update Script
 *
 * Updates a consumer app to use the locally-published library version.
 * Handles:
 * - Pointing the consumer at the local Verdaccio registry
 * - Installing the new version of the library
 * - Running verification steps (build, test, lint)
 *
 * Usage: node consumer-update.mjs <consumer-name> [--config <path>]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig(configPath) {
  return JSON.parse(readFileSync(resolve(configPath), "utf-8"));
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

function setRegistry(consumerPath, registryUrl, packageManager) {
  const npmrcPath = resolve(consumerPath, ".npmrc");
  const existingNpmrc = existsSync(npmrcPath)
    ? readFileSync(npmrcPath, "utf-8")
    : "";

  // Back up existing .npmrc
  if (existingNpmrc) {
    writeFileSync(npmrcPath + ".bak", existingNpmrc);
  }

  // Add/replace registry line for scoped package
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
  } else {
    cmd = `npm install ${versionSpec} --registry ${registryUrl}`;
  }

  console.log(`Installing ${versionSpec}...`);
  execSync(cmd, { cwd: consumerPath, stdio: "inherit" });
}

function runVerification(consumerPath, consumer, steps) {
  const results = {};

  for (const step of steps) {
    const commandKey = `${step}Command`;
    const command = consumer[commandKey];

    if (!command) {
      console.log(`Skipping ${step}: no command configured`);
      results[step] = { status: "skipped" };
      continue;
    }

    console.log(`\n--- Running ${step} ---`);
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

function main() {
  const args = process.argv.slice(2);
  const consumerName = args[0];

  if (!consumerName) {
    console.error("Usage: node consumer-update.mjs <consumer-name> [--config <path>]");
    process.exit(1);
  }

  let configPath = resolve(__dirname, "..", "orchestration.config.json");
  const configIdx = args.indexOf("--config");
  if (configIdx !== -1 && args[configIdx + 1]) {
    configPath = args[configIdx + 1];
  }

  const config = loadConfig(configPath);
  const consumer = config.consumers.find((c) => c.name === consumerName);

  if (!consumer) {
    console.error(`Consumer "${consumerName}" not found in config. Available: ${config.consumers.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }

  const consumerPath = resolve(dirname(configPath), consumer.path);
  const registryUrl = config.verdaccio.url;
  const version = getLocalVersion();
  const steps = config.orchestration.verifySteps;

  console.log(`\n=== Updating ${consumer.name} to ${config.library.name}@${version} ===\n`);

  try {
    // Step 1: Point at local registry
    setRegistry(consumerPath, registryUrl, consumer.packageManager);

    // Step 2: Install new version
    installDependency(
      consumerPath,
      consumer.dependencyName,
      version,
      consumer.packageManager,
      registryUrl
    );

    // Step 3: Run verification
    const results = runVerification(consumerPath, consumer, steps);

    // Step 4: Summary
    const allPassed = Object.values(results).every(
      (r) => r.status === "passed" || r.status === "skipped"
    );

    console.log("\n=== Results ===");
    for (const [step, result] of Object.entries(results)) {
      console.log(`  ${step}: ${result.status}`);
    }

    // Write results to file for orchestrator to read
    const resultsFile = resolve(__dirname, "..", `.results-${consumer.name}.json`);
    writeFileSync(
      resultsFile,
      JSON.stringify({ consumer: consumer.name, version, results, allPassed }, null, 2)
    );

    if (!allPassed) {
      console.log(`\n❌ ${consumer.name}: Verification FAILED`);
      process.exit(1);
    }

    console.log(`\n✅ ${consumer.name}: All checks passed`);
  } finally {
    // Always restore the original .npmrc
    restoreRegistry(consumerPath);
  }
}

main();
