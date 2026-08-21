const assert = require("node:assert/strict");
const { copyFile, cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const packageMetadata = require("../../package.json");
const {
  CLIENT_BEHAVIOR_ARGUMENT,
  IpcSpikeExitCode,
} = require("../../src/coordinator/inheritedIpcSpike");
const { CONTINUED_LIFE_MARKER } = require("../../src/ipcSpikeClient");
const { coordinatorIpcSpikeOutput } = require("../../scripts/buildCoordinatorIpcSpike");

const projectRoot = path.resolve(__dirname, "../..");
const clientBundleDirectory = path.join(projectRoot, "dist", "win-unpacked");

function createChildEnvironment() {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR;
  const environment = {
    ...process.env,
    PATH: path.join(windowsDirectory, "System32"),
    SystemRoot: windowsDirectory,
    WINDIR: windowsDirectory,
    TEMP: os.tmpdir(),
    TMP: os.tmpdir(),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function runIpcSpike(executablePath, behavior) {
  const environment = createChildEnvironment();
  assert.equal(Object.hasOwn(environment, "ELECTRON_RUN_AS_NODE"), false);
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [`${CLIENT_BEHAVIOR_ARGUMENT}${behavior}`], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function stateForVersion(version) {
  return `${JSON.stringify({
    schemaVersion: 1,
    generation: 1,
    activeClient: { version },
    knownGoodClient: { version },
  })}\n`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForMarker(markerPath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(markerPath, "utf8");
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }
    await wait(50);
  }
  throw new Error("Electron Client did not prove continued life after Coordinator exit.");
}

async function createInstalledSpike() {
  const root = await mkdtemp(path.join(os.tmpdir(), "asr-coordinator-ipc-spike-"));
  const coordinatorDirectory = path.join(root, "Coordinator");
  const stateDirectory = path.join(root, "InstallationState");
  const clientDirectory = path.join(root, "Clients", packageMetadata.version);
  const installedCoordinator = path.join(coordinatorDirectory, "asr-coordinator.exe");
  const clientExecutable = path.join(clientDirectory, `${packageMetadata.name}.exe`);
  const markerPath = path.join(clientDirectory, CONTINUED_LIFE_MARKER);
  const state = stateForVersion(packageMetadata.version);

  await Promise.all([
    mkdir(coordinatorDirectory, { recursive: true }),
    mkdir(stateDirectory, { recursive: true }),
  ]);
  await copyFile(coordinatorIpcSpikeOutput, installedCoordinator);
  await cp(clientBundleDirectory, clientDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(stateDirectory, "slot-a.json"), state, "utf8"),
    writeFile(path.join(stateDirectory, "slot-b.json"), state, "utf8"),
  ]);
  assert.equal((await stat(clientExecutable)).isFile(), true);
  return { root, installedCoordinator, markerPath };
}

test("SEA Coordinator and packaged Electron Client exchange inherited IPC without affecting normal launch", async () => {
  const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  const installed = await createInstalledSpike();
  try {
    const valid = await runIpcSpike(installed.installedCoordinator, "valid");
    assert.deepEqual(valid, { code: IpcSpikeExitCode.SUCCESS, stdout: "", stderr: "" });
    assert.equal(
      await waitForMarker(installed.markerPath),
      "Electron Client remained alive after Coordinator exit\r\n",
    );
    await rm(installed.markerPath);

    for (const [behavior, exitCode] of [
      ["malformed-ready", IpcSpikeExitCode.INVALID_READY],
      ["wrong-token", IpcSpikeExitCode.INVALID_READY],
      ["wrong-attempt", IpcSpikeExitCode.INVALID_READY],
      ["exit-before-ready", IpcSpikeExitCode.CLIENT_EXITED_BEFORE_READY],
      ["disconnect-no-ready", IpcSpikeExitCode.CLIENT_DISCONNECTED_BEFORE_READY],
      ["no-ready", IpcSpikeExitCode.READY_TIMEOUT],
    ]) {
      const result = await runIpcSpike(installed.installedCoordinator, behavior);
      assert.deepEqual(result, { code: exitCode, stdout: "", stderr: "" }, behavior);
      await wait(behavior === "disconnect-no-ready" ? 600 : 200);
      await assert.rejects(readFile(installed.markerPath, "utf8"), { code: "ENOENT" });
    }
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, originalElectronRunAsNode);
  } finally {
    await rm(installed.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
