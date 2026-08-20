const { lstat, readFile, realpath, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const workspacePrefix = "asr-full-setup-e2e-";
const sentinelFileName = ".asr-full-setup-e2e-sentinel";

function isStrictlyContained(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function getSentinelPath(workspace) {
  return path.join(workspace, sentinelFileName);
}

async function verifyOwnedWorkspace({ workspace, nonce, tempDirectory = os.tmpdir() }) {
  if (typeof workspace !== "string" || typeof nonce !== "string" || !nonce) {
    throw new Error("E2E workspace ownership inputs are invalid.");
  }

  const absoluteWorkspace = path.resolve(workspace);
  const canonicalTempDirectory = await realpath(path.resolve(tempDirectory));
  const workspaceInfo = await lstat(absoluteWorkspace);
  if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink()) {
    throw new Error("E2E workspace is not a regular directory.");
  }

  const canonicalWorkspace = await realpath(absoluteWorkspace);
  if (!samePath(absoluteWorkspace, canonicalWorkspace)) {
    throw new Error("E2E workspace resolves through filesystem indirection.");
  }
  if (!isStrictlyContained(canonicalTempDirectory, canonicalWorkspace)) {
    throw new Error("E2E workspace is outside the canonical system temp directory.");
  }
  if (!path.basename(canonicalWorkspace).startsWith(workspacePrefix)) {
    throw new Error("E2E workspace does not have the expected per-run prefix.");
  }

  const sentinelPath = getSentinelPath(canonicalWorkspace);
  const sentinelInfo = await lstat(sentinelPath);
  if (!sentinelInfo.isFile() || sentinelInfo.isSymbolicLink()) {
    throw new Error("E2E workspace sentinel is not a regular file.");
  }
  if ((await readFile(sentinelPath, "utf8")) !== `${nonce}\n`) {
    throw new Error("E2E workspace sentinel does not match this run.");
  }

  return canonicalWorkspace;
}

async function cleanupOwnedWorkspace({ workspace, nonce, tempDirectory }) {
  const canonicalWorkspace = await verifyOwnedWorkspace({ workspace, nonce, tempDirectory });
  await rm(canonicalWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

module.exports = { cleanupOwnedWorkspace, getSentinelPath, verifyOwnedWorkspace };
