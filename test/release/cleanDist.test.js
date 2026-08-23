const assert = require("node:assert/strict");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { cleanDist } = require("../../scripts/cleanDist");

async function withTemporaryProject(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "asr-clean-dist-test-"));
  try {
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

test("clean:dist removes disposable files and directories while preserving durable release directories", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const dist = path.join(projectRoot, "dist");
    const releaseA = path.join(dist, "release-0.1.7");
    const releaseB = path.join(dist, "release-12.34.56");
    await Promise.all([
      mkdir(path.join(dist, "win-unpacked"), { recursive: true }),
      mkdir(releaseA, { recursive: true }),
      mkdir(path.join(releaseB, "nested"), { recursive: true }),
      mkdir(path.join(dist, "release-01.2.3"), { recursive: true }),
      mkdir(path.join(dist, "release-1.2"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(dist, "builder-debug.yml"), "workspace", "utf8"),
      writeFile(path.join(dist, "win-unpacked", "client.exe"), "workspace", "utf8"),
      writeFile(path.join(releaseA, "latest.json"), "release A", "utf8"),
      writeFile(path.join(releaseB, "nested", "artifact"), "release B", "utf8"),
      writeFile(path.join(dist, "release-01.2.3", "not-protected"), "workspace", "utf8"),
      writeFile(path.join(dist, "release-1.2", "not-protected"), "workspace", "utf8"),
    ]);

    assert.deepEqual(await cleanDist({ projectRoot }), {
      preserved: ["release-0.1.7", "release-12.34.56"],
      removed: ["builder-debug.yml", "release-01.2.3", "release-1.2", "win-unpacked"],
    });
    assert.equal(await readFile(path.join(releaseA, "latest.json"), "utf8"), "release A");
    assert.equal(await readFile(path.join(releaseB, "nested", "artifact"), "utf8"), "release B");
    await assert.rejects(fs.lstat(path.join(dist, "builder-debug.yml")), { code: "ENOENT" });
    await assert.rejects(fs.lstat(path.join(dist, "win-unpacked")), { code: "ENOENT" });
    await assert.rejects(fs.lstat(path.join(dist, "release-01.2.3")), { code: "ENOENT" });
    await assert.rejects(fs.lstat(path.join(dist, "release-1.2")), { code: "ENOENT" });
  });
});

test("clean:dist stays within the canonical project dist directory and is idempotent", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const dist = path.join(projectRoot, "dist");
    const outside = path.join(projectRoot, "outside");
    await Promise.all([mkdir(dist, { recursive: true }), mkdir(outside, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(dist, "disposable.txt"), "workspace", "utf8"),
      writeFile(path.join(outside, "sentinel.txt"), "outside", "utf8"),
    ]);
    assert.deepEqual(await cleanDist({ projectRoot }), {
      preserved: [],
      removed: ["disposable.txt"],
    });
    assert.equal(await readFile(path.join(outside, "sentinel.txt"), "utf8"), "outside");
    assert.deepEqual(await cleanDist({ projectRoot }), { preserved: [], removed: [] });
  });
});

test("clean:dist accepts an absent dist directory without creating it", async () => {
  await withTemporaryProject(async (projectRoot) => {
    assert.deepEqual(await cleanDist({ projectRoot }), { preserved: [], removed: [] });
    await assert.rejects(fs.lstat(path.join(projectRoot, "dist")), { code: "ENOENT" });
  });
});
