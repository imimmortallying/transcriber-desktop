const { randomUUID } = require("node:crypto");
const { copyFile, mkdir, mkdtemp, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { path7za: archiver } = require("7zip-bin");

const projectRoot = path.resolve(__dirname, "..");
const productVersion = require(path.join(projectRoot, "package.json")).version;
const launcherOutput = path.join(projectRoot, "build", "stable-launcher.exe");
const coordinatorOutput = path.join(projectRoot, "build", "coordinator", "asr-coordinator.exe");
const childTimeoutMs = 90_000;

function createChildEnvironment(parentEnvironment = process.env) {
  const environment = { ...parentEnvironment };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function run(command, argumentsList, { cwd = projectRoot, env = createChildEnvironment(), label } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label || path.basename(command)} timed out while waiting for ${path.basename(command)}.`));
    }, childTimeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label || path.basename(command)} exited with code ${code}.\n${output.trim()}`));
    });
  });
}

async function writeTinyRuntime(resourcesDirectory) {
  const fixtureDirectory = path.join(resourcesDirectory, "runtime-fixture");
  const archivePath = path.join(resourcesDirectory, "runtime.7z");
  await mkdir(fixtureDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(fixtureDirectory, "runtime-manifest.json"), "{\"fixture\":\"full-setup-e2e\"}\n", "utf8"),
    writeFile(path.join(fixtureDirectory, "E2E_RUNTIME_MARKER.txt"), "tiny runtime lifecycle fixture\n", "utf8"),
  ]);
  await run(archiver, ["a", "-t7z", "-y", archivePath, "."], { cwd: fixtureDirectory, label: "Tiny Runtime archiver" });
  const archiveInfo = await stat(archivePath);
  const unpackedSize = 1;
  const archiveSize = Math.max(1, Math.ceil(archiveInfo.size / 1024));
  await writeFile(
    path.join(resourcesDirectory, "runtime-size.nsh"),
    `!define RUNTIME_UNPACKED_SIZE ${unpackedSize}\n!define RUNTIME_ARCHIVE_SIZE ${archiveSize}\n`,
    "utf8",
  );
  await copyFile(archiver, path.join(resourcesDirectory, "runtime-7za.exe"));
}

async function buildFullSetupE2e({ workspaceDirectory, progress = () => {} } = {}) {
  const workspace = workspaceDirectory || await mkdtemp(path.join(os.tmpdir(), "asr-full-setup-e2e-build-"));
  const resourcesDirectory = path.join(workspace, "resources");
  const outputDirectory = path.join(workspace, "output");
  const identity = randomUUID().replaceAll("-", "");
  const appId = `ru.sber.local-asr.full-setup-e2e.${identity}`;
  const nsisGuid = randomUUID().toUpperCase();

  progress("Building isolated Setup");
  await mkdir(path.join(resourcesDirectory, "coordinator"), { recursive: true });
  await run(process.execPath, [path.join(projectRoot, "scripts", "buildStableLauncher.js")], { label: "Stable launcher build" });
  await run(process.execPath, [path.join(projectRoot, "scripts", "buildCoordinator.js")], { label: "Coordinator build" });
  await Promise.all([
    copyFile(path.join(projectRoot, "build", "installer.nsh"), path.join(resourcesDirectory, "installer.nsh")),
    copyFile(launcherOutput, path.join(resourcesDirectory, "stable-launcher.exe")),
    copyFile(coordinatorOutput, path.join(resourcesDirectory, "coordinator", "asr-coordinator.exe")),
    writeTinyRuntime(resourcesDirectory),
  ]);

  const electronBuilderCli = path.join(projectRoot, "node_modules", "electron-builder", "cli.js");
  await run(process.execPath, [
    electronBuilderCli,
    "--win",
    "nsis",
    "--x64",
    `--config.appId=${appId}`,
    `--config.nsis.guid=${nsisGuid}`,
    "--config.nsis.shortcutName=ASR Full Setup E2E",
    `--config.directories.buildResources=${resourcesDirectory}`,
    `--config.directories.output=${outputDirectory}`,
    `--config.artifactName=asr-full-setup-e2e-${productVersion}.${"${ext}"}`,
  ], { label: "Isolated electron-builder" });

  const setupPath = path.join(outputDirectory, `asr-full-setup-e2e-${productVersion}.exe`);
  const setupInfo = await stat(setupPath);
  if (!setupInfo.isFile() || setupInfo.size === 0) {
    throw new Error("Isolated Full Setup build did not produce an executable.");
  }

  return { appId, resourcesDirectory, setupPath, workspace };
}

if (require.main === module) {
  buildFullSetupE2e({ progress: (message) => console.log(`[E2E] ${message}`) }).then(
    ({ setupPath }) => console.log(`[E2E] Isolated Setup ready: ${setupPath}`),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}

module.exports = { buildFullSetupE2e, createChildEnvironment };
