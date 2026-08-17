const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  RUNTIME_API_VERSION,
  RUNTIME_ID,
  getRuntimePaths,
  validateRuntime,
} = require("../../src/runtime/resolveRuntime");

async function writeRuntime(root, manifest = {}) {
  await Promise.all([
    mkdir(path.join(root, "pipeline", "asr_pipeline"), { recursive: true }),
    mkdir(path.join(root, "python"), { recursive: true }),
    mkdir(path.join(root, "bin", "ffmpeg"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, "runtime-manifest.json"), JSON.stringify({
      manifestFormatVersion: 1,
      runtimeId: RUNTIME_ID,
      runtimeVersion: "1.0.0",
      runtimeApiVersion: RUNTIME_API_VERSION,
      ...manifest,
    })),
    writeFile(path.join(root, "pipeline", "config.json"), "{}"),
    writeFile(path.join(root, "pipeline", "asr_pipeline", "cli.py"), ""),
    writeFile(path.join(root, "python", "python.exe"), ""),
    writeFile(path.join(root, "bin", "ffmpeg", "ffmpeg.exe"), ""),
  ]);
}

async function withRuntime(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-asr-runtime-"));
  try {
    await writeRuntime(root);
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function packagedRuntime(root, environment = {}) {
  return getRuntimePaths({ isPackaged: true, resourcesPath: root, environment });
}

test("accepts a compatible packaged runtime", async () => {
  await withRuntime(async (root) => {
    const runtime = await validateRuntime(packagedRuntime(root));
    assert.equal(runtime.manifest.runtimeVersion, "1.0.0");
  });
});

test("rejects an unexpected runtime identity", async () => {
  await withRuntime(async (root) => {
    await writeRuntime(root, { runtimeId: "unexpected-runtime" });
    await assert.rejects(validateRuntime(packagedRuntime(root)), /identity is unsupported/);
  });
});

test("rejects an unsupported runtime API version", async () => {
  await withRuntime(async (root) => {
    await writeRuntime(root, { runtimeApiVersion: 2 });
    await assert.rejects(validateRuntime(packagedRuntime(root)), /API version is unsupported/);
  });
});

test("rejects a missing or malformed manifest", async () => {
  await withRuntime(async (root) => {
    await rm(path.join(root, "runtime-manifest.json"));
    await assert.rejects(validateRuntime(packagedRuntime(root)), /manifest is missing/);
    await writeFile(path.join(root, "runtime-manifest.json"), "{");
    await assert.rejects(validateRuntime(packagedRuntime(root)), /invalid JSON/);
  });
});

test("rejects a missing required runtime resource", async () => {
  await withRuntime(async (root) => {
    await rm(path.join(root, "pipeline", "asr_pipeline", "cli.py"));
    await assert.rejects(validateRuntime(packagedRuntime(root)), /missing pipeline CLI entry point/);
  });
});

test("ignores ASR_PYTHON for packaged runtimes", async () => {
  await withRuntime(async (root) => {
    const runtime = packagedRuntime(root, { ASR_PYTHON: "C:\\override\\python.exe" });
    assert.equal(runtime.pythonExecutable, path.join(root, "python", "python.exe"));
  });
});

test("uses the local virtual environment for development runtimes by default", () => {
  const runtime = getRuntimePaths({
    isPackaged: false,
    projectRoot: "C:\\source\\local-asr",
    environment: {},
  });
  assert.equal(
    runtime.pythonExecutable,
    path.join("C:\\source\\local-asr", "pipeline", ".venv", "Scripts", "python.exe"),
  );
});

test("uses ASR_PYTHON for development runtimes", () => {
  const runtime = getRuntimePaths({
    isPackaged: false,
    projectRoot: "C:\\source\\local-asr",
    environment: { ASR_PYTHON: "C:\\dev\\python.exe" },
  });
  assert.equal(runtime.pythonExecutable, "C:\\dev\\python.exe");
  assert.equal(runtime.pipelineDirectory, path.join("C:\\source\\local-asr", "pipeline"));
});
