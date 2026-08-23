const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const {
  activatePreparedClientUpdate,
  assertClientReference,
  assertSelectedClient,
  cancelPreparedClientUpdate,
  commitActivatedClientUpdate,
  prepareClientUpdate,
  readLaunchInstallationState,
  rollbackActivatedClientUpdate,
} = require("../update/installationState");
const { stageVerifiedClientUpdate } = require("../update/clientUpdatePackage");
const { getRuntimePaths, validateRuntime } = require("../runtime/resolveRuntime");
const { cleanupObsoleteClientDirectories } = require("./clientRetention");

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
  INVALID_UPDATE_REQUEST: 30,
  UPDATE_PREPARATION_FAILED: 31,
  UPDATE_VALIDATION_FAILED: 32,
  UPDATE_ROLLBACK_FAILED: 33,
});
const UPDATE_COMMAND_ARGUMENT = "--asr-client-update=";
const UPDATE_PACKAGE_ARGUMENT = "--asr-update-package=";
const READY_PROTOCOL_VERSION = 1;
const READY_TIMEOUT_MS = 45_000;

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
        detached: true,
        shell: false,
        stdio: "ignore",
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

function parseUpdateCommand(argumentsList) {
  const commands = argumentsList.filter((argument) => argument.startsWith(UPDATE_COMMAND_ARGUMENT));
  const packages = argumentsList.filter((argument) => argument.startsWith(UPDATE_PACKAGE_ARGUMENT));
  if (commands.length === 0 && packages.length === 0) {
    return null;
  }
  if (commands.length !== 1 || packages.length > 1) {
    return { kind: "invalid" };
  }
  const command = commands[0].slice(UPDATE_COMMAND_ARGUMENT.length);
  if (!["prepare", "activate", "cancel"].includes(command)) {
    return { kind: "invalid" };
  }
  if ((command === "prepare") !== (packages.length === 1)) {
    return { kind: "invalid" };
  }
  return {
    kind: command,
    packagePath: packages.length === 1 ? packages[0].slice(UPDATE_PACKAGE_ARGUMENT.length) : undefined,
  };
}

function isContained(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function prepareCandidateDirectory(installationRoot, packagePath, {
  fsApi = fs,
  stagePackage = stageVerifiedClientUpdate,
  assertClient = assertClientReference,
  expectedRuntimeApiVersion,
  id = randomUUID(),
} = {}) {
  const clientsDirectory = path.join(installationRoot, "Clients");
  let clientsInfo;
  try {
    clientsInfo = await fsApi.lstat(clientsDirectory);
  } catch {
    throw new Error("Client directory cannot be safely inspected.");
  }
  if (!clientsInfo.isDirectory() || clientsInfo.isSymbolicLink()) {
    throw new Error("Client directory has an unsafe filesystem type.");
  }
  const stagingDirectory = path.join(clientsDirectory, `.asr-update-${id}`);
  let staged;
  let candidateDirectory;
  try {
    staged = await stagePackage(packagePath, stagingDirectory, { fsApi });
    if (staged.manifest.client.runtimeApiVersion !== expectedRuntimeApiVersion) {
      throw new Error("Candidate Client requires an incompatible Runtime API.");
    }
    const candidateVersion = staged.manifest.client.version;
    candidateDirectory = path.join(clientsDirectory, candidateVersion);
    const candidateInfo = await fsApi.lstat(candidateDirectory).catch((error) => error && error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (candidateInfo) {
      throw new Error("Candidate Client version is already present.");
    }
    const [realRoot, realClients] = await Promise.all([fsApi.realpath(installationRoot), fsApi.realpath(clientsDirectory)]);
    if (!isContained(realRoot, realClients)) {
      throw new Error("Client directory escapes the installation root.");
    }
    await fsApi.rename(staged.clientDirectory, candidateDirectory);
    await assertClient(installationRoot, { version: candidateVersion }, { fsApi });
    await fsApi.rm(stagingDirectory, { recursive: true, force: true });
    return { manifest: staged.manifest, candidateDirectory };
  } catch (error) {
    const stagingInfo = await fsApi.lstat(stagingDirectory).catch(() => undefined);
    if (stagingInfo && stagingInfo.isDirectory() && !stagingInfo.isSymbolicLink()) {
      await fsApi.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}

function launchCandidateForReady(client, spawnFn, {
  timeoutMs = READY_TIMEOUT_MS,
  attemptId = randomUUID(),
  token = randomBytes(32).toString("base64url"),
  candidateArguments = ["--asr-update-validation"],
  childEnvironment,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let child;
    const complete = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child?.removeListener("error", onError);
      child?.removeListener("exit", onExit);
      child?.removeListener("disconnect", onDisconnect);
      child?.removeListener("message", onMessage);
      if (error) {
        reject(error);
      } else {
        resolve(child);
      }
    };
    const onError = () => complete(new Error("Candidate Client process creation failed."));
    const onExit = () => complete(new Error("Candidate Client exited before READY."));
    const onDisconnect = () => complete(new Error("Candidate Client disconnected before READY."));
    const onMessage = (message) => {
      const valid = message && typeof message === "object" && !Array.isArray(message)
        && Object.keys(message).length === 4
        && message.type === "asr-update-ready"
        && message.protocolVersion === READY_PROTOCOL_VERSION
        && message.attemptId === attemptId
        && message.token === token;
      if (!valid) {
        complete(new Error("Candidate Client sent an invalid READY message."));
        return;
      }
      complete();
    };
    try {
      child = spawnFn(client.executablePath, candidateArguments, {
        cwd: client.clientPath,
        detached: true,
        shell: false,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        ...(childEnvironment ? { env: childEnvironment } : {}),
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("disconnect", onDisconnect);
    child.on("message", onMessage);
    child.once("spawn", () => {
      timer = setTimeout(() => complete(new Error("Candidate Client did not reach READY in time.")), timeoutMs);
      child.send({ type: "asr-update-init", protocolVersion: READY_PROTOCOL_VERSION, attemptId, token }, (error) => {
        if (error) {
          complete(new Error("Candidate Client IPC initialization failed."));
        }
      });
    });
  });
}

function sendCandidateControlMessage(child, message) {
  if (!child?.connected || typeof child.send !== "function") {
    return;
  }
  try {
    child.send(message, () => {});
  } catch {
    // The state is already durable when this is used after commit. A lost
    // notification must not turn a completed update back into a rollback.
  }
}

function disconnectCandidate(child) {
  if (!child?.connected || typeof child.disconnect !== "function") {
    return;
  }
  try {
    child.disconnect();
  } catch {
    // The child may exit between the connected check and disconnect().
  }
}

async function launchKnownGoodAfterFailure(installationRoot, state, dependencies) {
  const client = await dependencies.assertClient(installationRoot, {
    ...state,
    activeClient: state.knownGoodClient,
    knownGoodClient: state.knownGoodClient,
  }, { fsApi: dependencies.fsApi });
  await launchClient(client, dependencies.spawnFn);
}

async function runCoordinator({
  executablePath = process.execPath,
  argumentsList = process.argv.slice(2),
  fsApi = fs,
  readState = readLaunchInstallationState,
  assertClient = assertSelectedClient,
  spawnFn = spawn,
  stagePackage = stageVerifiedClientUpdate,
  prepareUpdate = prepareClientUpdate,
  activateUpdate = activatePreparedClientUpdate,
  cancelUpdate = cancelPreparedClientUpdate,
  commitUpdate = commitActivatedClientUpdate,
  rollbackUpdate = rollbackActivatedClientUpdate,
  cleanupClients = cleanupObsoleteClientDirectories,
  getRuntime = getRuntimePaths,
  validateCurrentRuntime = validateRuntime,
  readyLaunch = launchCandidateForReady,
} = {}) {
  const installationRoot = await deriveInstallationRoot(executablePath, { fsApi });
  if (!installationRoot) {
    return CoordinatorExitCode.INVALID_GEOMETRY;
  }

  const updateCommand = parseUpdateCommand(argumentsList);
  if (updateCommand?.kind === "invalid") {
    return CoordinatorExitCode.INVALID_UPDATE_REQUEST;
  }

  const dependencies = { fsApi, assertClient, spawnFn };
  if (updateCommand?.kind === "prepare") {
    try {
      const currentState = await readState(installationRoot, { fsApi });
      if (stateResultExitCode(currentState) !== undefined
        || (currentState.selected.schemaVersion === 2 && currentState.selected.updateTransaction !== null)) {
        return CoordinatorExitCode.UPDATE_PREPARATION_FAILED;
      }
      await assertClient(installationRoot, currentState.selected, { fsApi });
      const runtime = await validateCurrentRuntime(getRuntime({ isPackaged: true, installationRoot }));
      const preparedCandidate = await prepareCandidateDirectory(installationRoot, updateCommand.packagePath, {
        fsApi,
        stagePackage,
        assertClient: assertClientReference,
        expectedRuntimeApiVersion: runtime.manifest.runtimeApiVersion,
      });
      await prepareUpdate(installationRoot, { version: preparedCandidate.manifest.client.version }, { fsApi });
      return CoordinatorExitCode.SUCCESS;
    } catch {
      return CoordinatorExitCode.UPDATE_PREPARATION_FAILED;
    }
  }
  if (updateCommand?.kind === "cancel") {
    try {
      await cancelUpdate(installationRoot, { fsApi });
      return CoordinatorExitCode.SUCCESS;
    } catch {
      return CoordinatorExitCode.INVALID_UPDATE_REQUEST;
    }
  }
  if (updateCommand?.kind === "activate") {
    let candidateChild;
    try {
      const activatedState = await activateUpdate(installationRoot, { fsApi });
      const candidate = await assertClient(installationRoot, activatedState, { fsApi });
      candidateChild = await readyLaunch(candidate, spawnFn);
      const committedState = await commitUpdate(installationRoot, { fsApi });
      await cleanupClients(installationRoot, committedState, { fsApi }).catch(() => {});
      sendCandidateControlMessage(candidateChild, { type: "asr-update-committed", protocolVersion: READY_PROTOCOL_VERSION });
      disconnectCandidate(candidateChild);
      candidateChild.unref();
      return CoordinatorExitCode.SUCCESS;
    } catch {
      sendCandidateControlMessage(candidateChild, { type: "asr-update-aborted", protocolVersion: READY_PROTOCOL_VERSION });
      disconnectCandidate(candidateChild);
      try {
        const rolledBack = await rollbackUpdate(installationRoot, { fsApi });
        await launchKnownGoodAfterFailure(installationRoot, rolledBack, dependencies);
      } catch {
        return CoordinatorExitCode.UPDATE_ROLLBACK_FAILED;
      }
      return CoordinatorExitCode.UPDATE_VALIDATION_FAILED;
    }
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

  if (stateResult.selected.schemaVersion === 2 && stateResult.selected.updateTransaction?.phase === "activated") {
    try {
      await rollbackUpdate(installationRoot, { fsApi });
      stateResult = await readState(installationRoot, { fsApi });
      stateExitCode = stateResultExitCode(stateResult);
    } catch {
      return CoordinatorExitCode.UPDATE_ROLLBACK_FAILED;
    }
    if (stateExitCode !== undefined) {
      return stateExitCode;
    }
  }

  await cleanupClients(installationRoot, stateResult.selected, { fsApi }).catch(() => {});

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
  launchCandidateForReady,
  parseUpdateCommand,
  runCoordinator,
};
