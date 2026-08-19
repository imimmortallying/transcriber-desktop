const { access, readFile, rm, stat } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { path7za: archiver } = require("7zip-bin");

const projectRoot = path.resolve(__dirname, "..");
const distributionDirectory = path.join(projectRoot, "dist");
const clientBundleDirectory = path.join(distributionDirectory, "win-unpacked");

function getClientArtifactInfo(packageMetadata) {
  const fileName = `${packageMetadata.name}-client-${packageMetadata.version}-win-x64.zip`;
  return {
    fileName,
    path: path.join(distributionDirectory, fileName),
  };
}

async function assertFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile()) {
    throw new Error(`Client bundle resource is not a file: ${relativePath}`);
  }
}

async function assertAbsent(root, relativePath) {
  try {
    await access(path.join(root, relativePath));
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  throw new Error(`Client bundle must not contain: ${relativePath}`);
}

async function assertClientBundle(packageMetadata) {
  const requiredFiles = [
    `${packageMetadata.name}.exe`,
    "chrome_100_percent.pak",
    "icudtl.dat",
    "libEGL.dll",
    "resources.pak",
    "locales/en-US.pak",
    "resources/app.asar",
  ];
  const forbiddenPaths = [
    "Runtime",
    "runtime-manifest.json",
    "python",
    "models",
    "pipeline",
    "data",
    "userData",
    "settings.json",
    "resources/app-update.yml",
    "resources/elevate.exe",
    "resources/python",
    "resources/models",
    "resources/bin/ffmpeg",
    "latest.yml",
    "builder-debug.yml",
    "builder-effective-config.yaml",
  ];

  await Promise.all(requiredFiles.map((relativePath) => assertFile(clientBundleDirectory, relativePath)));
  await Promise.all(forbiddenPaths.map((relativePath) => assertAbsent(clientBundleDirectory, relativePath)));
}

function archiveClientBundle(artifactPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(archiver, ["a", "-tzip", "-mx=1", artifactPath, "."], {
      cwd: clientBundleDirectory,
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

async function buildClientArtifact() {
  const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const artifact = getClientArtifactInfo(packageMetadata);

  await assertClientBundle(packageMetadata);
  await rm(artifact.path, { force: true });
  await archiveClientBundle(artifact.path);
  await assertFile(distributionDirectory, artifact.fileName);

  return artifact;
}

if (require.main === module) {
  buildClientArtifact().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildClientArtifact, getClientArtifactInfo };
