const assert = require("node:assert/strict");
const { mkdtemp, readdir, rm, stat } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { extractFile } = require("@electron/asar");
const { path7za: archiver } = require("7zip-bin");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const packageMetadata = require("../../package.json");
const { getClientArtifactInfo } = require("../../scripts/buildClientArtifact");

function extractArchive(artifactPath, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(archiver, ["x", "-y", `-o${destination}`, artifactPath], { stdio: "inherit" });
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

async function listRelativePaths(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (!entry.isDirectory()) {
      return [entry.name];
    }

    const descendants = await listRelativePaths(entryPath);
    return descendants.map((descendant) => path.join(entry.name, descendant));
  }));
  return paths.flat();
}

test("creates a provider-neutral Client release ZIP", async () => {
  const artifact = getClientArtifactInfo(packageMetadata);
  const artifactPath = path.join(projectRoot, "dist", artifact.fileName);
  const extractionDirectory = await mkdtemp(path.join(os.tmpdir(), "local-asr-client-artifact-"));

  try {
    await stat(artifactPath);
    assert.equal(
      artifact.fileName,
      `${packageMetadata.name}-client-${packageMetadata.version}-win-x64.zip`,
    );

    await extractArchive(artifactPath, extractionDirectory);

    await Promise.all([
      stat(path.join(extractionDirectory, `${packageMetadata.name}.exe`)),
      stat(path.join(extractionDirectory, "resources", "app.asar")),
      stat(path.join(extractionDirectory, "resources.pak")),
      stat(path.join(extractionDirectory, "icudtl.dat")),
      stat(path.join(extractionDirectory, "libEGL.dll")),
      stat(path.join(extractionDirectory, "locales", "en-US.pak")),
    ]);

    const embeddedPackage = JSON.parse(
      extractFile(path.join(extractionDirectory, "resources", "app.asar"), "package.json").toString("utf8"),
    );
    assert.equal(embeddedPackage.name, packageMetadata.name);
    assert.equal(embeddedPackage.version, packageMetadata.version);

    const relativePaths = await listRelativePaths(extractionDirectory);
    const forbiddenPaths = [
      "Runtime",
      "runtime-manifest.json",
      "python",
      "models",
      "pipeline",
      "data",
      "userData",
      "settings.json",
      path.join("resources", "app-update.yml"),
      path.join("resources", "elevate.exe"),
      path.join("resources", "python"),
      path.join("resources", "models"),
      path.join("resources", "bin", "ffmpeg"),
      "latest.yml",
      "builder-debug.yml",
      "builder-effective-config.yaml",
    ];

    for (const forbiddenPath of forbiddenPaths) {
      assert.equal(relativePaths.includes(forbiddenPath), false, `${forbiddenPath} must be absent`);
    }
    assert.equal(relativePaths.some((relativePath) => relativePath.endsWith(".blockmap")), false);
    assert.equal(relativePaths.some((relativePath) => /Setup.*\.exe$/i.test(relativePath)), false);
    assert.equal(relativePaths.some((relativePath) => /Uninstall/i.test(relativePath)), false);
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }
});
