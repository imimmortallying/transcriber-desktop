"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const RELEASE_DIRECTORY_NAME = /^release-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function isReleaseDirectoryName(name) {
  return RELEASE_DIRECTORY_NAME.test(name);
}

function isSafeDirectory(info) {
  return info.isDirectory() && !info.isSymbolicLink();
}

async function inspectCanonicalDist(projectRoot, fsApi) {
  const rootPath = path.resolve(projectRoot);
  const distPath = path.join(rootPath, "dist");
  const rootInfo = await fsApi.lstat(rootPath);
  if (!isSafeDirectory(rootInfo)) {
    throw new Error("Project root is not a safe directory.");
  }
  let distInfo;
  try {
    distInfo = await fsApi.lstat(distPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!isSafeDirectory(distInfo)) {
    throw new Error("Project dist directory is not a safe directory.");
  }
  const [realRoot, realDist] = await Promise.all([fsApi.realpath(rootPath), fsApi.realpath(distPath)]);
  if (path.dirname(realDist) !== realRoot) {
    throw new Error("Project dist directory escapes the canonical project root.");
  }
  return { distPath, realDist };
}

async function cleanDist({ projectRoot = path.resolve(__dirname, ".."), fsApi = fs } = {}) {
  const dist = await inspectCanonicalDist(projectRoot, fsApi);
  const result = { preserved: [], removed: [] };
  if (!dist) {
    return result;
  }

  const entries = await fsApi.readdir(dist.distPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dist.distPath, entry.name);
    if (path.dirname(entryPath) !== dist.distPath) {
      throw new Error("Dist cleanup encountered a non-direct child path.");
    }
    const entryInfo = await fsApi.lstat(entryPath);
    if (isReleaseDirectoryName(entry.name) && isSafeDirectory(entryInfo)) {
      result.preserved.push(entry.name);
      continue;
    }
    if (entryInfo.isSymbolicLink() || (!entryInfo.isFile() && !entryInfo.isDirectory())) {
      throw new Error(`Dist cleanup refuses unsafe workspace entry: ${entry.name}`);
    }
    await fsApi.rm(entryPath, { recursive: entryInfo.isDirectory(), force: false, maxRetries: 3, retryDelay: 100 });
    result.removed.push(entry.name);
  }
  result.preserved.sort();
  result.removed.sort();
  return result;
}

if (require.main === module) {
  cleanDist().then(
    ({ preserved, removed }) => console.log(`dist cleanup removed ${removed.length} workspace entries and preserved ${preserved.length} release directories.`),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}

module.exports = { cleanDist, inspectCanonicalDist, isReleaseDirectoryName };
