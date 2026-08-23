const assert = require("node:assert/strict");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { cleanupObsoleteClientDirectories, protectedClientVersions } = require("../../src/coordinator/clientRetention");

function stateV2({ activeVersion = "0.2.0", knownGoodVersion = activeVersion, updateTransaction = null } = {}) {
  return {
    schemaVersion: 2,
    generation: 1,
    activeClient: { version: activeVersion },
    knownGoodClient: { version: knownGoodVersion },
    updateTransaction,
  };
}

async function createClient(root, version) {
  const directory = path.join(root, "Clients", version);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "local-asr-prototype.exe"), "client", "utf8");
}

async function withInstallation(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "asr-client-retention-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

test("steady state retains active/known-good and removes an unreferenced Client", async () => {
  await withInstallation(async (root) => {
    await Promise.all([createClient(root, "0.1.0"), createClient(root, "0.2.0")]);
    const result = await cleanupObsoleteClientDirectories(root, stateV2());
    assert.deepEqual(result, { removed: ["0.1.0"], skipped: [] });
    await assert.doesNotReject(fs.lstat(path.join(root, "Clients", "0.2.0")));
    await assert.rejects(fs.lstat(path.join(root, "Clients", "0.1.0")), { code: "ENOENT" });
  });
});

test("steady state removes an empty obsolete Client directory", async () => {
  await withInstallation(async (root) => {
    await createClient(root, "0.1.6");
    await mkdir(path.join(root, "Clients", "0.1.2"), { recursive: true });
    const state = stateV2({ activeVersion: "0.1.6" });
    assert.deepEqual(await cleanupObsoleteClientDirectories(root, state), {
      removed: ["0.1.2"],
      skipped: [],
    });
    await assert.doesNotReject(fs.lstat(path.join(root, "Clients", "0.1.6")));
    await assert.rejects(fs.lstat(path.join(root, "Clients", "0.1.2")), { code: "ENOENT" });
  });
});

test("prepared and activated transactions retain every Client required for recovery", async () => {
  await withInstallation(async (root) => {
    await Promise.all(["0.1.0", "0.2.0", "0.3.0"].map((version) => createClient(root, version)));
    const prepared = stateV2({
      activeVersion: "0.2.0",
      updateTransaction: { phase: "prepared", candidateClient: { version: "0.3.0" } },
    });
    assert.deepEqual([...protectedClientVersions(prepared)].sort(), ["0.2.0", "0.3.0"]);
    assert.deepEqual(await cleanupObsoleteClientDirectories(root, prepared), { removed: ["0.1.0"], skipped: [] });
    await assert.doesNotReject(fs.lstat(path.join(root, "Clients", "0.2.0")));
    await assert.doesNotReject(fs.lstat(path.join(root, "Clients", "0.3.0")));

    await createClient(root, "0.1.0");
    const activated = stateV2({
      activeVersion: "0.3.0",
      knownGoodVersion: "0.2.0",
      updateTransaction: { phase: "activated", candidateClient: { version: "0.3.0" } },
    });
    assert.deepEqual([...protectedClientVersions(activated)].sort(), ["0.2.0", "0.3.0"]);
    assert.deepEqual(await cleanupObsoleteClientDirectories(root, activated), { removed: ["0.1.0"], skipped: [] });
    await assert.doesNotReject(fs.lstat(path.join(root, "Clients", "0.2.0")));
    await assert.doesNotReject(fs.lstat(path.join(root, "Clients", "0.3.0")));
  });
});

test("failed deletion is retained for a future cleanup attempt", async () => {
  await withInstallation(async (root) => {
    await Promise.all([createClient(root, "0.1.0"), createClient(root, "0.2.0")]);
    const lockedExecutable = path.join(root, "Clients", "0.1.0", "local-asr-prototype.exe");
    const fsApi = Object.create(fs);
    fsApi.unlink = async (filePath) => {
      if (path.resolve(filePath) === path.resolve(lockedExecutable)) {
        const error = new Error("locked");
        error.code = "EBUSY";
        throw error;
      }
      return fs.unlink(filePath);
    };
    assert.deepEqual(await cleanupObsoleteClientDirectories(root, stateV2(), { fsApi }), {
      removed: [],
      skipped: ["0.1.0"],
    });
    await assert.doesNotReject(fs.lstat(lockedExecutable));
  });
});

test("reparse-style or unsafe Client entries are never deleted", async () => {
  await withInstallation(async (root) => {
    await Promise.all([createClient(root, "0.1.0"), createClient(root, "0.2.0")]);
    const oldClient = path.join(root, "Clients", "0.1.0");
    const fsApi = Object.create(fs);
    fsApi.lstat = async (candidatePath) => {
      if (path.resolve(candidatePath) === path.resolve(oldClient)) {
        return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => true };
      }
      return fs.lstat(candidatePath);
    };
    assert.deepEqual(await cleanupObsoleteClientDirectories(root, stateV2(), { fsApi }), {
      removed: [],
      skipped: ["0.1.0"],
    });
    await assert.doesNotReject(fs.lstat(oldClient));
  });
});
