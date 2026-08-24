"use strict";

const assert = require("node:assert/strict");
const { copyFile, mkdtemp, rm, writeFile } = require("node:fs/promises");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");
const {
  SOURCE_MEDIA_SCHEMA_VERSION,
  createSourceMediaMetadata,
  validateRelinkedSource,
  validateSourceMedia,
} = require("../../src/mediaSource");

function fileInfo({ size = 128, mtimeMs = 1_700_000_000_123, dev = 12, ino = 34 } = {}) {
  return { size, mtimeMs, dev, ino, isFile: () => true };
}

const ORIGINAL_HASH = "a".repeat(64);
const REPLACEMENT_HASH = "b".repeat(64);

async function metadataFor(filePath = "C:\\recordings\\meeting.mp4") {
  return createSourceMediaMetadata(filePath, {
    statFile: async () => fileInfo(),
    hashFile: async () => ORIGINAL_HASH,
  });
}

test("source media metadata keeps a durable path-independent content identity", async () => {
  const metadata = await metadataFor();

  assert.equal(metadata.schemaVersion, SOURCE_MEDIA_SCHEMA_VERSION);
  assert.equal(metadata.sourceKind, "video");
  assert.equal(metadata.sourceMimeType, "video/mp4");
  assert.deepEqual(metadata.identity, {
    sizeBytes: 128,
    sha256: ORIGINAL_HASH,
  });
});

test("source media validation distinguishes available, missing, and mismatch", async () => {
  const metadata = await metadataFor("C:\\recordings\\meeting.wav");

  assert.equal((await validateSourceMedia(metadata, {
    statFile: async () => fileInfo({ dev: 0, ino: 0 }),
    hashFile: async () => ORIGINAL_HASH,
  })).status, "available");
  assert.equal((await validateSourceMedia(metadata, { statFile: async () => { const error = new Error(); error.code = "ENOENT"; throw error; } })).status, "missing");
  assert.equal((await validateSourceMedia(metadata, {
    statFile: async () => fileInfo({ size: 129, dev: 0, ino: 0 }),
    hashFile: async () => ORIGINAL_HASH,
  })).status, "mismatch");
});

test("re-link accepts a moved matching file and rejects a different media file", async () => {
  const metadata = await metadataFor("C:\\recordings\\meeting.webm");

  const available = await validateRelinkedSource(metadata, "D:\\archive\\meeting.webm", {
    statFile: async () => fileInfo({ mtimeMs: 1_700_000_123_999, dev: 99, ino: 88 }),
    hashFile: async () => ORIGINAL_HASH,
  });
  assert.deepEqual(available, {
    status: "available",
    filePath: "D:\\archive\\meeting.webm",
    sourceKind: "video",
    fileState: {
      sizeBytes: 128,
      modifiedAtMs: 1_700_000_123_999,
      fileSystem: { device: "99", file: "88" },
    },
  });

  assert.equal((await validateRelinkedSource(metadata, "D:\\archive\\other.webm", {
    statFile: async () => fileInfo({ ino: 35 }),
    hashFile: async () => REPLACEMENT_HASH,
  })).status, "mismatch");
});

test("content identity accepts a copied move and rejects different bytes of the same size", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "asr-media-identity-"));
  const originalPath = path.join(temporaryDirectory, "original.wav");
  const movedPath = path.join(temporaryDirectory, "moved.wav");
  try {
    await writeFile(originalPath, "original media bytes", "utf8");
    const metadata = await createSourceMediaMetadata(originalPath);
    await copyFile(originalPath, movedPath);

    assert.equal((await validateRelinkedSource(metadata, movedPath)).status, "available");
    await writeFile(movedPath, "replaced media bytes", "utf8");
    assert.equal((await validateRelinkedSource(metadata, movedPath)).status, "mismatch");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
