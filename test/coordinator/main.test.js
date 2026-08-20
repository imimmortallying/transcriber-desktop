const assert = require("node:assert/strict");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { CoordinatorExitCode, runCoordinator } = require("../../src/coordinator/main");

async function withCoordinatorGeometry(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "asr-coordinator-"));
  const coordinatorDirectory = path.join(root, "Coordinator");
  const executablePath = path.join(coordinatorDirectory, "asr-coordinator.exe");
  await mkdir(coordinatorDirectory, { recursive: true });
  await writeFile(executablePath, "coordinator", "utf8");
  try {
    await callback({ root, executablePath });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function selectedState(version = "0.1.0", slots = [{ kind: "valid" }, { kind: "valid" }]) {
  return {
    kind: "selected",
    slots,
    selected: {
      schemaVersion: 1,
      generation: 1,
      activeClient: { version },
      knownGoodClient: { version },
    },
  };
}

function createSpawn() {
  const child = new EventEmitter();
  child.unrefCalled = false;
  child.unref = () => {
    child.unrefCalled = true;
  };
  const calls = [];
  return {
    child,
    calls,
    spawnFn(...argumentsList) {
      calls.push(argumentsList);
      return child;
    },
  };
}

async function waitForSpawn(spawned) {
  for (let attempt = 0; attempt < 100 && spawned.calls.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(spawned.calls.length, 1);
}

test("Coordinator rejects unexpected executable geometry before reading state", async () => {
  let readCalled = false;
  const result = await runCoordinator({
    executablePath: path.join(os.tmpdir(), "asr-coordinator.exe"),
    readState: async () => {
      readCalled = true;
    },
  });
  assert.equal(result, CoordinatorExitCode.INVALID_GEOMETRY);
  assert.equal(readCalled, false);
});

test("Coordinator launches only selected active Client after spawn confirmation", async () => {
  await withCoordinatorGeometry(async ({ root, executablePath }) => {
    const spawned = createSpawn();
    let settled = false;
    const resultPromise = runCoordinator({
      executablePath,
      readState: async () => selectedState("0.1.0"),
      assertClient: async () => ({
        version: "0.1.0",
        clientPath: path.join(root, "Clients", "0.1.0"),
        executablePath: path.join(root, "Clients", "0.1.0", "local-asr-prototype.exe"),
      }),
      spawnFn: spawned.spawnFn,
    }).then((result) => {
      settled = true;
      return result;
    });
    await waitForSpawn(spawned);
    assert.equal(settled, false);
    assert.deepEqual(spawned.calls, [[
      path.join(root, "Clients", "0.1.0", "local-asr-prototype.exe"),
      [],
      {
        cwd: path.join(root, "Clients", "0.1.0"),
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    ]]);
    spawned.child.emit("spawn");
    assert.equal(await resultPromise, CoordinatorExitCode.SUCCESS);
    assert.equal(spawned.child.unrefCalled, true);
  });
});

test("Coordinator maps readonly state results without Client scanning", async () => {
  await withCoordinatorGeometry(async ({ executablePath }) => {
    const cases = [
      [{ kind: "no-valid-state", stateDirectoryExists: false, slots: [{ kind: "missing" }, { kind: "missing" }] }, CoordinatorExitCode.STATE_ABSENT],
      [{ kind: "no-valid-state", stateDirectoryExists: true, slots: [{ kind: "invalid" }, { kind: "missing" }] }, CoordinatorExitCode.NO_RECOVERABLE_STATE],
      [{ kind: "unsupported" }, CoordinatorExitCode.UNSUPPORTED_STATE],
      [{ kind: "uninspectable" }, CoordinatorExitCode.UNINSPECTABLE_STATE],
      [{ kind: "ambiguous" }, CoordinatorExitCode.AMBIGUOUS_STATE],
    ];
    for (const [state, expectedExitCode] of cases) {
      let assertCalled = false;
      assert.equal(await runCoordinator({
        executablePath,
        readState: async () => state,
        assertClient: async () => {
          assertCalled = true;
        },
      }), expectedExitCode);
      assert.equal(assertCalled, false);
    }
  });
});

test("Coordinator accepts recoverable single-slot state without repairing it", async () => {
  await withCoordinatorGeometry(async ({ root, executablePath }) => {
    for (const slots of [[{ kind: "valid" }, { kind: "missing" }], [{ kind: "valid" }, { kind: "invalid" }]]) {
      const spawned = createSpawn();
      const resultPromise = runCoordinator({
        executablePath,
        readState: async () => selectedState("0.1.0", slots),
        assertClient: async () => ({
          clientPath: path.join(root, "Clients", "0.1.0"),
          executablePath: path.join(root, "Clients", "0.1.0", "local-asr-prototype.exe"),
        }),
        spawnFn: spawned.spawnFn,
      });
      await waitForSpawn(spawned);
      spawned.child.emit("spawn");
      assert.equal(await resultPromise, CoordinatorExitCode.SUCCESS);
    }
  });
});

test("Coordinator preserves selected Client error categories", async () => {
  await withCoordinatorGeometry(async ({ executablePath }) => {
    for (const [errorCode, expectedExitCode] of [
      ["SELECTED_CLIENT_UNAVAILABLE", CoordinatorExitCode.SELECTED_CLIENT_UNAVAILABLE],
      ["UNSAFE_SELECTED_CLIENT", CoordinatorExitCode.UNSAFE_SELECTED_CLIENT],
    ]) {
      assert.equal(await runCoordinator({
        executablePath,
        readState: async () => selectedState(),
        assertClient: async () => {
          const error = new Error(errorCode);
          error.code = errorCode;
          throw error;
        },
      }), expectedExitCode);
    }
  });
});

test("Coordinator reports process creation and unexpected failures separately", async () => {
  await withCoordinatorGeometry(async ({ root, executablePath }) => {
    const client = {
      clientPath: path.join(root, "Clients", "0.1.0"),
      executablePath: path.join(root, "Clients", "0.1.0", "local-asr-prototype.exe"),
    };
    const errorChild = createSpawn();
    const failedProcess = runCoordinator({
      executablePath,
      readState: async () => selectedState(),
      assertClient: async () => client,
      spawnFn: errorChild.spawnFn,
    });
    await waitForSpawn(errorChild);
    errorChild.child.emit("error", new Error("spawn failed"));
    assert.equal(await failedProcess, CoordinatorExitCode.CLIENT_PROCESS_CREATION_FAILED);
    assert.equal(await runCoordinator({
      executablePath,
      readState: async () => {
        throw new Error("unexpected");
      },
    }), CoordinatorExitCode.UNEXPECTED_FAILURE);
  });
});
