const assert = require("node:assert/strict");
const { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { coordinatorOutput } = require("../../scripts/buildCoordinator");
const { CoordinatorExitCode } = require("../../src/coordinator/main");

function runCoordinator(executablePath) {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR;
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      env: {
        PATH: path.join(windowsDirectory, "System32"),
        SystemRoot: windowsDirectory,
        WINDIR: windowsDirectory,
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
      },
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
  return JSON.stringify({
    schemaVersion: 1,
    generation: 1,
    activeClient: { version },
    knownGoodClient: { version },
  });
}

test("SEA coordinator reads shared state from installed geometry without Node in PATH", async () => {
  const outputInfo = await stat(coordinatorOutput);
  assert.equal(outputInfo.isFile(), true);

  const root = await mkdtemp(path.join(os.tmpdir(), "asr-coordinator-sea-"));
  try {
    const coordinatorDirectory = path.join(root, "Coordinator");
    const installedCoordinator = path.join(coordinatorDirectory, "asr-coordinator.exe");
    const stateDirectory = path.join(root, "InstallationState");
    const state = `${stateForVersion("0.1.0")}\n`;
    await mkdir(coordinatorDirectory, { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await copyFile(coordinatorOutput, installedCoordinator);
    await writeFile(path.join(stateDirectory, "slot-a.json"), state, "utf8");
    await writeFile(path.join(stateDirectory, "slot-b.json"), state, "utf8");
    const before = await Promise.all([
      readFile(path.join(stateDirectory, "slot-a.json"), "utf8"),
      readFile(path.join(stateDirectory, "slot-b.json"), "utf8"),
    ]);

    const result = await runCoordinator(installedCoordinator);
    assert.equal(result.code, CoordinatorExitCode.SELECTED_CLIENT_UNAVAILABLE);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await Promise.all([
      readFile(path.join(stateDirectory, "slot-a.json"), "utf8"),
      readFile(path.join(stateDirectory, "slot-b.json"), "utf8"),
    ]), before);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
