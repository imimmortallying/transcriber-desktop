"use strict";

const path = require("node:path");
const { buildCoordinator } = require("./buildCoordinator");

const projectRoot = path.resolve(__dirname, "..");
const coordinatorClientUpdateE2eOutput = path.join(
  projectRoot,
  "build",
  "coordinator-client-update-e2e",
  "asr-coordinator.exe",
);

async function buildCoordinatorClientUpdateE2e() {
  return buildCoordinator({
    entryPoint: path.join(projectRoot, "test", "coordinator", "clientUpdateE2eCoordinator.js"),
    outputPath: coordinatorClientUpdateE2eOutput,
  });
}

if (require.main === module) {
  buildCoordinatorClientUpdateE2e().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildCoordinatorClientUpdateE2e, coordinatorClientUpdateE2eOutput };
