"use strict";

const crypto = require("node:crypto");
const nodeFs = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const yauzl = require("yauzl");
const {
  CLIENT_EXECUTABLE,
  InstallationStateError,
  parseJsonWithUniqueKeys,
  validateClientKey,
} = require("./installationState");
const { PRODUCTION_TRUSTED_SIGNERS } = require("./productionTrust");

const UPDATE_PACKAGE_FORMAT_VERSION = 1;
const UPDATE_PACKAGE_EXTENSION = ".asrupdate";
const UPDATE_PACKAGE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const UPDATE_MANIFEST_MAX_BYTES = 64 * 1024;
const UPDATE_SIGNATURE_MAX_BYTES = 8 * 1024;
const UPDATE_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const UPDATE_EXTRACTED_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const UPDATE_EXTRACTED_MAX_ENTRIES = 10_000;
const OUTER_ENTRY_NAMES = Object.freeze(["manifest.json", "manifest.sig", "client.zip"]);
const entryStreamKeepAlives = new WeakMap();

class ClientUpdatePackageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FileDescriptorRandomAccessReader extends yauzl.RandomAccessReader {
  constructor(fileDescriptor) {
    super();
    this.fileDescriptor = fileDescriptor;
    this.activeStreams = 0;
    this.closeRequested = false;
    this.closeCallbacks = [];
    this.handleClosed = false;
  }

  _readStreamForRange(start, end) {
    let position = start;
    const reader = this;
    const stream = new Readable({
      read() {
        if (position === end) {
          this.push(null);
          return;
        }
        const length = Math.min(64 * 1024, end - position);
        const chunk = Buffer.allocUnsafe(length);
        nodeFs.read(reader.fileDescriptor, chunk, 0, length, position, (error, bytesRead) => {
          if (error) {
            this.destroy(error);
            return;
          }
          if (bytesRead === 0) {
            this.destroy(new Error("Unexpected EOF while reading update package."));
            return;
          }
          position += bytesRead;
          this.push(chunk.subarray(0, bytesRead));
        });
      },
    });
    this.activeStreams += 1;
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      this.activeStreams -= 1;
      this.closeWhenIdle();
    };
    stream.once("end", settle);
    stream.once("error", settle);
    return stream;
  }

  close(callback) {
    this.closeCallbacks.push(callback);
    this.closeRequested = true;
    this.closeWhenIdle();
  }

  closeWhenIdle() {
    if (!this.closeRequested || this.activeStreams !== 0 || this.handleClosed) {
      return;
    }
    this.handleClosed = true;
    nodeFs.close(this.fileDescriptor, (error) => this.finishClose(error));
  }

  finishClose(error) {
    const callbacks = this.closeCallbacks;
    this.closeCallbacks = [];
    for (const callback of callbacks) {
      callback(error);
    }
  }
}

function fail(code, message) {
  throw new ClientUpdatePackageError(code, message);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INVALID_MANIFEST", "Update manifest contains a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    fail("INVALID_MANIFEST", "Update manifest contains an unsupported value.");
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function hasOnlyKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeManifest(value) {
  if (!hasOnlyKeys(value, ["formatVersion", "keyId", "client", "payload"])) {
    fail("INVALID_MANIFEST", "Update manifest has an unexpected shape.");
  }
  if (value.formatVersion !== UPDATE_PACKAGE_FORMAT_VERSION) {
    fail("UNSUPPORTED_UPDATE_FORMAT", "Update package format is unsupported.");
  }
  if (typeof value.keyId !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(value.keyId)) {
    fail("INVALID_MANIFEST", "Update manifest signer identity is invalid.");
  }
  if (!hasOnlyKeys(value.client, ["version", "runtimeApiVersion"])) {
    fail("INVALID_MANIFEST", "Update manifest Client identity is invalid.");
  }
  let version;
  try {
    version = validateClientKey(value.client.version);
  } catch (error) {
    if (error instanceof InstallationStateError) {
      fail("INVALID_MANIFEST", "Update manifest Client version is invalid.");
    }
    throw error;
  }
  if (!Number.isSafeInteger(value.client.runtimeApiVersion) || value.client.runtimeApiVersion < 1) {
    fail("INVALID_MANIFEST", "Update manifest Runtime API version is invalid.");
  }
  if (!hasOnlyKeys(value.payload, ["file", "sha256", "bytes"])
    || value.payload.file !== "client.zip"
    || typeof value.payload.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.payload.sha256)
    || !Number.isSafeInteger(value.payload.bytes)
    || value.payload.bytes < 1
    || value.payload.bytes > UPDATE_PAYLOAD_MAX_BYTES) {
    fail("INVALID_MANIFEST", "Update manifest payload is invalid.");
  }
  return {
    formatVersion: UPDATE_PACKAGE_FORMAT_VERSION,
    keyId: value.keyId,
    client: { version, runtimeApiVersion: value.client.runtimeApiVersion },
    payload: { file: "client.zip", sha256: value.payload.sha256, bytes: value.payload.bytes },
  };
}

async function openZip(zipPath, { fsApi = fs } = {}) {
  let fileDescriptor;
  try {
    const info = await fsApi.stat(zipPath);
    fileDescriptor = await new Promise((resolve, reject) => {
      nodeFs.open(zipPath, "r", (error, descriptor) => error ? reject(error) : resolve(descriptor));
    });
    const reader = new FileDescriptorRandomAccessReader(fileDescriptor);
    return await new Promise((resolve, reject) => {
      const keepAlive = setInterval(() => {}, 1_000);
      yauzl.fromRandomAccessReader(reader, info.size, {
        lazyEntries: true,
        validateEntrySizes: true,
        autoClose: false,
      }, (error, zipFile) => {
        clearInterval(keepAlive);
        if (error) {
          reject(error);
          return;
        }
        resolve(zipFile);
      });
    });
  } catch (error) {
    if (fileDescriptor !== undefined) {
      await new Promise((resolve) => nodeFs.close(fileDescriptor, () => resolve()));
    }
    throw error;
  }
}

function readZipEntries(zipFile) {
  return new Promise((resolve, reject) => {
    const keepAlive = setInterval(() => {}, 1_000);
    const entries = [];
    zipFile.once("error", (error) => {
      clearInterval(keepAlive);
      reject(error);
    });
    zipFile.on("entry", (entry) => {
      entries.push(entry);
      zipFile.readEntry();
    });
    zipFile.once("end", () => {
      clearInterval(keepAlive);
      resolve(entries);
    });
    zipFile.readEntry();
  });
}

function openEntryStream(zipFile, entry) {
  return new Promise((resolve, reject) => {
    const keepAlive = setInterval(() => {}, 1_000);
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        clearInterval(keepAlive);
        reject(error);
        return;
      }
      stream.once("close", () => clearInterval(keepAlive));
      stream.once("error", () => clearInterval(keepAlive));
      entryStreamKeepAlives.set(stream, keepAlive);
      resolve(stream);
    });
  });
}

async function consumeEntryStream(stream, consumeChunk) {
  // yauzl's Windows file reader is deliberately unref'ed while a stream is
  // pending. Keep this short-lived consumer alive until that stream completes.
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    await new Promise((resolve, reject) => {
      let chain = Promise.resolve();
      let ended = false;
      const complete = () => {
        if (ended) {
          chain.then(resolve, reject);
        }
      };
      stream.pause();
      stream.on("data", (chunk) => {
        stream.pause();
        chain = chain.then(() => consumeChunk(chunk)).then(() => {
          stream.resume();
        });
        chain.catch(reject);
      });
      stream.once("error", reject);
      stream.once("end", () => {
        ended = true;
        complete();
      });
      stream.resume();
    });
  } finally {
    const openStreamKeepAlive = entryStreamKeepAlives.get(stream);
    if (openStreamKeepAlive) {
      clearInterval(openStreamKeepAlive);
      entryStreamKeepAlives.delete(stream);
    }
    clearInterval(keepAlive);
  }
}

async function readEntry(zipFile, entry, maximumBytes) {
  const chunks = [];
  let bytes = 0;
  const stream = await openEntryStream(zipFile, entry);
  await consumeEntryStream(stream, (chunk) => {
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      stream.destroy();
      fail("UPDATE_PACKAGE_TOO_LARGE", "Update package entry exceeds its size limit.");
    }
    chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}

async function withOuterEntry(packagePath, entryName, callback, { fsApi = fs } = {}) {
  let zipFile;
  try {
    zipFile = await openZip(packagePath, { fsApi });
    const entries = assertOuterEntries(await readZipEntries(zipFile));
    return await callback(zipFile, entries.get(entryName));
  } finally {
    zipFile?.close();
  }
}

function assertOuterEntries(entries) {
  if (entries.length !== OUTER_ENTRY_NAMES.length) {
    fail("INVALID_UPDATE_PACKAGE", "Update package contains unexpected entries.");
  }
  const byName = new Map();
  for (const entry of entries) {
    if (!OUTER_ENTRY_NAMES.includes(entry.fileName) || entry.fileName.endsWith("/") || byName.has(entry.fileName)) {
      fail("INVALID_UPDATE_PACKAGE", "Update package contains unexpected entries.");
    }
    byName.set(entry.fileName, entry);
  }
  if (byName.size !== OUTER_ENTRY_NAMES.length) {
    fail("INVALID_UPDATE_PACKAGE", "Update package is incomplete.");
  }
  return byName;
}

async function inspectPackageFile(packagePath, { fsApi = fs } = {}) {
  let info;
  try {
    info = await fsApi.lstat(packagePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      fail("UPDATE_PACKAGE_UNAVAILABLE", "Update package is missing.");
    }
    fail("UPDATE_PACKAGE_UNSAFE", "Update package cannot be safely inspected.");
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail("UPDATE_PACKAGE_UNSAFE", "Update package has an unsafe filesystem type.");
  }
  if (info.size < 1 || info.size > UPDATE_PACKAGE_MAX_BYTES) {
    fail("UPDATE_PACKAGE_TOO_LARGE", "Update package exceeds its size limit.");
  }
}

function decodeSignature(rawSignature) {
  const source = rawSignature.toString("utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(source)) {
    fail("INVALID_SIGNATURE", "Update package signature encoding is invalid.");
  }
  const signature = Buffer.from(source, "base64");
  if (signature.length !== 64) {
    fail("INVALID_SIGNATURE", "Update package signature length is invalid.");
  }
  return signature;
}

async function readAndVerifyManifest(packagePath, { fsApi = fs, trustedSigners = PRODUCTION_TRUSTED_SIGNERS } = {}) {
  await inspectPackageFile(packagePath, { fsApi });
  let zipFile;
  try {
    const rawManifest = await withOuterEntry(
      packagePath,
      "manifest.json",
      (outerZip, entry) => readEntry(outerZip, entry, UPDATE_MANIFEST_MAX_BYTES),
      { fsApi },
    );
    const rawSignature = await withOuterEntry(
      packagePath,
      "manifest.sig",
      (outerZip, entry) => readEntry(outerZip, entry, UPDATE_SIGNATURE_MAX_BYTES),
      { fsApi },
    );
    let parsedManifest;
    try {
      parsedManifest = parseJsonWithUniqueKeys(rawManifest.toString("utf8"));
    } catch {
      fail("INVALID_MANIFEST", "Update manifest is invalid JSON.");
    }
    const manifest = normalizeManifest(parsedManifest);
    const signer = trustedSigners && trustedSigners[manifest.keyId];
    if (!signer || signer.algorithm !== "ed25519" || typeof signer.publicKeyPem !== "string") {
      fail("UNTRUSTED_SIGNER", "Update package signer is not trusted.");
    }
    let verified;
    try {
      verified = crypto.verify(null, Buffer.from(canonicalJson(manifest), "utf8"), signer.publicKeyPem, decodeSignature(rawSignature));
    } catch {
      fail("INVALID_SIGNATURE", "Update package signature cannot be verified.");
    }
    if (!verified) {
      fail("INVALID_SIGNATURE", "Update package signature is invalid.");
    }
    return manifest;
  } catch (error) {
    if (error instanceof ClientUpdatePackageError) {
      throw error;
    }
    fail("INVALID_UPDATE_PACKAGE", "Update package cannot be read safely.");
  } finally {
    zipFile?.close();
  }
}

async function copyPayload(packagePath, destinationPath, manifest, { fsApi = fs } = {}) {
  let output;
  try {
    await withOuterEntry(packagePath, manifest.payload.file, async (zipFile, entry) => {
      const stream = await openEntryStream(zipFile, entry);
      const hash = crypto.createHash("sha256");
      let bytes = 0;
      output = await fsApi.open(destinationPath, "wx");
      await consumeEntryStream(stream, async (chunk) => {
        bytes += chunk.length;
        if (bytes > manifest.payload.bytes || bytes > UPDATE_PAYLOAD_MAX_BYTES) {
          stream.destroy();
          fail("PAYLOAD_HASH_MISMATCH", "Update package payload size does not match its manifest.");
        }
        hash.update(chunk);
        await output.write(chunk);
      });
      await output.sync();
      await output.close();
      output = undefined;
      if (bytes !== manifest.payload.bytes || hash.digest("hex") !== manifest.payload.sha256) {
        fail("PAYLOAD_HASH_MISMATCH", "Update package payload does not match its manifest.");
      }
    }, { fsApi });
  } finally {
    await output?.close().catch(() => {});
  }
}

function isZipSymlink(entry) {
  const unixMode = entry.externalFileAttributes >>> 16;
  return (unixMode & 0o170000) === 0o120000;
}

function safeZipPath(entryName) {
  if (!entryName || entryName.includes("\\") || entryName.startsWith("/") || entryName.includes(":")) {
    fail("UNSAFE_PAYLOAD", "Update payload contains an unsafe path.");
  }
  const segments = entryName.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("UNSAFE_PAYLOAD", "Update payload contains an unsafe path.");
  }
  return segments;
}

async function extractClientArchive(archivePath, destinationDirectory, { fsApi = fs } = {}) {
  let inspectionZip;
  try {
    inspectionZip = await openZip(archivePath, { fsApi });
    const entries = await readZipEntries(inspectionZip);
    if (entries.length === 0 || entries.length > UPDATE_EXTRACTED_MAX_ENTRIES) {
      fail("UNSAFE_PAYLOAD", "Update payload entry count is invalid.");
    }
    const seenPaths = new Set();
    let totalBytes = 0;
    for (const entry of entries) {
      const directory = entry.fileName.endsWith("/");
      const rawName = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      const segments = safeZipPath(rawName);
      const normalized = segments.join("/").toLowerCase();
      if (seenPaths.has(normalized) || isZipSymlink(entry)) {
        fail("UNSAFE_PAYLOAD", "Update payload contains an unsafe entry.");
      }
      seenPaths.add(normalized);
      const destinationPath = path.join(destinationDirectory, ...segments);
      if (!destinationPath.startsWith(`${destinationDirectory}${path.sep}`)) {
        fail("UNSAFE_PAYLOAD", "Update payload escapes its staging directory.");
      }
      if (directory) {
        await fsApi.mkdir(destinationPath, { recursive: true });
        continue;
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > UPDATE_EXTRACTED_MAX_BYTES) {
        fail("UNSAFE_PAYLOAD", "Update payload exceeds its extraction limit.");
      }
      await fsApi.mkdir(path.dirname(destinationPath), { recursive: true });
      const output = await fsApi.open(destinationPath, "wx");
      try {
        let contentZip;
        try {
          contentZip = await openZip(archivePath, { fsApi });
          const currentEntries = await readZipEntries(contentZip);
          const currentEntry = currentEntries.find((candidate) => candidate.fileName === entry.fileName);
          if (!currentEntry) {
            fail("UNSAFE_PAYLOAD", "Update payload changed while being extracted.");
          }
          const input = await openEntryStream(contentZip, currentEntry);
          await consumeEntryStream(input, async (chunk) => {
            await output.write(chunk);
          });
        } finally {
          contentZip?.close();
        }
        await output.sync();
      } finally {
        await output.close();
      }
    }
  } finally {
    inspectionZip?.close();
  }
}

async function stageVerifiedClientUpdate(packagePath, stagingDirectory, options = {}) {
  const { fsApi = fs } = options;
  const manifest = await readAndVerifyManifest(packagePath, options);
  const resolvedStaging = path.resolve(stagingDirectory);
  await fsApi.mkdir(resolvedStaging, { recursive: false });
  const archivePath = path.join(resolvedStaging, "client.zip");
  const clientDirectory = path.join(resolvedStaging, "client");
  try {
    await copyPayload(packagePath, archivePath, manifest, { fsApi });
    await fsApi.mkdir(clientDirectory, { recursive: false });
    await extractClientArchive(archivePath, clientDirectory, { fsApi });
    const executablePath = path.join(clientDirectory, CLIENT_EXECUTABLE);
    const executableInfo = await fsApi.lstat(executablePath);
    const asarInfo = await fsApi.lstat(path.join(clientDirectory, "resources", "app.asar"));
    if (!executableInfo.isFile() || executableInfo.isSymbolicLink() || !asarInfo.isFile() || asarInfo.isSymbolicLink()) {
      fail("UNSAFE_PAYLOAD", "Update payload Client layout is invalid.");
    }
    return { manifest, clientDirectory, archivePath };
  } catch (error) {
    await fsApi.rm(resolvedStaging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  ClientUpdatePackageError,
  OUTER_ENTRY_NAMES,
  UPDATE_PACKAGE_EXTENSION,
  UPDATE_PACKAGE_FORMAT_VERSION,
  canonicalJson,
  normalizeManifest,
  readAndVerifyManifest,
  stageVerifiedClientUpdate,
};
