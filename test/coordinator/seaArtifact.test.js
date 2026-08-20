const assert = require("node:assert/strict");
const { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { coordinatorOutput } = require("../../scripts/buildCoordinator");
const { buildStableLauncher, getNsisCompiler, run } = require("../../scripts/buildStableLauncher");
const { CoordinatorExitCode } = require("../../src/coordinator/main");

const projectRoot = path.resolve(__dirname, "../..");
const fakeClientSource = path.join(__dirname, "fakeClient.nsi");

function readFinalArtifactSubsystem(executable) {
  assert.ok(executable.length >= 0x40);
  assert.equal(executable.toString("ascii", 0, 2), "MZ");

  const peHeaderOffset = executable.readUInt32LE(0x3c);
  assert.ok(peHeaderOffset <= executable.length - 24);
  assert.equal(executable.toString("ascii", peHeaderOffset, peHeaderOffset + 4), "PE\0\0");

  const coffHeaderOffset = peHeaderOffset + 4;
  const optionalHeaderSize = executable.readUInt16LE(coffHeaderOffset + 16);
  const optionalHeaderOffset = coffHeaderOffset + 20;
  assert.ok(optionalHeaderSize >= 70);
  assert.ok(optionalHeaderOffset <= executable.length - optionalHeaderSize);
  assert.equal(executable.readUInt16LE(optionalHeaderOffset), 0x20b);
  return executable.readUInt16LE(optionalHeaderOffset + 68);
}

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

async function buildFakeClient(outputPath) {
  const compilerPath = await getNsisCompiler();
  await run(compilerPath, [
    "-V2",
    "-INPUTCHARSET",
    "UTF8",
    `-DOUTPUT_PATH=${outputPath}`,
    fakeClientSource,
  ], { cwd: projectRoot });
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Selected Client did not create its launch marker.");
}

test("SEA coordinator reads shared state from installed geometry without Node in PATH", async () => {
  const outputInfo = await stat(coordinatorOutput);
  assert.equal(outputInfo.isFile(), true);
  assert.equal(readFinalArtifactSubsystem(await readFile(coordinatorOutput)), 2);

  const root = await mkdtemp(path.join(os.tmpdir(), "asr-coordinator-sea-"));
  try {
    const coordinatorDirectory = path.join(root, "Coordinator");
    const installedCoordinator = path.join(coordinatorDirectory, "asr-coordinator.exe");
    const installedLauncher = path.join(root, "asr-launch.exe");
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
    await buildStableLauncher({ outputPath: installedLauncher, testMode: true });
    assert.equal((await runCoordinator(installedLauncher)).code, CoordinatorExitCode.SELECTED_CLIENT_UNAVAILABLE);
    assert.deepEqual(await Promise.all([
      readFile(path.join(stateDirectory, "slot-a.json"), "utf8"),
      readFile(path.join(stateDirectory, "slot-b.json"), "utf8"),
    ]), before);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("SEA coordinator launches only the selected normal Windows Client without Node in PATH", async () => {
  const outputInfo = await stat(coordinatorOutput);
  assert.equal(outputInfo.isFile(), true);

  const root = await mkdtemp(path.join(os.tmpdir(), "asr-coordinator-sea-"));
  try {
    const coordinatorDirectory = path.join(root, "Coordinator");
    const installedCoordinator = path.join(coordinatorDirectory, "asr-coordinator.exe");
    const installedLauncher = path.join(root, "asr-launch.exe");
    const stateDirectory = path.join(root, "InstallationState");
    const selectedClientDirectory = path.join(root, "Clients", "0.2.0");
    const selectedClientExecutable = path.join(selectedClientDirectory, "local-asr-prototype.exe");
    const selectedMarker = path.join(selectedClientDirectory, "CLIENT_LAUNCHED.txt");
    const state = `${stateForVersion("0.2.0")}\n`;
    await Promise.all([
      mkdir(coordinatorDirectory, { recursive: true }),
      mkdir(stateDirectory, { recursive: true }),
      mkdir(path.join(root, "Clients", "0.1.0"), { recursive: true }),
      mkdir(selectedClientDirectory, { recursive: true }),
    ]);
    await copyFile(coordinatorOutput, installedCoordinator);
    await buildFakeClient(selectedClientExecutable);
    await writeFile(path.join(stateDirectory, "slot-a.json"), state, "utf8");
    await writeFile(path.join(stateDirectory, "slot-b.json"), state, "utf8");
    const before = await Promise.all([
      readFile(path.join(stateDirectory, "slot-a.json"), "utf8"),
      readFile(path.join(stateDirectory, "slot-b.json"), "utf8"),
    ]);

    const result = await runCoordinator(installedCoordinator);
    assert.equal(result.code, CoordinatorExitCode.SUCCESS);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(await waitForMarker(selectedMarker), "selected Client launched\r\n");
    await rm(selectedMarker);
    await buildStableLauncher({ outputPath: installedLauncher, testMode: true });
    assert.equal((await runCoordinator(installedLauncher)).code, CoordinatorExitCode.SUCCESS);
    assert.equal(await waitForMarker(selectedMarker), "selected Client launched\r\n");
    await assert.rejects(readFile(path.join(root, "Clients", "0.1.0", "CLIENT_LAUNCHED.txt"), "utf8"), {
      code: "ENOENT",
    });
    assert.deepEqual(await Promise.all([
      readFile(path.join(stateDirectory, "slot-a.json"), "utf8"),
      readFile(path.join(stateDirectory, "slot-b.json"), "utf8"),
    ]), before);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
