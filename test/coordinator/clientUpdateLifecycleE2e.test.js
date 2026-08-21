const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { copyFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { path7za } = require("7zip-bin");
const packageMetadata = require("../../package.json");
const { coordinatorClientUpdateE2eOutput } = require("../../scripts/buildCoordinatorClientUpdateE2e");
const { CoordinatorExitCode } = require("../../src/coordinator/main");
const { canonicalJson } = require("../../src/update/clientUpdatePackage");
const { publishInitialState, readLaunchInstallationState } = require("../../src/update/installationState");
const { cleanupOwnedWorkspace, getSentinelPath } = require("../packaging/fullSetupE2eCleanup");
const { TEST_KEY_ID, TEST_PRIVATE_KEY } = require("../update/testSigning");
const { E2E_FAIL_READY_ARGUMENT, E2E_MARKER_ARGUMENT } = require("./clientUpdateE2eCoordinator");

const projectRoot = path.resolve(__dirname, "../..");
const clientBundleDirectory = path.join(projectRoot, "dist", "win-unpacked");
const markerFileName = "CLIENT_UPDATE_READY_AFTER_COORDINATOR_EXIT.txt";

function archive(directory, outputPath, names) {
  return new Promise((resolve, reject) => {
    const child = spawn(path7za, ["a", "-tzip", "-mx=1", outputPath, ...names], {
      cwd: directory,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`7za exited with code ${code}.`)));
  });
}

function createChildEnvironment(workspace) {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR;
  const environment = {
    ...process.env,
    PATH: path.join(windowsDirectory, "System32"),
    SystemRoot: windowsDirectory,
    WINDIR: windowsDirectory,
    TEMP: path.join(workspace, "temp"),
    TMP: path.join(workspace, "temp"),
    APPDATA: path.join(workspace, "appdata"),
    LOCALAPPDATA: path.join(workspace, "localappdata"),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function runCoordinator(executablePath, argumentsList, workspace) {
  const environment = createChildEnvironment(workspace);
  assert.equal(Object.hasOwn(environment, "ELECTRON_RUN_AS_NODE"), false);
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, argumentsList, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function startCoordinator(executablePath, argumentsList, workspace) {
  const environment = createChildEnvironment(workspace);
  assert.equal(Object.hasOwn(environment, "ELECTRON_RUN_AS_NODE"), false);
  const child = spawn(executablePath, argumentsList, {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    child,
    result: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code, stdout, stderr }));
    }),
  };
}

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await check();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForMarker(markerPath) {
  return waitFor(async () => {
    try {
      return await readFile(markerPath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }, "the post-Coordinator Client marker");
}

async function createTinyRuntime(root) {
  const runtime = path.join(root, "Runtime");
  await Promise.all([
    mkdir(path.join(runtime, "python"), { recursive: true }),
    mkdir(path.join(runtime, "bin", "ffmpeg"), { recursive: true }),
    mkdir(path.join(runtime, "pipeline", "asr_pipeline"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(runtime, "runtime-manifest.json"), `${JSON.stringify({
      manifestFormatVersion: 1,
      runtimeId: "local-asr-runtime",
      runtimeVersion: "e2e-tiny",
      runtimeApiVersion: 1,
    })}\n`, "utf8"),
    writeFile(path.join(runtime, "python", "python.exe"), "tiny runtime", "utf8"),
    writeFile(path.join(runtime, "bin", "ffmpeg", "ffmpeg.exe"), "tiny runtime", "utf8"),
    writeFile(path.join(runtime, "pipeline", "config.json"), "{}\n", "utf8"),
    writeFile(path.join(runtime, "pipeline", "asr_pipeline", "cli.py"), "# tiny runtime\n", "utf8"),
  ]);
}

async function createSignedTestClientPackage(workspace) {
  const payloadSource = path.join(workspace, "test-payload");
  const payloadPath = path.join(workspace, "test-client.zip");
  await mkdir(path.join(payloadSource, "resources"), { recursive: true });
  await Promise.all([
    writeFile(path.join(payloadSource, `${packageMetadata.name}.exe`), "test payload executable", "utf8"),
    writeFile(path.join(payloadSource, "resources", "app.asar"), "test payload asar", "utf8"),
  ]);
  await archive(payloadSource, payloadPath, [`${packageMetadata.name}.exe`, "resources/app.asar"]);
  const payload = await readFile(payloadPath);
  const manifest = {
    formatVersion: 1,
    keyId: TEST_KEY_ID,
    client: { version: "0.2.0", runtimeApiVersion: 1 },
    payload: {
      file: "client.zip",
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
      bytes: payload.length,
    },
  };
  const packageDirectory = path.join(workspace, "package");
  const packagePath = path.join(workspace, "candidate.asrupdate");
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    copyFile(payloadPath, path.join(packageDirectory, "client.zip")),
    writeFile(path.join(packageDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(
      path.join(packageDirectory, "manifest.sig"),
      `${crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), TEST_PRIVATE_KEY).toString("base64")}\n`,
      "utf8",
    ),
  ]);
  await archive(packageDirectory, packagePath, ["manifest.json", "manifest.sig", "client.zip"]);
  return packagePath;
}

async function createInstallation(root, { knownGood = "packaged" } = {}) {
  const coordinatorDirectory = path.join(root, "Coordinator");
  const knownGoodDirectory = path.join(root, "Clients", "0.1.0");
  const coordinator = path.join(coordinatorDirectory, "asr-coordinator.exe");
  await Promise.all([
    mkdir(coordinatorDirectory, { recursive: true }),
    mkdir(path.join(root, "temp"), { recursive: true }),
    mkdir(path.join(root, "appdata"), { recursive: true }),
    mkdir(path.join(root, "localappdata"), { recursive: true }),
    createTinyRuntime(root),
  ]);
  await copyFile(coordinatorClientUpdateE2eOutput, coordinator);
  if (knownGood === "packaged") {
    await cp(clientBundleDirectory, knownGoodDirectory, { recursive: true });
  } else {
    await mkdir(knownGoodDirectory, { recursive: true });
    await copyFile(
      path.join(process.env.SystemRoot || process.env.WINDIR, "System32", "cmd.exe"),
      path.join(knownGoodDirectory, `${packageMetadata.name}.exe`),
    );
    await mkdir(path.join(knownGoodDirectory, "resources"), { recursive: true });
    await writeFile(path.join(knownGoodDirectory, "resources", "app.asar"), "test asar", "utf8");
  }
  await publishInitialState(root, "0.1.0");
  return { coordinator, knownGoodDirectory };
}

test("real SEA Client Update commits READY candidate and rolls back failed candidate with isolated test trust", { timeout: 240_000 }, async () => {
  const nonce = crypto.randomUUID();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "asr-full-setup-e2e-client-update-"));
  await writeFile(getSentinelPath(workspace), `${nonce}\n`, "utf8");
  try {
    console.log("[Client Update E2E] Building signed isolated test update");
    const packagePath = await createSignedTestClientPackage(workspace);

    console.log("[Client Update E2E] Preparing signed candidate through real SEA Coordinator");
    const successRoot = path.join(workspace, "success-installation");
    const success = await createInstallation(successRoot, { knownGood: "marker" });
    const prepare = await runCoordinator(success.coordinator, [
      "--asr-client-update=prepare",
      `--asr-update-package=${packagePath}`,
    ], workspace);
    assert.deepEqual(prepare, { code: CoordinatorExitCode.SUCCESS, stdout: "", stderr: "" });
    const prepared = (await readLaunchInstallationState(successRoot)).selected;
    assert.equal(prepared.schemaVersion, 2);
    assert.equal(prepared.updateTransaction.phase, "prepared");
    assert.equal(prepared.activeClient.version, "0.1.0");
    assert.equal(prepared.knownGoodClient.version, "0.1.0");
    assert.equal(prepared.updateTransaction.candidateClient.version, "0.2.0");
    const preparedSlotBytes = await Promise.all([
      readFile(path.join(successRoot, "InstallationState", "slot-a.json")),
      readFile(path.join(successRoot, "InstallationState", "slot-b.json")),
    ]);

    const candidateDirectory = path.join(successRoot, "Clients", "0.2.0");
    const continuedLifeMarker = path.join(candidateDirectory, markerFileName);
    console.log("[Client Update E2E] Materializing real packaged Electron candidate in prepared geometry");
    await rm(candidateDirectory, { recursive: true, force: true });
    await cp(clientBundleDirectory, candidateDirectory, { recursive: true });
    console.log("[Client Update E2E] Activating candidate and waiting for production READY");
    const activation = startCoordinator(success.coordinator, [
      "--asr-client-update=activate",
      `${E2E_MARKER_ARGUMENT}${continuedLifeMarker}`,
    ], workspace);
    await waitFor(async () => {
      const state = await readLaunchInstallationState(successRoot);
      return state.kind === "selected" && state.selected.updateTransaction?.phase === "activated"
        ? state.selected
        : undefined;
    }, "durable activated InstallationState");
    assert.deepEqual(await activation.result, { code: CoordinatorExitCode.SUCCESS, stdout: "", stderr: "" });
    const committed = (await readLaunchInstallationState(successRoot)).selected;
    assert.equal(committed.updateTransaction, null);
    assert.equal(committed.activeClient.version, "0.2.0");
    assert.equal(committed.knownGoodClient.version, "0.2.0");
    assert.equal(
      await waitForMarker(continuedLifeMarker),
      "Client remained alive after update Coordinator exit\r\n",
    );
    await new Promise((resolve) => setTimeout(resolve, 700));

    console.log("[Client Update E2E] Injecting failed READY from real packaged candidate");
    await Promise.all([
      writeFile(path.join(successRoot, "InstallationState", "slot-a.json"), preparedSlotBytes[0]),
      writeFile(path.join(successRoot, "InstallationState", "slot-b.json"), preparedSlotBytes[1]),
    ]);
    const failedActivation = await runCoordinator(success.coordinator, [
      "--asr-client-update=activate",
      E2E_FAIL_READY_ARGUMENT,
    ], workspace);
    assert.deepEqual(failedActivation, {
      code: CoordinatorExitCode.UPDATE_VALIDATION_FAILED,
      stdout: "",
      stderr: "",
    });
    const rolledBack = (await readLaunchInstallationState(successRoot)).selected;
    assert.equal(rolledBack.updateTransaction, null);
    assert.equal(rolledBack.activeClient.version, "0.1.0");
    assert.equal(rolledBack.knownGoodClient.version, "0.1.0");
    assert.deepEqual(
      await runCoordinator(success.coordinator, [], workspace),
      { code: CoordinatorExitCode.SUCCESS, stdout: "", stderr: "" },
    );

  } finally {
    await cleanupOwnedWorkspace({ workspace, nonce });
  }
});
