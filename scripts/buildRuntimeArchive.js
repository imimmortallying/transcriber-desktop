const { cp, mkdir, readdir, rm, stat, symlink, writeFile } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { path7za: archiver } = require("7zip-bin");

const projectRoot = path.resolve(__dirname, "..");
const buildDirectory = path.join(projectRoot, "build");
const stagingDirectory = path.join(buildDirectory, "runtime-staging");
const runtimeArchive = path.join(buildDirectory, "runtime.7z");
const runtimeSizeInclude = path.join(buildDirectory, "runtime-size.nsh");
const runtimeExtractor = path.join(buildDirectory, "runtime-7za.exe");

async function createJunction(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(source, destination, "junction");
}

async function runArchiver() {
  await new Promise((resolve, reject) => {
    const child = spawn(archiver, ["a", "-t7z", "-mx=9", "-mmt=on", runtimeArchive, "."], {
      cwd: stagingDirectory,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`7za exited with code ${code}.`));
    });
  });
}

async function getDirectorySize(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      const entryStats = await stat(entryPath);
      return entryStats.isDirectory() ? getDirectorySize(entryPath) : entryStats.size;
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function toKilobytes(sizeInBytes) {
  return Math.ceil(sizeInBytes / 1024);
}

async function main() {
  await rm(stagingDirectory, { recursive: true, force: true });
  await rm(runtimeArchive, { force: true });
  await rm(runtimeExtractor, { force: true });
  await mkdir(path.join(stagingDirectory, "pipeline"), { recursive: true });

  await Promise.all([
    cp(path.join(projectRoot, "runtime-manifest.json"), path.join(stagingDirectory, "runtime-manifest.json")),
    cp(path.join(projectRoot, "pipeline", "config.app.example.json"), path.join(stagingDirectory, "pipeline", "config.json")),
    createJunction(path.join(projectRoot, "resources", "python"), path.join(stagingDirectory, "python")),
    createJunction(path.join(projectRoot, "pipeline", "asr_pipeline"), path.join(stagingDirectory, "pipeline", "asr_pipeline")),
    createJunction(path.join(projectRoot, "resources", "bin", "ffmpeg"), path.join(stagingDirectory, "bin", "ffmpeg")),
    createJunction(path.join(projectRoot, "resources", "models", "gigaam"), path.join(stagingDirectory, "models", "gigaam")),
  ]);

  const runtimeUnpackedSize = await getDirectorySize(stagingDirectory);
  await runArchiver();
  await cp(archiver, runtimeExtractor);
  const runtimeArchiveStats = await stat(runtimeArchive);
  await writeFile(
    runtimeSizeInclude,
    `!define RUNTIME_UNPACKED_SIZE ${toKilobytes(runtimeUnpackedSize)}\n!define RUNTIME_ARCHIVE_SIZE ${toKilobytes(runtimeArchiveStats.size)}\n`,
  );
  await rm(stagingDirectory, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
