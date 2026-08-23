"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { assertProductionSigningConfiguration } = require("../src/update/productionTrust");
const { cleanDist } = require("./cleanDist");
const {
  assertAbsent,
  assertReleaseContents,
  createClientReleaseArtifacts,
  npmInvocation,
  readReleaseVersion,
  readSigningConfiguration,
  runCommand,
} = require("./releaseClient");

function usage() {
  return "Usage: npm run release:public -- <numeric public release version>";
}

function fullSetupArtifactName(productName, version) {
  return `${productName} Setup ${version}.exe`;
}

async function copyVerifiedFullSetup(source, destination, fsApi = fs) {
  const info = await fsApi.lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1) {
    throw new Error("Full Setup build did not produce a safe installer artifact.");
  }
  await fsApi.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
}

function printPublicReleaseInstructions(release, writeOutput) {
  const [fullSetup, updatePackage, latestJson, latestSignature] = release.files;
  writeOutput([
    `GitHub tag: v${release.version}`,
    `Release name: ASR v${release.version}`,
    `New/offline installation: ${fullSetup}`,
    "Existing Client updater and discovery assets:",
    `  ${updatePackage}`,
    `  ${latestJson}`,
    `  ${latestSignature}`,
  ].join("\n"));
}

async function releasePublic(argumentsList = process.argv.slice(2), options = {}) {
  if (argumentsList.length !== 1) {
    throw new Error(usage());
  }
  let version;
  try {
    version = readReleaseVersion(argumentsList);
  } catch {
    throw new Error(usage());
  }
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
  await cleanDist({ projectRoot, fsApi });

  const npmVersion = npmInvocation(["version", version, "--no-git-tag-version", "--allow-same-version"], environment);
  await run(npmVersion.command, npmVersion.argumentsList, { cwd: projectRoot });

  const stagingDirectory = await fsApi.mkdtemp(path.join(distributionDirectory, `.release-${version}-`));
  const fullSetupName = fullSetupArtifactName(productName, version);
  const stagedFullSetup = path.join(stagingDirectory, fullSetupName);
  try {
    const artifacts = await createClientReleaseArtifacts({
      version,
      productName,
      projectRoot,
      distributionDirectory,
      outputDirectory: stagingDirectory,
      environment,
      signing,
      run,
    });
    const fullSetupBuild = npmInvocation(["run", "dist:win"], environment);
    await run(fullSetupBuild.command, fullSetupBuild.argumentsList, { cwd: projectRoot });
    await copyVerifiedFullSetup(path.join(distributionDirectory, fullSetupName), stagedFullSetup, fsApi);
    await assertReleaseContents(stagingDirectory, [fullSetupName, artifacts.updatePackageName, "latest.json", "latest.sig"], fsApi);
    await fsApi.rename(stagingDirectory, releaseDirectory);
    const release = {
      version,
      directory: releaseDirectory,
      files: [stagedFullSetup, ...artifacts.files].map((filePath) => path.join(releaseDirectory, path.basename(filePath))),
    };
    printPublicReleaseInstructions(release, writeOutput);
    return release;
  } catch (error) {
    await fsApi.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  releasePublic().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  copyVerifiedFullSetup,
  fullSetupArtifactName,
  printPublicReleaseInstructions,
  releasePublic,
  usage,
};
