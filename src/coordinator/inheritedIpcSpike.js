const { randomBytes, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { assertSelectedClient, readLaunchInstallationState } = require("../update/installationState");
const { CoordinatorExitCode, deriveInstallationRoot } = require("./main");

const PROTOCOL_VERSION = 1;
const IPC_SPIKE_TIMEOUT_MS = 1_000;
const IPC_DISCONNECT_GRACE_MS = 200;
const CLIENT_BEHAVIOR_ARGUMENT = "--asr-ipc-spike-client-behavior=";
const CLIENT_BEHAVIORS = new Set([
  "valid",
  "malformed-ready",
  "wrong-token",
  "wrong-attempt",
  "exit-before-ready",
  "disconnect-no-ready",
  "no-ready",
]);
const IpcSpikeExitCode = Object.freeze({
  SUCCESS: 0,
  INVALID_ARGUMENT: 30,
  CLIENT_PROCESS_CREATION_FAILED: 31,
  INVALID_READY: 32,
  CLIENT_EXITED_BEFORE_READY: 33,
  CLIENT_DISCONNECTED_BEFORE_READY: 34,
  READY_TIMEOUT: 35,
});

function hasOnlyKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && actualKeys.every((key) => expectedKeys.includes(key));
}

function parseClientBehavior(argumentsList) {
  const behaviorArguments = argumentsList.filter((argument) => argument.startsWith(CLIENT_BEHAVIOR_ARGUMENT));
  if (behaviorArguments.length !== 1) {
    return undefined;
  }

  const behavior = behaviorArguments[0].slice(CLIENT_BEHAVIOR_ARGUMENT.length);
  return CLIENT_BEHAVIORS.has(behavior) ? behavior : undefined;
}

function isMatchingReady(message, { attemptId, token }) {
  return Boolean(message)
    && typeof message === "object"
    && !Array.isArray(message)
    && hasOnlyKeys(message, ["type", "protocolVersion", "attemptId", "token"])
    && message.type === "asr-ipc-spike-ready"
    && message.protocolVersion === PROTOCOL_VERSION
    && message.attemptId === attemptId
    && message.token === token;
}

function detachAndDisconnect(child) {
  child.unref();
  if (child.connected) {
    try {
      child.disconnect();
    } catch {
      // The child may have closed the IPC channel concurrently.
    }
  }
}

function waitForReady(client, behavior, { spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const attemptId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    let child;
    let timeout;
    let disconnectGrace;
    let settled = false;

    const onError = () => finish(IpcSpikeExitCode.CLIENT_PROCESS_CREATION_FAILED);
    const onExit = () => finish(IpcSpikeExitCode.CLIENT_EXITED_BEFORE_READY);
    const onDisconnect = () => {
      disconnectGrace = setTimeout(
        () => finish(IpcSpikeExitCode.CLIENT_DISCONNECTED_BEFORE_READY),
        IPC_DISCONNECT_GRACE_MS,
      );
    };
    const onMessage = (message) => {
      finish(isMatchingReady(message, { attemptId, token })
        ? IpcSpikeExitCode.SUCCESS
        : IpcSpikeExitCode.INVALID_READY);
    };
    const onSpawn = () => {
      timeout = setTimeout(() => finish(IpcSpikeExitCode.READY_TIMEOUT), IPC_SPIKE_TIMEOUT_MS);
      child.send({
        type: "asr-ipc-spike-init",
        protocolVersion: PROTOCOL_VERSION,
        attemptId,
        token,
      }, (error) => {
        if (error) {
          finish(IpcSpikeExitCode.CLIENT_DISCONNECTED_BEFORE_READY);
        }
      });
    };

    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTimeout(disconnectGrace);
      if (child) {
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        child.removeListener("disconnect", onDisconnect);
        child.removeListener("message", onMessage);
        child.removeListener("spawn", onSpawn);
        detachAndDisconnect(child);
      }
      resolve(exitCode);
    };

    try {
      child = spawnFn(client.executablePath, [`${CLIENT_BEHAVIOR_ARGUMENT}${behavior}`], {
        cwd: client.clientPath,
        detached: true,
        shell: false,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
    } catch {
      finish(IpcSpikeExitCode.CLIENT_PROCESS_CREATION_FAILED);
      return;
    }

    child.once("error", onError);
    child.once("exit", onExit);
    child.once("disconnect", onDisconnect);
    child.on("message", onMessage);
    child.once("spawn", onSpawn);
  });
}

async function runInheritedIpcSpike({
  executablePath = process.execPath,
  argumentsList = process.argv,
  readState = readLaunchInstallationState,
  assertClient = assertSelectedClient,
  spawnFn = spawn,
} = {}) {
  const behavior = parseClientBehavior(argumentsList);
  if (!behavior) {
    return IpcSpikeExitCode.INVALID_ARGUMENT;
  }

  const installationRoot = await deriveInstallationRoot(executablePath);
  if (!installationRoot) {
    return CoordinatorExitCode.INVALID_GEOMETRY;
  }

  const stateResult = await readState(installationRoot);
  if (stateResult.kind !== "selected") {
    return CoordinatorExitCode.NO_RECOVERABLE_STATE;
  }

  let client;
  try {
    client = await assertClient(installationRoot, stateResult.selected);
  } catch (error) {
    return error && error.code === "SELECTED_CLIENT_UNAVAILABLE"
      ? CoordinatorExitCode.SELECTED_CLIENT_UNAVAILABLE
      : CoordinatorExitCode.UNSAFE_SELECTED_CLIENT;
  }
  return waitForReady(client, behavior, { spawnFn });
}

if (require.main === module) {
  runInheritedIpcSpike().then((exitCode) => {
    process.exit(exitCode);
  }).catch(() => {
    process.exit(IpcSpikeExitCode.CLIENT_PROCESS_CREATION_FAILED);
  });
}

module.exports = {
  CLIENT_BEHAVIOR_ARGUMENT,
  CLIENT_BEHAVIORS,
  IPC_SPIKE_TIMEOUT_MS,
  IPC_DISCONNECT_GRACE_MS,
  IpcSpikeExitCode,
  PROTOCOL_VERSION,
  isMatchingReady,
  parseClientBehavior,
  runInheritedIpcSpike,
};
