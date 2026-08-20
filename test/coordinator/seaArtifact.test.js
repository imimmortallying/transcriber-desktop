const assert = require("node:assert/strict");
const { stat } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { coordinatorOutput } = require("../../scripts/buildCoordinator");

function runCoordinator(executablePath) {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR;
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      env: {
        PATH: path.join(windowsDirectory, "System32"),
        SystemRoot: windowsDirectory,
        WINDIR: windowsDirectory,
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("SEA coordinator artifact runs its bundled smoke entry without Node in PATH", async () => {
  assert.equal(path.basename(coordinatorOutput), "asr-coordinator.exe");
  const outputInfo = await stat(coordinatorOutput);
  assert.equal(outputInfo.isFile(), true);

  const result = await runCoordinator(coordinatorOutput);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "ASR_COORDINATOR_SEA_SMOKE_OK\n");
});
