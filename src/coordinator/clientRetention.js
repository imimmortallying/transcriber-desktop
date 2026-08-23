const fs = require("node:fs/promises");
const path = require("node:path");
const { CLIENT_EXECUTABLE, validateClientKey } = require("../update/installationState");

function isContainedOrEqual(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function protectedClientVersions(state) {
  const versions = new Set([
    validateClientKey(state.activeClient.version),
    validateClientKey(state.knownGoodClient.version),
  ]);
  if (state.schemaVersion === 2 && state.updateTransaction !== null) {
    versions.add(validateClientKey(state.updateTransaction.candidateClient.version));
  }
  return versions;
}

function isSafeDirectory(info) {
  return info.isDirectory() && !info.isSymbolicLink();
}

function isSafeFile(info) {
  return info.isFile() && !info.isSymbolicLink();
}

async function inspectClientsDirectory(installationRoot, fsApi) {
  const rootPath = path.resolve(installationRoot);
  const clientsPath = path.join(rootPath, "Clients");
  const [rootInfo, clientsInfo] = await Promise.all([
    fsApi.lstat(rootPath),
    fsApi.lstat(clientsPath),
  ]);
  if (!isSafeDirectory(rootInfo) || !isSafeDirectory(clientsInfo)) {
    throw new Error("Client retention requires ordinary installation and Clients directories.");
  }
  const [realRoot, realClients] = await Promise.all([
    fsApi.realpath(rootPath),
    fsApi.realpath(clientsPath),
  ]);
  if (path.dirname(realClients) !== realRoot) {
    throw new Error("Clients directory escapes the installation root.");
  }
  return { clientsPath, realClients };
}

async function inspectOwnedClientDirectory(clientsPath, realClients, version, fsApi) {
  const clientPath = path.join(clientsPath, version);
  const executablePath = path.join(clientPath, CLIENT_EXECUTABLE);
  const clientInfo = await fsApi.lstat(clientPath);
  if (!isSafeDirectory(clientInfo)) {
    throw new Error("Client directory has an unsafe filesystem type.");
  }
  const realClient = await fsApi.realpath(clientPath);
  if (path.dirname(realClient) !== realClients) {
    throw new Error("Client directory escapes the installation-owned Clients directory.");
  }
  const entries = await fsApi.readdir(clientPath, { withFileTypes: true });
  if (entries.length === 0) {
    return { clientPath, realClient };
  }
  const executableInfo = await fsApi.lstat(executablePath);
  if (!isSafeFile(executableInfo)) {
    throw new Error("Client directory has an unsafe filesystem type.");
  }
  const realExecutable = await fsApi.realpath(executablePath);
  if (path.dirname(realExecutable) !== realClient) {
    throw new Error("Client executable escapes the installation-owned Client directory.");
  }
  return { clientPath, realClient };
}

async function collectSafeClientTree(directoryPath, realClientPath, fsApi, files, directories) {
  const [directoryInfo, realDirectory] = await Promise.all([
    fsApi.lstat(directoryPath),
    fsApi.realpath(directoryPath),
  ]);
  if (!isSafeDirectory(directoryInfo) || !isContainedOrEqual(realClientPath, realDirectory)) {
    throw new Error("Client directory contains an unsafe path.");
  }
  const entries = await fsApi.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    const entryInfo = await fsApi.lstat(entryPath);
    if (isSafeDirectory(entryInfo)) {
      await collectSafeClientTree(entryPath, realClientPath, fsApi, files, directories);
      continue;
    }
    if (!isSafeFile(entryInfo)) {
      throw new Error("Client directory contains a reparse point or foreign filesystem object.");
    }
    const realFile = await fsApi.realpath(entryPath);
    if (!isContainedOrEqual(realClientPath, realFile)) {
      throw new Error("Client file escapes the Client directory.");
    }
    files.push(entryPath);
  }
  directories.push(directoryPath);
}

async function removeOwnedClientDirectory(client, fsApi) {
  const files = [];
  const directories = [];
  await collectSafeClientTree(client.clientPath, client.realClient, fsApi, files, directories);
  for (const filePath of files) {
    const info = await fsApi.lstat(filePath);
    if (!isSafeFile(info)) {
      throw new Error("Client file changed to an unsafe filesystem type.");
    }
    await fsApi.unlink(filePath);
  }
  for (const directoryPath of directories) {
    const info = await fsApi.lstat(directoryPath);
    if (!isSafeDirectory(info)) {
      throw new Error("Client directory changed to an unsafe filesystem type.");
    }
    await fsApi.rmdir(directoryPath);
  }
}

async function cleanupObsoleteClientDirectories(installationRoot, state, { fsApi = fs } = {}) {
  const removed = [];
  const skipped = [];
  let clients;
  let protectedVersions;
  try {
    clients = await inspectClientsDirectory(installationRoot, fsApi);
    protectedVersions = protectedClientVersions(state);
  } catch {
    return { removed, skipped };
  }

  let entries;
  try {
    entries = await fsApi.readdir(clients.clientsPath, { withFileTypes: true });
  } catch {
    return { removed, skipped };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    let version;
    try {
      version = validateClientKey(entry.name);
    } catch {
      continue;
    }
    if (protectedVersions.has(version)) {
      continue;
    }
    try {
      const client = await inspectOwnedClientDirectory(clients.clientsPath, clients.realClients, version, fsApi);
      await removeOwnedClientDirectory(client, fsApi);
      removed.push(version);
    } catch {
      skipped.push(version);
    }
  }
  return { removed, skipped };
}

module.exports = {
  cleanupObsoleteClientDirectories,
  protectedClientVersions,
};
