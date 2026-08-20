const assert = require("node:assert/strict");
const { mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const {
  buildStableLauncher,
  getNsisCompiler,
  launcherSource,
  run,
} = require("../../scripts/buildStableLauncher");

const projectRoot = path.resolve(__dirname, "../..");
const fakeCoordinatorSource = path.join(__dirname, "fakeCoordinator.nsi");

function runLauncher(launcherPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(launcherPath, [], { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function withLauncher(callback) {
  const root = await mkdtemp(path.join(projectRoot, "build", "launcher-test-"));
  try {
    const launcherPath = path.join(root, "asr-launch.exe");
    const coordinatorDirectory = path.join(root, "Coordinator");
    const coordinatorPath = path.join(coordinatorDirectory, "asr-coordinator.exe");
    await buildStableLauncher({ outputPath: launcherPath, testMode: true });
    await mkdir(coordinatorDirectory, { recursive: true });
    await buildFakeCoordinator(coordinatorPath);
    await callback({ coordinatorDirectory, coordinatorPath, launcherPath, root });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function buildFakeCoordinator(outputPath) {
  const compilerPath = await getNsisCompiler();
  await run(compilerPath, [
    "-V2",
    "-INPUTCHARSET",
    "UTF8",
    `-DOUTPUT_PATH=${outputPath}`,
    fakeCoordinatorSource,
  ], { cwd: projectRoot });
}

async function setFakeCoordinatorExitCode(coordinatorDirectory, exitCode) {
  await writeFile(
    path.join(coordinatorDirectory, "fake-coordinator.ini"),
    `[FakeCoordinator]\nExitCode=${exitCode}\n`,
    "utf8",
  );
}

test("stable launcher rejects a missing Coordinator executable", async () => {
  await withLauncher(async ({ coordinatorPath, launcherPath }) => {
    await rm(coordinatorPath);
    assert.equal(await runLauncher(launcherPath), 20);
  });
});

test("stable launcher rejects a missing Coordinator directory", async () => {
  await withLauncher(async ({ coordinatorDirectory, launcherPath }) => {
    await rm(coordinatorDirectory, { recursive: true, force: true });
    assert.equal(await runLauncher(launcherPath), 20);
  });
});

test("stable launcher rejects a reparse Coordinator directory", async () => {
  await withLauncher(async ({ coordinatorDirectory, launcherPath, root }) => {
    const coordinatorTarget = path.join(root, "Coordinator-target");
    await rm(coordinatorDirectory, { recursive: true, force: true });
    await mkdir(coordinatorTarget);
    await symlink(coordinatorTarget, coordinatorDirectory, "junction");

    assert.equal(await runLauncher(launcherPath), 21);
  });
});

test("stable launcher rejects a file in place of Coordinator directory", async () => {
  await withLauncher(async ({ coordinatorDirectory, launcherPath }) => {
    await rm(coordinatorDirectory, { recursive: true, force: true });
    await writeFile(coordinatorDirectory, "not a directory", "utf8");
    assert.equal(await runLauncher(launcherPath), 21);
  });
});

test("stable launcher rejects a directory in place of Coordinator executable", async () => {
  await withLauncher(async ({ coordinatorPath, launcherPath }) => {
    await rm(coordinatorPath);
    await mkdir(coordinatorPath);
    assert.equal(await runLauncher(launcherPath), 21);
  });
});

test("stable launcher reports Coordinator process creation failure", async () => {
  await withLauncher(async ({ coordinatorPath, launcherPath }) => {
    await rm(coordinatorPath);
    await writeFile(coordinatorPath, "not an executable", "utf8");
    assert.equal(await runLauncher(launcherPath), 22);
  });
});

test("stable launcher preserves known Coordinator exit codes and maps unknown results", async () => {
  await withLauncher(async ({ coordinatorDirectory, launcherPath }) => {
    for (const exitCode of [0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
      await setFakeCoordinatorExitCode(coordinatorDirectory, exitCode);
      assert.equal(await runLauncher(launcherPath), exitCode);
    }

    await setFakeCoordinatorExitCode(coordinatorDirectory, 99);
    assert.equal(await runLauncher(launcherPath), 23);
  });
});

test("stable launcher ignores arbitrary Client directories", async () => {
  await withLauncher(async ({ coordinatorDirectory, launcherPath, root }) => {
    await setFakeCoordinatorExitCode(coordinatorDirectory, 0);
    await Promise.all([
      mkdir(path.join(root, "Clients", "0.1.0"), { recursive: true }),
      mkdir(path.join(root, "Clients", "0.2.0"), { recursive: true }),
    ]);
    assert.equal(await runLauncher(launcherPath), 0);
  });
});

test("stable launcher source constrains launch to the fixed Coordinator bootstrap", async () => {
  const source = await readFile(launcherSource, "utf8");

  assert.match(source, /StrCpy \$installationRoot "\$EXEDIR"/);
  assert.match(source, /StrCpy \$coordinatorDirectory "\$installationRoot\\Coordinator"/);
  assert.match(source, /StrCpy \$coordinatorExecutable "\$coordinatorDirectory\\asr-coordinator\.exe"/);
  assert.match(source, /\$\{GetFileAttributes\} "\$installationRoot" "REPARSE_POINT"/);
  assert.match(source, /\$\{GetFileAttributes\} "\$coordinatorDirectory" "REPARSE_POINT"/);
  assert.match(source, /\$\{GetFileAttributes\} "\$coordinatorExecutable" "REPARSE_POINT"/);
  assert.match(source, /ExecWait '"\$coordinatorExecutable"' \$coordinatorExitCode/);
  assert.doesNotMatch(source, /FindFirst|FindNext|FindClose|\\Clients|local-asr-prototype\.exe/);
  assert.doesNotMatch(source, /ExecShell|cmd\.exe|InstallationState|activeClient|knownGoodClient/i);
});
