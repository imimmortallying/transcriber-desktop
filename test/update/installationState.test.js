const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CLIENT_EXECUTABLE,
  InstallationStateError,
  MAX_STATE_FILE_BYTES,
  SCHEMA_VERSION_V2,
  SLOT_NAMES,
  STATE_DIRECTORY,
  assertSelectedClient,
  normalizeState,
  normalizeStateV2,
  publishInitialState,
  readInstallationState,
  reconcileInstallationState,
  sameLogicalState,
  stateForVersion,
  validateClientKey,
} = require("../../src/update/installationState");

async function withInstallation(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asr-installation-state-"));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function createClient(root, version = "0.1.0") {
  const clientDirectory = path.join(root, "Clients", version);
  await fs.mkdir(clientDirectory, { recursive: true });
  await fs.writeFile(path.join(clientDirectory, CLIENT_EXECUTABLE), "client", "utf8");
}

async function writeSlot(root, slotName, state) {
  const stateDirectory = path.join(root, STATE_DIRECTORY);
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.writeFile(path.join(stateDirectory, slotName), `${JSON.stringify(state)}\n`, "utf8");
}

async function writeRawSlot(root, slotName, raw) {
  const stateDirectory = path.join(root, STATE_DIRECTORY);
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.writeFile(path.join(stateDirectory, slotName), raw, "utf8");
}

function withReparseObject(fsPath) {
  const expectedPath = path.resolve(fsPath);
  return {
    ...fs,
    async lstat(candidatePath) {
      const info = await fs.lstat(candidatePath);
      if (path.resolve(candidatePath) !== expectedPath) {
        return info;
      }
      const reparseInfo = Object.create(info);
      reparseInfo.isSymbolicLink = () => true;
      return reparseInfo;
    },
  };
}

function stateV2({
  generation = 1,
  activeVersion = "0.1.0",
  knownGoodVersion = "0.1.0",
  updateTransaction = null,
} = {}) {
  return {
    schemaVersion: SCHEMA_VERSION_V2,
    generation,
    activeClient: { version: activeVersion },
    knownGoodClient: { version: knownGoodVersion },
    updateTransaction,
  };
}

function preparedStateV2() {
  return stateV2({
    updateTransaction: {
      phase: "prepared",
      candidateClient: { version: "0.2.0" },
    },
  });
}

function activatedStateV2() {
  return stateV2({
    activeVersion: "0.2.0",
    updateTransaction: {
      phase: "activated",
      candidateClient: { version: "0.2.0" },
    },
  });
}

test("schema v1 accepts only the exact steady-state fields", () => {
  const valid = stateForVersion("0.1.0", 1);
  assert.deepEqual(normalizeState(valid), valid);
  assert.throws(() => normalizeState({ ...valid, transaction: null }), /exactly the schema v1 fields/);
  assert.throws(
    () => normalizeState({ schemaVersion: 1, generation: 1, activeClient: { version: "0.1.0" } }),
    /exactly the schema v1 fields/,
  );
  assert.throws(() => normalizeState({ ...valid, generation: 0 }), /generation is invalid/);
  assert.throws(
    () => normalizeState({ ...valid, activeClient: { version: "0.2.0" } }),
    /must match/,
  );
});

test("schema v2 accepts exact steady, prepared, and activated states", () => {
  const steady = stateV2();
  const prepared = preparedStateV2();
  const activated = activatedStateV2();

  assert.deepEqual(normalizeStateV2(steady), steady);
  assert.deepEqual(normalizeStateV2(prepared), prepared);
  assert.deepEqual(normalizeStateV2(activated), activated);
});

test("schema v2 rejects invalid transaction combinations and fields", () => {
  const invalidStates = [
    stateV2({ activeVersion: "0.2.0" }),
    stateV2({ updateTransaction: { phase: "prepared", candidateClient: { version: "0.1.0" } } }),
    stateV2({ activeVersion: "0.2.0", updateTransaction: { phase: "prepared", candidateClient: { version: "0.3.0" } } }),
    stateV2({ updateTransaction: { phase: "activated", candidateClient: { version: "0.2.0" } } }),
    stateV2({ activeVersion: "0.2.0", knownGoodVersion: "0.2.0", updateTransaction: { phase: "activated", candidateClient: { version: "0.2.0" } } }),
    stateV2({ updateTransaction: { phase: "awaiting-ready", candidateClient: { version: "0.2.0" } } }),
    stateV2({ updateTransaction: { phase: "prepared" } }),
    { ...stateV2(), unexpected: true },
    stateV2({ updateTransaction: { phase: "prepared", candidateClient: { version: "0.2.0" }, unexpected: true } }),
    stateV2({ updateTransaction: { phase: "prepared", candidateClient: { version: "../outside" } } }),
  ];

  for (const invalidState of invalidStates) {
    assert.throws(() => normalizeStateV2(invalidState), InstallationStateError);
  }
});

test("schema v2 semantic comparison includes transaction phase and candidate", () => {
  const prepared = normalizeStateV2(preparedStateV2());
  const activated = normalizeStateV2(activatedStateV2());
  const differentCandidate = normalizeStateV2(stateV2({
    updateTransaction: {
      phase: "prepared",
      candidateClient: { version: "0.3.0" },
    },
  }));

  assert.equal(sameLogicalState(prepared, normalizeStateV2(preparedStateV2())), true);
  assert.equal(sameLogicalState(prepared, activated), false);
  assert.equal(sameLogicalState(prepared, differentCandidate), false);
});

test("current v1 slot reader leaves a valid v2 document unsupported and writers v1", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    await writeSlot(root, SLOT_NAMES[1], preparedStateV2());

    const result = await readInstallationState(root);
    assert.equal(result.kind, "unsupported");
    assert.equal(result.slots[1].kind, "unsupported");
    assert.equal(stateForVersion("0.1.0", 1).schemaVersion, 1);
  });
});

test("Client keys reject traversal, separators, and arbitrary paths", () => {
  for (const value of ["..", "../0.1.0", "0.1.0/child", "0.1.0\\child", "C:\\outside", "NUL"]) {
    assert.throws(() => validateClientKey(value), InstallationStateError);
  }
  assert.equal(validateClientKey("0.1.0-beta+build.1"), "0.1.0-beta+build.1");
});

test("two identical generation-one bootstrap slots select one logical state", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    await publishInitialState(root, "0.1.0", { id: "bootstrap" });

    const result = await readInstallationState(root);
    assert.equal(result.kind, "selected");
    assert.deepEqual(result.selected, stateForVersion("0.1.0", 1));
    assert.deepEqual(result.slots.map((slot) => slot.kind), ["valid", "valid"]);
  });
});

test("reconcile bootstraps an absent state and preserves a matching steady state", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    const bootstrap = await reconcileInstallationState(root, "0.1.0", { id: "reconcile-bootstrap" });
    assert.equal(bootstrap.action, "bootstrapped");

    const before = await Promise.all(SLOT_NAMES.map((slot) => fs.readFile(path.join(root, STATE_DIRECTORY, slot), "utf8")));
    const repair = await reconcileInstallationState(root, "0.1.0");
    const after = await Promise.all(SLOT_NAMES.map((slot) => fs.readFile(path.join(root, STATE_DIRECTORY, slot), "utf8")));
    assert.equal(repair.action, "preserved");
    assert.deepEqual(after, before);
  });
});

test("slot reader selects the highest valid generation without using slot order", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 4));
    await writeSlot(root, SLOT_NAMES[1], stateForVersion("0.1.0", 7));

    const result = await readInstallationState(root);
    assert.equal(result.kind, "selected");
    assert.equal(result.selected.generation, 7);
  });
});

test("same-generation semantic conflicts are rejected", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    await writeSlot(root, SLOT_NAMES[1], stateForVersion("0.2.0", 1));

    assert.equal((await readInstallationState(root)).kind, "ambiguous");
  });
});

test("one valid slot is selected when the other slot is missing", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    const result = await readInstallationState(root);
    assert.equal(result.kind, "selected");
    assert.equal(result.selected.generation, 1);
    assert.equal(result.slots[1].kind, "missing");
  });
});

test("missing state remains distinct from uninspectable reparse state", async () => {
  await withInstallation(async (root) => {
    const missingResult = await readInstallationState(root);
    assert.equal(missingResult.kind, "no-valid-state");
    assert.equal(missingResult.stateDirectoryExists, false);
    assert.deepEqual(missingResult.slots.map((slot) => slot.kind), ["missing", "missing"]);

    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    await writeSlot(root, SLOT_NAMES[1], stateForVersion("0.1.0", 1));
    const slotPaths = SLOT_NAMES.map((slot) => path.join(root, STATE_DIRECTORY, slot));
    const before = await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8")));
    const reparseFs = withReparseObject(path.join(root, STATE_DIRECTORY));

    const reparseResult = await readInstallationState(root, { fsApi: reparseFs });
    assert.equal(reparseResult.kind, "uninspectable");
    assert.deepEqual(reparseResult.slots.map((slot) => slot.kind), ["uninspectable", "uninspectable"]);
    await assert.rejects(
      () => reconcileInstallationState(root, "0.1.0", { fsApi: reparseFs }),
      (error) => error.code === "UNINSPECTABLE_STATE",
    );
    assert.deepEqual(await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8"))), before);
  });
});

test("reparse slot blocks selection even when the other slot is valid", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    await writeSlot(root, SLOT_NAMES[1], stateForVersion("0.1.0", 1));
    const slotPaths = SLOT_NAMES.map((slot) => path.join(root, STATE_DIRECTORY, slot));
    const before = await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8")));
    const reparseFs = withReparseObject(slotPaths[0]);

    const result = await readInstallationState(root, { fsApi: reparseFs });
    assert.equal(result.kind, "uninspectable");
    assert.equal(result.slots[0].kind, "uninspectable");
    assert.equal(result.slots[1].kind, "valid");
    await assert.rejects(
      () => reconcileInstallationState(root, "0.1.0", { fsApi: reparseFs }),
      (error) => error.code === "UNINSPECTABLE_STATE",
    );
    assert.deepEqual(await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8"))), before);
  });
});

test("both invalid slots have no recoverable state", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], { schemaVersion: 1, generation: 0 });
    await writeSlot(root, SLOT_NAMES[1], { schemaVersion: 1, generation: -1 });
    assert.equal((await readInstallationState(root)).kind, "no-valid-state");
  });
});

test("one valid slot remains recoverable and repair increments generation", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 3));
    await writeSlot(root, SLOT_NAMES[1], { schemaVersion: 1, generation: 0 });

    const beforeRepair = await readInstallationState(root);
    assert.equal(beforeRepair.kind, "selected");
    assert.equal(beforeRepair.selected.generation, 3);

    const repair = await reconcileInstallationState(root, "0.1.0");
    assert.equal(repair.action, "repaired-redundancy");
    assert.equal(repair.state.generation, 4);
    assert.equal((await readInstallationState(root)).selected.generation, 4);
  });
});

test("unsupported schema overrides an otherwise valid slot", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    await writeSlot(root, SLOT_NAMES[1], {
      schemaVersion: 2,
      generation: 2,
      activeClient: { version: "0.2.0" },
      knownGoodClient: { version: "0.2.0" },
    });

    assert.equal((await readInstallationState(root)).kind, "unsupported");
  });
});

test("newer schema with additional fields remains unsupported rather than corrupt", async () => {
  await withInstallation(async (root) => {
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    await writeSlot(root, SLOT_NAMES[1], {
      schemaVersion: 2,
      generation: 2,
      activeClient: { version: "0.2.0" },
      knownGoodClient: { version: "0.2.0" },
      transaction: { phase: "awaiting-ready" },
    });

    assert.equal((await readInstallationState(root)).kind, "unsupported");
  });
});

test("declared-v2 invalid state remains unsupported and is never rewritten by v1 reconciliation", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 1));
    await writeSlot(root, SLOT_NAMES[1], {
      schemaVersion: 2,
      generation: 2,
      activeClient: { version: "0.2.0" },
      knownGoodClient: { version: "0.2.0" },
      updateTransaction: {
        phase: "prepared",
        candidateClient: { version: "0.2.0" },
      },
    });
    const slotPaths = SLOT_NAMES.map((slot) => path.join(root, STATE_DIRECTORY, slot));
    const before = await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8")));
    const readResult = await readInstallationState(root);
    assert.equal(readResult.kind, "unsupported");
    assert.equal(readResult.slots[1].kind, "unsupported");

    await assert.rejects(
      () => reconcileInstallationState(root, "0.1.0", { mode: "provision" }),
      (error) => error.code === "UNSUPPORTED_SCHEMA",
    );
    assert.deepEqual(await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8"))), before);
  });
});

test("oversized state is uninspectable and blocks reconciliation without changing either slot", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    const oversized = `${JSON.stringify({
      schemaVersion: 2,
      generation: 1,
      activeClient: { version: "0.2.0" },
      knownGoodClient: { version: "0.2.0" },
    })}${" ".repeat(MAX_STATE_FILE_BYTES)}`;
    await writeRawSlot(root, SLOT_NAMES[0], oversized);
    await writeSlot(root, SLOT_NAMES[1], stateForVersion("0.1.0", 1));
    const slotPaths = SLOT_NAMES.map((slot) => path.join(root, STATE_DIRECTORY, slot));
    const before = await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8")));

    assert.equal((await readInstallationState(root)).kind, "uninspectable");
    await assert.rejects(
      () => reconcileInstallationState(root, "0.1.0", { mode: "provision" }),
      (error) => error.code === "UNINSPECTABLE_STATE",
    );
    assert.deepEqual(await Promise.all(slotPaths.map((slotPath) => fs.readFile(slotPath, "utf8"))), before);
  });
});

test("duplicate JSON keys are uninspectable regardless of duplicate order or a valid second slot", async () => {
  await withInstallation(async (root) => {
    const suffix = ',"generation":1,"activeClient":{"version":"0.1.0"},"knownGoodClient":{"version":"0.1.0"}}';
    const duplicateNewerThenV1 = `{"schemaVersion":2,"schemaVersion":1${suffix}`;
    const duplicateV1ThenNewer = `{"schemaVersion":1,"schemaVersion":2${suffix}`;

    await writeRawSlot(root, SLOT_NAMES[0], duplicateNewerThenV1);
    await writeSlot(root, SLOT_NAMES[1], stateForVersion("0.1.0", 1));
    assert.equal((await readInstallationState(root)).kind, "uninspectable");

    await writeRawSlot(root, SLOT_NAMES[0], duplicateV1ThenNewer);
    assert.equal((await readInstallationState(root)).kind, "uninspectable");
  });
});

test("duplicate nested Client keys are uninspectable", async () => {
  await withInstallation(async (root) => {
    await writeRawSlot(
      root,
      SLOT_NAMES[0],
      '{"schemaVersion":1,"generation":1,"activeClient":{"version":"0.1.0","version":"0.2.0"},"knownGoodClient":{"version":"0.1.0"}}',
    );
    assert.equal((await readInstallationState(root)).kind, "uninspectable");
  });
});

test("only corrupt recognized-v1 state may be replaced by provisioning authority", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    await writeSlot(root, SLOT_NAMES[0], { schemaVersion: 1, generation: 0 });
    await writeSlot(root, SLOT_NAMES[1], { schemaVersion: 1, generation: 0 });

    const result = await reconcileInstallationState(root, "0.1.0", { mode: "provision", id: "replace" });
    assert.equal(result.action, "replaced-corrupt");
    assert.deepEqual((await readInstallationState(root)).selected, stateForVersion("0.1.0", 1));
  });
});

test("failed staged bootstrap does not publish a partial InstallationState", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    const failingFs = {
      ...fs,
      async rename(source, destination) {
        if (path.basename(destination) === STATE_DIRECTORY) {
          const error = new Error("simulated publish failure");
          error.code = "EACCES";
          throw error;
        }
        return fs.rename(source, destination);
      },
    };

    await assert.rejects(
      () => publishInitialState(root, "0.1.0", { fsApi: failingFs, id: "failed" }),
      /simulated publish failure/,
    );
    await assert.rejects(fs.stat(path.join(root, STATE_DIRECTORY)), { code: "ENOENT" });
    assert.equal((await fs.readdir(root)).some((name) => name.startsWith("InstallationState.bootstrap-")), false);
  });
});

test("failed redundancy write preserves the previously recoverable logical state", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    await writeSlot(root, SLOT_NAMES[0], stateForVersion("0.1.0", 3));
    const failingFs = {
      ...fs,
      async rename(source, destination) {
        if (path.basename(destination) === SLOT_NAMES[1]) {
          const error = new Error("simulated slot publish failure");
          error.code = "EACCES";
          throw error;
        }
        return fs.rename(source, destination);
      },
    };

    await assert.rejects(
      () => reconcileInstallationState(root, "0.1.0", { fsApi: failingFs, id: "failed-repair" }),
      /simulated slot publish failure/,
    );
    const result = await readInstallationState(root);
    assert.equal(result.kind, "selected");
    assert.equal(result.selected.generation, 3);
  });
});

test("selected Client distinguishes unavailable and unsafe paths", async () => {
  await withInstallation(async (root) => {
    await createClient(root);
    await assert.doesNotReject(assertSelectedClient(root, stateForVersion("0.1.0", 1)));
    await fs.rm(path.join(root, "Clients", "0.1.0", CLIENT_EXECUTABLE));
    await assert.rejects(
      assertSelectedClient(root, stateForVersion("0.1.0", 1)),
      (error) => error.code === "SELECTED_CLIENT_UNAVAILABLE",
    );

    await fs.rm(path.join(root, "Clients", "0.1.0"), { recursive: true, force: true });
    await assert.rejects(
      assertSelectedClient(root, stateForVersion("0.1.0", 1)),
      (error) => error.code === "SELECTED_CLIENT_UNAVAILABLE",
    );

    await createClient(root);
    const executablePath = path.join(root, "Clients", "0.1.0", CLIENT_EXECUTABLE);
    await fs.rm(executablePath);
    await fs.mkdir(executablePath);
    await assert.rejects(
      assertSelectedClient(root, stateForVersion("0.1.0", 1)),
      (error) => error.code === "UNSAFE_SELECTED_CLIENT",
    );
    await fs.rm(executablePath, { recursive: true, force: true });

    await createClient(root);
    await assert.rejects(
      assertSelectedClient(root, stateForVersion("0.1.0", 1), { fsApi: withReparseObject(executablePath) }),
      (error) => error.code === "UNSAFE_SELECTED_CLIENT",
    );

    const clientPath = path.join(root, "Clients", "0.1.0");
    const escapingFs = {
      ...fs,
      async realpath(candidatePath) {
        if (path.resolve(candidatePath) === path.resolve(clientPath)) {
          return path.join(root, "outside-client");
        }
        return fs.realpath(candidatePath);
      },
    };
    await assert.rejects(
      assertSelectedClient(root, stateForVersion("0.1.0", 1), { fsApi: escapingFs }),
      (error) => error.code === "UNSAFE_SELECTED_CLIENT",
    );
  });
});
