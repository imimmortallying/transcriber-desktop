const assert = require("node:assert/strict");
const { cp, mkdir, mkdtemp, readFile, rm } = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const {
  buildStableLauncher,
  launcherSource,
} = require("../../scripts/buildStableLauncher");

const clientExecutableName = "local-asr-prototype.exe";
const projectRoot = path.resolve(__dirname, "../..");

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
    await buildStableLauncher({ outputPath: launcherPath, testMode: true });
    await callback({ launcherPath, root });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function copyExpectedClientExecutable(clientDirectory) {
  const expectedClientExecutable = path.join(clientDirectory, clientExecutableName);
  await mkdir(clientDirectory, { recursive: true });
  await cp(path.join(process.env.SystemRoot, "System32", "where.exe"), expectedClientExecutable);
  return expectedClientExecutable;
}

test("stable launcher starts the expected executable from exactly one Client directory", async () => {
  await withLauncher(async ({ launcherPath, root }) => {
    const clientDirectory = path.join(root, "Clients", "0.1.0");
    await copyExpectedClientExecutable(clientDirectory);

    assert.equal(await runLauncher(launcherPath), 0);
  });
});

test("stable launcher rejects a layout without Client directories", async () => {
  await withLauncher(async ({ launcherPath, root }) => {
    await mkdir(path.join(root, "Clients"), { recursive: true });
    assert.equal(await runLauncher(launcherPath), 11);
  });
});

test("stable launcher rejects multiple Client directories", async () => {
  await withLauncher(async ({ launcherPath, root }) => {
    await Promise.all([
      mkdir(path.join(root, "Clients", "0.1.0"), { recursive: true }),
      mkdir(path.join(root, "Clients", "0.2.0"), { recursive: true }),
    ]);
    assert.equal(await runLauncher(launcherPath), 12);
  });
});

test("stable launcher rejects a Client directory without the expected executable", async () => {
  await withLauncher(async ({ launcherPath, root }) => {
    await mkdir(path.join(root, "Clients", "0.1.0"), { recursive: true });
    assert.equal(await runLauncher(launcherPath), 13);
  });
});

test("stable launcher rejects a directory in place of the expected executable", async () => {
  await withLauncher(async ({ launcherPath, root }) => {
    await mkdir(path.join(root, "Clients", "0.1.0", clientExecutableName), { recursive: true });
    assert.equal(await runLauncher(launcherPath), 13);
  });
});

test("stable launcher source constrains launch to the validated layout and avoids shell execution", async () => {
  const source = await readFile(launcherSource, "utf8");

  assert.match(source, /StrCpy \$installationRoot "\$EXEDIR"/);
  assert.match(source, /StrCpy \$clientsDirectory "\$installationRoot\\Clients"/);
  assert.match(source, /StrCpy \$expectedClientExecutable "\$clientDirectory\\local-asr-prototype\.exe"/);
  assert.match(source, /Exec '"\$expectedClientExecutable"'/);
  assert.doesNotMatch(source, /ExecShell|cmd\.exe|Find.*Current|active|candidate|known-good/i);
});
