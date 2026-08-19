const { readFile, stat } = require("node:fs/promises");
const path = require("node:path");
const { resolveCurrentClientInstallationRoot } = require("./resolveCurrentClientInstallationRoot");

const RUNTIME_ID = "local-asr-runtime";
const RUNTIME_API_VERSION = 1;

function getRuntimePaths({
  isPackaged,
  installationRoot,
  projectRoot = path.resolve(__dirname, "../.."),
  environment = process.env,
}) {
  if (isPackaged && (typeof installationRoot !== "string" || !installationRoot.trim())) {
    throw new Error("Packaged ASR Runtime requires an installation root.");
  }

  const runtimeRoot = isPackaged ? path.resolve(installationRoot, "Runtime") : projectRoot;
  const resourceRoot = isPackaged ? runtimeRoot : path.join(runtimeRoot, "resources");
  const pipelineDirectory = path.join(runtimeRoot, "pipeline");

  return {
    root: runtimeRoot,
    manifestPath: path.join(runtimeRoot, "runtime-manifest.json"),
    pipelineDirectory,
    pipelineConfigPath: path.join(pipelineDirectory, "config.json"),
    pythonExecutable: isPackaged
      ? path.join(resourceRoot, "python", "python.exe")
      : environment.ASR_PYTHON || path.join(pipelineDirectory, ".venv", "Scripts", "python.exe"),
    ffmpegExecutable: path.join(resourceRoot, "bin", "ffmpeg", "ffmpeg.exe"),
    isPackaged,
  };
}

function getCurrentRuntime() {
  const { app } = require("electron");
  const isPackaged = app.isPackaged;
  return getRuntimePaths({
    isPackaged,
    installationRoot: isPackaged
      ? resolveCurrentClientInstallationRoot(process.resourcesPath)
      : undefined,
  });
}

async function readRuntimeManifest(manifestPath) {
  let rawManifest;
  try {
    rawManifest = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("ASR Runtime manifest is missing.");
    }
    throw new Error(`Unable to read ASR Runtime manifest: ${error.message}`);
  }

  try {
    return JSON.parse(rawManifest);
  } catch {
    throw new Error("ASR Runtime manifest contains invalid JSON.");
  }
}

async function assertResource(resourcePath, description, expectedType) {
  let resourceInfo;
  try {
    resourceInfo = await stat(resourcePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`ASR Runtime is missing ${description}.`);
    }
    throw new Error(`Unable to inspect ASR Runtime ${description}: ${error.message}`);
  }

  if (!resourceInfo[expectedType]()) {
    throw new Error(`ASR Runtime ${description} has an unexpected type.`);
  }
}

async function validateRuntime(runtime) {
  const manifest = await readRuntimeManifest(runtime.manifestPath);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("ASR Runtime manifest must contain an object.");
  }
  if (manifest.manifestFormatVersion !== 1) {
    throw new Error("ASR Runtime manifest format is unsupported.");
  }
  if (manifest.runtimeId !== RUNTIME_ID) {
    throw new Error("ASR Runtime identity is unsupported.");
  }
  if (typeof manifest.runtimeVersion !== "string" || !manifest.runtimeVersion.trim()) {
    throw new Error("ASR Runtime manifest has no runtime version.");
  }
  if (manifest.runtimeApiVersion !== RUNTIME_API_VERSION) {
    throw new Error("ASR Runtime API version is unsupported.");
  }

  await Promise.all([
    assertResource(runtime.pythonExecutable, "Python executable", "isFile"),
    assertResource(runtime.pipelineDirectory, "pipeline directory", "isDirectory"),
    assertResource(runtime.pipelineConfigPath, "pipeline configuration", "isFile"),
    assertResource(
      path.join(runtime.pipelineDirectory, "asr_pipeline", "cli.py"),
      "pipeline CLI entry point",
      "isFile",
    ),
    assertResource(runtime.ffmpegExecutable, "ffmpeg executable", "isFile"),
  ]);

  return { ...runtime, manifest };
}

module.exports = {
  RUNTIME_API_VERSION,
  RUNTIME_ID,
  getCurrentRuntime,
  getRuntimePaths,
  validateRuntime,
};
