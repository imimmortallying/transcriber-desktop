"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { assertProductionSigningConfiguration } = require("../src/update/productionTrust");
const { ONLINE_RELEASE_REPOSITORY } = require("../src/update/onlineReleaseConfig");

const RELEASE_SIGNING_KEY_ID = "asr-prod-ed25519-e4cb8825e9276bf0";

function usage() {
  return "Usage: npm run release:client -- <numeric Client version>";
}

function readReleaseVersion(argumentsList) {
  if (argumentsList.length !== 1 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(argumentsList[0])) {
    throw new Error(usage());
  }
  return argumentsList[0];
}

function readSigningConfiguration(environment, projectRoot) {
  const privateKeyFile = environment.ASR_RELEASE_PRIVATE_KEY_FILE;
  const privateKeyPassphraseFile = environment.ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE;
  if (typeof privateKeyFile !== "string" || !privateKeyFile) {
    throw new Error("ASR_RELEASE_PRIVATE_KEY_FILE must name the external production private-key file.");
  }
  if (privateKeyPassphraseFile !== undefined && (typeof privateKeyPassphraseFile !== "string" || !privateKeyPassphraseFile)) {
    throw new Error("ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE must name the external passphrase file when set.");
  }
  return {
    keyId: RELEASE_SIGNING_KEY_ID,
    privateKeyFile: path.resolve(projectRoot, privateKeyFile),
    ...(privateKeyPassphraseFile === undefined
      ? {}
      : { privateKeyPassphraseFile: path.resolve(projectRoot, privateKeyPassphraseFile) }),
  };
}

function clientArtifactName(productName, version) {
  return `${productName}-client-${version}-win-x64.zip`;
}

function clientUpdatePackageName(productName, version) {
  return `${productName}-client-${version}-win-x64.asrupdate`;
}

function clientArtifactUrl(version, packageName) {
  return `https://github.com/${ONLINE_RELEASE_REPOSITORY}/releases/download/v${version}/${packageName}`;
}

function runCommand(command, argumentsList, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { cwd: options.cwd, shell: false, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

function npmInvocation(argumentsList, environment = process.env, platform = process.platform, nodeExecutable = process.execPath) {
  if (platform !== "win32") {
    return { command: "npm", argumentsList };
  }
  const npmCli = typeof environment.npm_execpath === "string" && environment.npm_execpath
    ? environment.npm_execpath
    : path.join(path.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js");
  return { command: nodeExecutable, argumentsList: [npmCli, ...argumentsList] };
}

async function assertAbsent(filePath, fsApi) {
  try {
    await fsApi.lstat(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Refusing to overwrite existing release output: ${filePath}`);
}

async function assertReleaseContents(directory, expectedFiles, fsApi) {
  const entries = await fsApi.readdir(directory, { withFileTypes: true });
  const actualFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const expected = [...expectedFiles].sort();
  if (entries.length !== expected.length || actualFiles.length !== expected.length
    || actualFiles.some((name, index) => name !== expected[index])) {
    throw new Error("Release output contains unexpected files.");
  }
}

function printReleaseInstructions(release, writeOutput) {
  writeOutput([
    `GitHub tag: v${release.version}`,
    `Release name: ASR Client v${release.version}`,
    "Upload:",
    ...release.files.map((filePath) => `  ${filePath}`),
  ].join("\n"));
}

async function releaseClient(argumentsList = process.argv.slice(2), options = {}) {
  const version = readReleaseVersion(argumentsList);
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..");
  const fsApi = options.fsApi || fs;
  const environment = options.environment || process.env;
  const run = options.run || runCommand;
  const validateSigning = options.validateSigning || assertProductionSigningConfiguration;
  const writeOutput = options.writeOutput || console.log;
  const packageMetadata = JSON.parse(await fsApi.readFile(path.join(projectRoot, "package.json"), "utf8"));
  const productName = packageMetadata.name;
  if (typeof productName !== "string" || !productName) {
    throw new Error("package.json must contain a product name.");
  }

  const signing = readSigningConfiguration(environment, projectRoot);
  await validateSigning(signing);

  const distributionDirectory = path.join(projectRoot, "dist");
  const releaseDirectory = path.join(distributionDirectory, `release-${version}`);
  await assertAbsent(releaseDirectory, fsApi);
  await fsApi.mkdir(distributionDirectory, { recursive: true });

  const npmVersion = npmInvocation(["version", version, "--no-git-tag-version", "--allow-same-version"], environment);
  await run(npmVersion.command, npmVersion.argumentsList, { cwd: projectRoot });

  const stagingDirectory = await fsApi.mkdtemp(path.join(distributionDirectory, `.release-${version}-`));
  const artifactName = clientArtifactName(productName, version);
  const updatePackageName = clientUpdatePackageName(productName, version);
  const updatePackagePath = path.join(stagingDirectory, updatePackageName);
  const metadataPath = path.join(stagingDirectory, "latest.json");
  const metadataSignaturePath = path.join(stagingDirectory, "latest.sig");
  try {
    const clientBuild = npmInvocation(["run", "dist:client"], environment);
    await run(clientBuild.command, clientBuild.argumentsList, { cwd: projectRoot });
    await run(process.execPath, [
      path.join(projectRoot, "scripts", "createClientUpdatePackage.js"),
      "--input", path.join(distributionDirectory, artifactName),
      "--output", updatePackagePath,
      "--version", version,
      "--key-id", signing.keyId,
      "--private-key-file", signing.privateKeyFile,
      ...(signing.privateKeyPassphraseFile ? ["--private-key-passphrase-file", signing.privateKeyPassphraseFile] : []),
    ], { cwd: projectRoot });
    await run(process.execPath, [
      path.join(projectRoot, "scripts", "createOnlineReleaseMetadata.js"),
      "--input", updatePackagePath,
      "--output", metadataPath,
      "--artifact-url", clientArtifactUrl(version, updatePackageName),
      "--key-id", signing.keyId,
      "--private-key-file", signing.privateKeyFile,
      ...(signing.privateKeyPassphraseFile ? ["--private-key-passphrase-file", signing.privateKeyPassphraseFile] : []),
    ], { cwd: projectRoot });
    await assertReleaseContents(stagingDirectory, [updatePackageName, "latest.json", "latest.sig"], fsApi);
    await fsApi.rename(stagingDirectory, releaseDirectory);
  } catch (error) {
    await fsApi.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const release = { version, directory: releaseDirectory, files: [updatePackagePath, metadataPath, metadataSignaturePath].map((filePath) => path.join(releaseDirectory, path.basename(filePath))) };
  printReleaseInstructions(release, writeOutput);
  return release;
}

if (require.main === module) {
  releaseClient().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  RELEASE_SIGNING_KEY_ID,
  assertReleaseContents,
  clientArtifactName,
  clientArtifactUrl,
  clientUpdatePackageName,
  npmInvocation,
  readReleaseVersion,
  readSigningConfiguration,
  releaseClient,
  runCommand,
};
