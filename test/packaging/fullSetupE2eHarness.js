const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { copyFile, mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildFullSetupE2e, createChildEnvironment } = require("../../scripts/buildFullSetupE2e");
const { cleanupOwnedWorkspace, getSentinelPath } = require("./fullSetupE2eCleanup");

const projectRoot = path.resolve(__dirname, "../..");
const productVersion = require(path.join(projectRoot, "package.json")).version;
const fakeClientSource = path.join(projectRoot, "test", "coordinator", "fakeClient.nsi");
const nsisCompiler = path.join(projectRoot, "build", "tool-cache", "nsis-3.0.4.1", "Bin", "makensis.exe");
const timeoutMs = 90_000;

function progress(message) {
  console.log(`[E2E] ${message}`);
}

function runChild(phase, executable, argumentsList, { cwd, env = createChildEnvironment() } = {}) {
  assert.equal(Object.hasOwn(env, "ELECTRON_RUN_AS_NODE"), false, `${phase} must not inherit ELECTRON_RUN_AS_NODE.`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${phase} timed out while waiting for ${path.basename(executable)}.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.trim() });
    });
  });
}

async function expectExit(phase, executable, argumentsList, options = {}) {
  const result = await runChild(phase, executable, argumentsList, options);
  assert.equal(result.code, 0, `${phase} failed with exit ${result.code}. ${result.output}`);
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}.`);
}

async function assertFile(filePath) {
  assert.equal((await stat(filePath)).isFile(), true, `${filePath} must be a regular file.`);
}

async function buildMarkerClient(outputPath) {
  await assertFile(nsisCompiler);
  await expectExit("Building marker Client", nsisCompiler, [
    "-V2",
    "-INPUTCHARSET",
    "UTF8",
    `-DOUTPUT_PATH=${outputPath}`,
    fakeClientSource,
  ], { cwd: projectRoot });
}

async function install(setupPath, root, phase) {
  await expectExit(phase, setupPath, ["/S", "/currentuser", `/D=${root}`], { cwd: path.dirname(setupPath) });
}

async function runServiceUninstall(uninstallerPath, clientDirectory, workspace, environment) {
  const temporaryUninstaller = path.join(workspace, "service-uninstaller.exe");
  await copyFile(uninstallerPath, temporaryUninstaller);
  await expectExit(
    "Service uninstall",
    temporaryUninstaller,
    ["/S", "/KEEP_APP_DATA", "/currentuser", "--updated", `_?=${clientDirectory}`],
    { cwd: workspace, env: environment },
  );
}

async function main() {
  const nonce = randomUUID();
  const workspace = await mkdtemp(path.join(os.tmpdir(), `asr-full-setup-e2e-${nonce}-`));
  const sentinelPath = getSentinelPath(workspace);
  const root = path.join(workspace, "install");
  const foreignCoordinatorFile = path.join(root, "Coordinator", "FOREIGN_E2E_RESIDUE.txt");
  await writeFile(sentinelPath, `${nonce}\n`, "utf8");

  try {
    const build = await buildFullSetupE2e({ workspaceDirectory: workspace, progress });
    const environment = createChildEnvironment();
    assert.equal(Object.hasOwn(environment, "ELECTRON_RUN_AS_NODE"), false, "E2E child environment must remove ELECTRON_RUN_AS_NODE.");

    progress("Clean install: starting");
    await install(build.setupPath, root, "Clean install");
    const clientDirectory = path.join(root, "Clients", productVersion);
    const clientExecutable = path.join(clientDirectory, "local-asr-prototype.exe");
    const launcherPath = path.join(root, "asr-launch.exe");
    const coordinatorPath = path.join(root, "Coordinator", "asr-coordinator.exe");
    const slotA = path.join(root, "InstallationState", "slot-a.json");
    const slotB = path.join(root, "InstallationState", "slot-b.json");
    await Promise.all([
      assertFile(clientExecutable),
      assertFile(path.join(root, "Runtime", "runtime-manifest.json")),
      assertFile(path.join(root, "Runtime", "E2E_RUNTIME_MARKER.txt")),
      assertFile(coordinatorPath),
      assertFile(launcherPath),
      assertFile(slotA),
      assertFile(slotB),
    ]);
    const [stateA, stateB] = await Promise.all([readFile(slotA, "utf8"), readFile(slotB, "utf8")]);
    assert.equal(stateA, stateB);
    assert.deepEqual(JSON.parse(stateA), {
      schemaVersion: 1,
      generation: 1,
      activeClient: { version: productVersion },
      knownGoodClient: { version: productVersion },
    });
    progress("Clean install: passed");

    progress("Installed launch: starting");
    await buildMarkerClient(path.join(workspace, "marker-client.exe"));
    await copyFile(path.join(workspace, "marker-client.exe"), clientExecutable);
    await expectExit("Installed launcher", launcherPath, [], { cwd: root, env: environment });
    assert.equal(await waitForFile(path.join(clientDirectory, "CLIENT_LAUNCHED.txt")), "selected Client launched\r\n");
    progress("Installed launch: passed");

    progress("Repair missing Coordinator: starting");
    await rm(coordinatorPath);
    await install(build.setupPath, root, "Repair missing Coordinator");
    await assertFile(coordinatorPath);
    progress("Repair missing Coordinator: passed");

    progress("Recover Coordinator previous/staging: starting");
    await copyFile(coordinatorPath, path.join(root, "Coordinator", "asr-coordinator.previous.exe"));
    await rm(coordinatorPath);
    await install(build.setupPath, root, "Recover Coordinator previous");
    await copyFile(coordinatorPath, path.join(root, "Coordinator", "asr-coordinator.staging.exe"));
    await rm(coordinatorPath);
    await install(build.setupPath, root, "Recover Coordinator staging");
    await assertFile(coordinatorPath);
    await assert.rejects(stat(path.join(root, "Coordinator", "asr-coordinator.previous.exe")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(root, "Coordinator", "asr-coordinator.staging.exe")), { code: "ENOENT" });
    progress("Recover Coordinator previous/staging: passed");

    const uninstallerPath = path.join(clientDirectory, "Uninstall local-asr-prototype.exe");
    progress("Service uninstall: starting");
    const stateBeforeServiceUninstall = await Promise.all([readFile(slotA), readFile(slotB)]);
    await runServiceUninstall(uninstallerPath, clientDirectory, workspace, environment);
    await Promise.all([
      assertFile(coordinatorPath),
      assertFile(launcherPath),
      assertFile(slotA),
      assertFile(slotB),
      assertFile(path.join(root, "Runtime", "runtime-manifest.json")),
    ]);
    assert.deepEqual(await Promise.all([readFile(slotA), readFile(slotB)]), stateBeforeServiceUninstall);
    await assert.rejects(stat(clientExecutable), { code: "ENOENT" });
    progress("Service uninstall: passed");

    progress("Repair after service uninstall: starting");
    await install(build.setupPath, root, "Repair after service uninstall");
    await assertFile(clientExecutable);
    progress("Repair after service uninstall: passed");

    progress("Normal uninstall: starting");
    await writeFile(foreignCoordinatorFile, "foreign residue\n", "utf8");
    await expectExit("Normal uninstall", uninstallerPath, ["/S", "/currentuser", `_?=${clientDirectory}`], { cwd: clientDirectory, env: environment });
    await Promise.all([
      assertFile(foreignCoordinatorFile),
      assert.rejects(stat(coordinatorPath), { code: "ENOENT" }),
      assert.rejects(stat(launcherPath), { code: "ENOENT" }),
      assert.rejects(stat(slotA), { code: "ENOENT" }),
      assert.rejects(stat(path.join(root, "Runtime", "runtime-manifest.json")), { code: "ENOENT" }),
      assert.rejects(stat(clientExecutable), { code: "ENOENT" }),
    ]);
    progress("Normal uninstall: passed");
  } finally {
    await cleanupOwnedWorkspace({ workspace, nonce });
    progress("Cleanup: passed");
  }
}

main().catch((error) => {
  console.error(`[E2E] FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
