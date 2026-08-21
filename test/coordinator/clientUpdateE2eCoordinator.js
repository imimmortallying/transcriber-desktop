"use strict";

const path = require("node:path");
const {
  launchCandidateForReady,
  runCoordinator,
} = require("../../src/coordinator/main");
const { stageVerifiedClientUpdate } = require("../../src/update/clientUpdatePackage");

const TEST_KEY_ID = "asr-test-ed25519-2026";
const TEST_TRUSTED_SIGNERS = Object.freeze({
  [TEST_KEY_ID]: Object.freeze({
    algorithm: "ed25519",
    publicKeyPem: [
      "-----BEGIN PUBLIC KEY-----",
      "MCowBQYDK2VwAyEAVlMmhOdX1BaSji1HIKSKshdgAsJ+/bvxCu+xAl8p4KY=",
      "-----END PUBLIC KEY-----",
      "",
    ].join("\n"),
  }),
});
const E2E_MARKER_ARGUMENT = "--asr-update-e2e-marker=";
const E2E_FAIL_READY_ARGUMENT = "--asr-update-e2e-fail-ready";
const E2E_READY_DELAY_ARGUMENT = "--asr-update-e2e-ready-delay=750";

function readE2eInvocation(argumentsList) {
  const markerArguments = argumentsList.filter((argument) => argument.startsWith(E2E_MARKER_ARGUMENT));
  const failReadyArguments = argumentsList.filter((argument) => argument === E2E_FAIL_READY_ARGUMENT);
  if (markerArguments.length > 1 || failReadyArguments.length > 1) {
    return undefined;
  }
  const markerPath = markerArguments.length === 1
    ? path.resolve(markerArguments[0].slice(E2E_MARKER_ARGUMENT.length))
    : undefined;
  if (markerPath && path.basename(markerPath) !== "CLIENT_UPDATE_READY_AFTER_COORDINATOR_EXIT.txt") {
    return undefined;
  }
  return { markerPath, failReady: failReadyArguments.length === 1 };
}

function createClientEnvironment() {
  const environment = { ...process.env, ASR_CLIENT_UPDATE_E2E: "1" };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

async function runClientUpdateE2eCoordinator(argumentsList = process.argv.slice(2)) {
  const invocation = readE2eInvocation(argumentsList);
  if (!invocation) {
    return 30;
  }
  const candidateArguments = ["--asr-update-validation"];
  if (invocation.markerPath) {
    candidateArguments.push(`${E2E_MARKER_ARGUMENT}${invocation.markerPath}`);
    candidateArguments.push(E2E_READY_DELAY_ARGUMENT);
  }
  if (invocation.failReady) {
    candidateArguments.push(E2E_FAIL_READY_ARGUMENT);
  }
  return runCoordinator({
    argumentsList,
    stagePackage: async (packagePath, stagingDirectory, options) => {
      return stageVerifiedClientUpdate(packagePath, stagingDirectory, {
        ...options,
        trustedSigners: TEST_TRUSTED_SIGNERS,
      });
    },
    readyLaunch: (client, spawnFn) => launchCandidateForReady(client, spawnFn, {
      candidateArguments,
      childEnvironment: createClientEnvironment(),
    }),
  });
}

if (require.main === module) {
  runClientUpdateE2eCoordinator().then((exitCode) => {
    process.exit(exitCode);
  }).catch(() => {
    process.exitCode = 19;
  });
}

module.exports = {
  E2E_FAIL_READY_ARGUMENT,
  E2E_MARKER_ARGUMENT,
  E2E_READY_DELAY_ARGUMENT,
  TEST_KEY_ID,
  TEST_TRUSTED_SIGNERS,
  createClientEnvironment,
  readE2eInvocation,
  runClientUpdateE2eCoordinator,
};
