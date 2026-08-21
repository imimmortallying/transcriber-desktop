const path = require("node:path");
const { buildCoordinator } = require("./buildCoordinator");

const projectRoot = path.resolve(__dirname, "..");
const coordinatorIpcSpikeOutput = path.join(
  projectRoot,
  "build",
  "coordinator-ipc-spike",
  "asr-coordinator.exe",
);

async function buildCoordinatorIpcSpike() {
  return buildCoordinator({
    entryPoint: path.join(projectRoot, "src", "coordinator", "inheritedIpcSpike.js"),
    outputPath: coordinatorIpcSpikeOutput,
  });
}

if (require.main === module) {
  buildCoordinatorIpcSpike().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildCoordinatorIpcSpike, coordinatorIpcSpikeOutput };
