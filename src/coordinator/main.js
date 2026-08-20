const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { assertSelectedClient, readInstallationState } = require("../update/installationState");

const COORDINATOR_EXECUTABLE = "asr-coordinator.exe";
const COORDINATOR_DIRECTORY = "Coordinator";
const CoordinatorExitCode = Object.freeze({
  SUCCESS: 0,
  INVALID_GEOMETRY: 10,
  STATE_ABSENT: 11,
  NO_RECOVERABLE_STATE: 12,
  UNSUPPORTED_STATE: 13,
  UNINSPECTABLE_STATE: 14,
  AMBIGUOUS_STATE: 15,
  SELECTED_CLIENT_UNAVAILABLE: 16,
  UNSAFE_SELECTED_CLIENT: 17,
  CLIENT_PROCESS_CREATION_FAILED: 18,
  UNEXPECTED_FAILURE: 19,
});

function isReparsePoint(info) {
  return info.isSymbolicLink();
}

function isDirectChild(parentPath, childPath, expectedName) {
  return path.dirname(childPath) === parentPath && path.basename(childPath) === expectedName;
}

async function deriveInstallationRoot(executablePath, { fsApi = fs } = {}) {
  const resolvedExecutablePath = path.resolve(executablePath);
  const coordinatorPath = path.dirname(resolvedExecutablePath);
  const installationRoot = path.dirname(coordinatorPath);
  if (path.basename(resolvedExecutablePath) !== COORDINATOR_EXECUTABLE
    || path.basename(coordinatorPath) !== COORDINATOR_DIRECTORY) {
    return undefined;
  }

  try {
    const [rootInfo, coordinatorInfo, executableInfo] = await Promise.all([
      fsApi.lstat(installationRoot),
      fsApi.lstat(coordinatorPath),
      fsApi.lstat(resolvedExecutablePath),
    ]);
    if (!rootInfo.isDirectory() || !coordinatorInfo.isDirectory() || !executableInfo.isFile()
      || isReparsePoint(rootInfo) || isReparsePoint(coordinatorInfo) || isReparsePoint(executableInfo)) {
      return undefined;
    }

    const [realRoot, realCoordinator, realExecutable] = await Promise.all([
      fsApi.realpath(installationRoot),
      fsApi.realpath(coordinatorPath),
      fsApi.realpath(resolvedExecutablePath),
    ]);
    if (!isDirectChild(realRoot, realCoordinator, COORDINATOR_DIRECTORY)
      || !isDirectChild(realCoordinator, realExecutable, COORDINATOR_EXECUTABLE)) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return installationRoot;
}

function isStateAbsent(stateResult) {
  return stateResult.kind === "no-valid-state"
    && !stateResult.stateDirectoryExists
    && stateResult.slots.every((slot) => slot.kind === "missing");
}

function stateResultExitCode(stateResult) {
  if (stateResult.kind === "selected") {
    return undefined;
  }
  if (stateResult.kind === "unsupported") {
    return CoordinatorExitCode.UNSUPPORTED_STATE;
  }
  if (stateResult.kind === "uninspectable") {
    return CoordinatorExitCode.UNINSPECTABLE_STATE;
  }
  if (stateResult.kind === "ambiguous") {
    return CoordinatorExitCode.AMBIGUOUS_STATE;
  }
  if (stateResult.kind === "no-valid-state") {
    return isStateAbsent(stateResult)
      ? CoordinatorExitCode.STATE_ABSENT
      : CoordinatorExitCode.NO_RECOVERABLE_STATE;
  }
  return CoordinatorExitCode.UNEXPECTED_FAILURE;
}

function launchClient(client, spawnFn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(client.executablePath, [], {
        cwd: client.clientPath,
        detached: false,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function clientErrorExitCode(error) {
  if (error && error.code === "SELECTED_CLIENT_UNAVAILABLE") {
    return CoordinatorExitCode.SELECTED_CLIENT_UNAVAILABLE;
  }
  if (error && error.code === "UNSAFE_SELECTED_CLIENT") {
    return CoordinatorExitCode.UNSAFE_SELECTED_CLIENT;
  }
  return undefined;
}

async function runCoordinator({
  executablePath = process.execPath,
  fsApi = fs,
  readState = readInstallationState,
  assertClient = assertSelectedClient,
  spawnFn = spawn,
} = {}) {
  const installationRoot = await deriveInstallationRoot(executablePath, { fsApi });
  if (!installationRoot) {
    return CoordinatorExitCode.INVALID_GEOMETRY;
  }

  let stateExitCode;
  let stateResult;
  try {
    stateResult = await readState(installationRoot, { fsApi });
    stateExitCode = stateResultExitCode(stateResult);
  } catch {
    return CoordinatorExitCode.UNEXPECTED_FAILURE;
  }
  if (stateExitCode !== undefined) {
    return stateExitCode;
  }

  let client;
  try {
    client = await assertClient(installationRoot, stateResult.selected, { fsApi });
  } catch (error) {
    return clientErrorExitCode(error) || CoordinatorExitCode.UNEXPECTED_FAILURE;
  }

  try {
    await launchClient(client, spawnFn);
    return CoordinatorExitCode.SUCCESS;
  } catch {
    return CoordinatorExitCode.CLIENT_PROCESS_CREATION_FAILED;
  }
}

if (require.main === module) {
  runCoordinator().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.exitCode = CoordinatorExitCode.UNEXPECTED_FAILURE;
  });
}

module.exports = {
  COORDINATOR_DIRECTORY,
  COORDINATOR_EXECUTABLE,
  CoordinatorExitCode,
  deriveInstallationRoot,
  runCoordinator,
};
