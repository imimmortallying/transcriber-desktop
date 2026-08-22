"use strict";

const path = require("node:path");
const { npmInvocation, readReleaseVersion, runCommand } = require("./releaseClient");

async function releaseFullSetup(argumentsList = process.argv.slice(2), options = {}) {
  const version = readReleaseVersion(argumentsList);
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..");
  const run = options.run || runCommand;
  const writeOutput = options.writeOutput || console.log;
  const environment = options.environment || process.env;

  const npmVersion = npmInvocation(["version", version, "--no-git-tag-version", "--allow-same-version"], environment);
  const fullSetupBuild = npmInvocation(["run", "dist:win"], environment);
  await run(npmVersion.command, npmVersion.argumentsList, { cwd: projectRoot });
  await run(fullSetupBuild.command, fullSetupBuild.argumentsList, { cwd: projectRoot });
  writeOutput(`Full Setup rebuilt for version ${version}.`);
  return { version };
}

if (require.main === module) {
  releaseFullSetup().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { releaseFullSetup };
