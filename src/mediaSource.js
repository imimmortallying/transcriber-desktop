const path = require("node:path");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { getMediaKind, getPlaybackMimeType } = require("./mediaSelection");

const SOURCE_MEDIA_SCHEMA_VERSION = 1;

function finiteInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function sourceFileState(fileInfo) {
  if (!fileInfo?.isFile?.() || !finiteInteger(fileInfo.size) || !Number.isFinite(fileInfo.mtimeMs)) {
    return null;
  }
  return {
    sizeBytes: fileInfo.size,
    modifiedAtMs: fileInfo.mtimeMs,
    fileSystem: finiteInteger(fileInfo.dev) && finiteInteger(fileInfo.ino) && fileInfo.ino !== 0
      ? { device: String(fileInfo.dev), file: String(fileInfo.ino) }
      : null,
  };
}

function hasMatchingFileState(left, right) {
  return Boolean(left && right)
    && left.sizeBytes === right.sizeBytes
    && left.modifiedAtMs === right.modifiedAtMs
    && JSON.stringify(left.fileSystem) === JSON.stringify(right.fileSystem);
}

function hashFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function createSourceMediaMetadata(inputPath, { statFile = stat, hashFile = hashFileSha256 } = {}) {
  if (typeof inputPath !== "string" || !inputPath) {
    throw new Error("Исходный media-файл недоступен.");
  }

  const sourcePath = path.resolve(inputPath);
  const beforeHash = sourceFileState(await statFile(sourcePath));
  if (!beforeHash) {
    throw new Error("Не удалось определить identity исходного media-файла.");
  }
  const sha256 = await hashFile(sourcePath);
  const afterHash = sourceFileState(await statFile(sourcePath));
  if (!hasMatchingFileState(beforeHash, afterHash)) {
    throw new Error("Исходный media-файл изменился во время проверки identity.");
  }

  return {
    schemaVersion: SOURCE_MEDIA_SCHEMA_VERSION,
    sourcePath,
    sourceName: path.basename(sourcePath),
    sourceKind: getMediaKind(sourcePath),
    sourceMimeType: getPlaybackMimeType(sourcePath),
    identity: {
      sizeBytes: beforeHash.sizeBytes,
      sha256,
    },
  };
}

function isSourceMediaMetadata(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && value.schemaVersion === SOURCE_MEDIA_SCHEMA_VERSION
    && typeof value.sourcePath === "string"
    && path.isAbsolute(value.sourcePath)
    && typeof value.sourceName === "string"
    && ["audio", "video", "unknown"].includes(value.sourceKind)
    && typeof value.sourceMimeType === "string"
    && value.identity
    && finiteInteger(value.identity.sizeBytes)
    && typeof value.identity.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(value.identity.sha256);
}

async function hasMatchingIdentity(metadata, filePath, fileInfo, hashFile) {
  return metadata.identity.sizeBytes === fileInfo.size
    && metadata.identity.sha256 === await hashFile(filePath);
}

async function validateSourceMedia(metadata, { statFile = stat, hashFile = hashFileSha256 } = {}) {
  if (!isSourceMediaMetadata(metadata)) {
    return { status: "unavailable" };
  }

  let fileInfo;
  try {
    fileInfo = await statFile(metadata.sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }

  if (!fileInfo.isFile()) {
    return { status: "missing" };
  }
  if (!await hasMatchingIdentity(metadata, metadata.sourcePath, fileInfo, hashFile)) {
    return { status: "mismatch" };
  }
  return {
    status: "available",
    filePath: metadata.sourcePath,
    sourceKind: metadata.sourceKind,
    fileState: sourceFileState(fileInfo),
  };
}

async function validateRelinkedSource(metadata, inputPath, { statFile = stat, hashFile = hashFileSha256 } = {}) {
  if (!isSourceMediaMetadata(metadata) || typeof inputPath !== "string" || !inputPath) {
    return { status: "unavailable" };
  }

  let fileInfo;
  try {
    fileInfo = await statFile(inputPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }

  if (!fileInfo.isFile()) {
    return { status: "missing" };
  }
  if (!await hasMatchingIdentity(metadata, inputPath, fileInfo, hashFile)) {
    return { status: "mismatch" };
  }
  return {
    status: "available",
    filePath: path.resolve(inputPath),
    sourceKind: metadata.sourceKind,
    fileState: sourceFileState(fileInfo),
  };
}

async function validateAuthorizedSource(metadata, expectedFileState, { statFile = stat, hashFile = hashFileSha256 } = {}) {
  if (!isSourceMediaMetadata(metadata)) {
    return { status: "unavailable" };
  }

  let fileInfo;
  try {
    fileInfo = await statFile(metadata.sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }

  const fileState = sourceFileState(fileInfo);
  if (!fileState) {
    return { status: "missing" };
  }
  if (hasMatchingFileState(expectedFileState, fileState)) {
    return { status: "available", filePath: metadata.sourcePath, sourceKind: metadata.sourceKind, fileState };
  }
  return validateSourceMedia(metadata, { statFile: async () => fileInfo, hashFile });
}

module.exports = {
  SOURCE_MEDIA_SCHEMA_VERSION,
  createSourceMediaMetadata,
  hashFileSha256,
  hasMatchingIdentity,
  isSourceMediaMetadata,
  validateAuthorizedSource,
  validateRelinkedSource,
  validateSourceMedia,
};
