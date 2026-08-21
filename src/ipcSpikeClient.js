const path = require("node:path");
const { rename, writeFile } = require("node:fs/promises");

const PROTOCOL_VERSION = 1;
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
const CONTINUED_LIFE_MARKER = "CLIENT_AFTER_COORDINATOR_EXIT.txt";

function parseClientBehavior(argumentsList) {
  const behaviorArguments = argumentsList.filter((argument) => argument.startsWith(CLIENT_BEHAVIOR_ARGUMENT));
  if (behaviorArguments.length !== 1) {
    return undefined;
  }

  const behavior = behaviorArguments[0].slice(CLIENT_BEHAVIOR_ARGUMENT.length);
  return CLIENT_BEHAVIORS.has(behavior) ? behavior : undefined;
}

function isValidInit(message) {
  const expectedKeys = ["type", "protocolVersion", "attemptId", "token"];
  return Boolean(message)
    && typeof message === "object"
    && !Array.isArray(message)
    && Object.keys(message).length === expectedKeys.length
    && Object.keys(message).every((key) => expectedKeys.includes(key))
    && message.type === "asr-ipc-spike-init"
    && message.protocolVersion === PROTOCOL_VERSION
    && typeof message.attemptId === "string"
    && typeof message.token === "string"
    && message.token.length >= 32;
}

function runIpcSpikeClient({ app, argumentsList = process.argv } = {}) {
  const behavior = parseClientBehavior(argumentsList);
  if (!behavior || typeof process.send !== "function") {
    app.exit(70);
    return;
  }

  const missingInitTimeout = setTimeout(() => app.exit(71), 5_000);
  missingInitTimeout.unref();
  process.once("message", async (message) => {
    clearTimeout(missingInitTimeout);
    if (!isValidInit(message)) {
      app.exit(72);
      return;
    }

    if (behavior === "exit-before-ready") {
      app.exit(0);
      return;
    }
    if (behavior === "disconnect-no-ready") {
      process.disconnect();
      setTimeout(() => app.exit(0), 500);
      return;
    }
    const keepAlive = setInterval(() => {}, 1_000);
    const exitAfterDisconnect = () => {
      clearInterval(keepAlive);
      app.exit(0);
    };
    if (behavior === "no-ready") {
      process.once("disconnect", exitAfterDisconnect);
      return;
    }

    await app.whenReady();
    if (behavior === "valid") {
      process.once("disconnect", () => {
        clearInterval(keepAlive);
        setTimeout(async () => {
          const markerPath = path.join(path.dirname(process.execPath), CONTINUED_LIFE_MARKER);
          await writeFile(
            `${markerPath}.tmp`,
            "Electron Client remained alive after Coordinator exit\r\n",
            "utf8",
          );
          await rename(`${markerPath}.tmp`, markerPath);
          app.exit(0);
        }, 150);
      });
    } else {
      process.once("disconnect", exitAfterDisconnect);
    }

    process.send(behavior === "malformed-ready" ? {
      type: "asr-ipc-spike-ready",
    } : {
      type: "asr-ipc-spike-ready",
      protocolVersion: PROTOCOL_VERSION,
      attemptId: behavior === "wrong-attempt" ? `${message.attemptId}-wrong` : message.attemptId,
      token: behavior === "wrong-token" ? `${message.token}-wrong` : message.token,
    });
  });
}

module.exports = {
  CLIENT_BEHAVIOR_ARGUMENT,
  CLIENT_BEHAVIORS,
  CONTINUED_LIFE_MARKER,
  isValidInit,
  parseClientBehavior,
  runIpcSpikeClient,
};
