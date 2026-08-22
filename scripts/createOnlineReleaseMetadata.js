"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { readAndVerifyManifest } = require("../src/update/clientUpdatePackage");
const { loadProductionPrivateKey } = require("../src/update/productionTrust");
const {
  ONLINE_RELEASE_PRODUCT,
  ONLINE_RELEASE_PURPOSE,
  ONLINE_RELEASE_SCHEMA_VERSION,
  ONLINE_RELEASE_TARGET,
  assertOnlineArtifactUrl,
  onlineReleaseSignaturePayload,
} = require("../src/update/onlineRelease");

function usage() {
  return "Usage: node scripts/createOnlineReleaseMetadata.js --input <official.asrupdate> --output <latest.json> --artifact-url <immutable GitHub Releases URL> --key-id <production key ID> --private-key-file <external PEM> [--private-key-passphrase-file <external text file>]";
}

function readArguments(argumentsList) {
  const required = new Set(["--input", "--output", "--artifact-url", "--key-id", "--private-key-file"]);
  const expected = new Set([...required, "--private-key-passphrase-file"]);
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!expected.has(name) || !value || values[name]) {
      throw new Error(usage());
    }
    values[name] = value;
  }
  if (![...required].every((name) => values[name])) {
    throw new Error(usage());
  }
  return {
    input: path.resolve(values["--input"]),
    output: path.resolve(values["--output"]),
    artifactUrl: values["--artifact-url"],
    keyId: values["--key-id"],
    privateKeyFile: path.resolve(values["--private-key-file"]),
    privateKeyPassphraseFile: values["--private-key-passphrase-file"]
      ? path.resolve(values["--private-key-passphrase-file"])
      : undefined,
  };
}

async function assertNewOutput(outputPath) {
  try {
    await fs.lstat(outputPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error("Refusing to overwrite existing online release metadata.");
}

function signatureOutputPath(metadataOutputPath) {
  if (path.extname(metadataOutputPath).toLowerCase() !== ".json") {
    throw new Error("Online release metadata output must end with .json.");
  }
  return `${metadataOutputPath.slice(0, -".json".length)}.sig`;
}

async function createOnlineReleaseMetadata(argumentsList = process.argv.slice(2)) {
  const options = readArguments(argumentsList);
  await assertNewOutput(options.output);
  const signatureOutput = signatureOutputPath(options.output);
  await assertNewOutput(signatureOutput);
  assertOnlineArtifactUrl(options.artifactUrl);
  const [manifest, packageInfo, privateKey] = await Promise.all([
    readAndVerifyManifest(options.input),
    fs.stat(options.input),
    loadProductionPrivateKey(options),
  ]);
  const packageBytes = await fs.readFile(options.input);
  const metadata = {
    schemaVersion: ONLINE_RELEASE_SCHEMA_VERSION,
    purpose: ONLINE_RELEASE_PURPOSE,
    keyId: options.keyId,
    product: ONLINE_RELEASE_PRODUCT,
    target: ONLINE_RELEASE_TARGET,
    client: { version: manifest.client.version },
    artifact: {
      url: options.artifactUrl,
      sha256: crypto.createHash("sha256").update(packageBytes).digest("hex"),
      bytes: packageInfo.size,
    },
  };
  const signature = crypto.sign(null, onlineReleaseSignaturePayload(metadata), privateKey).toString("base64");
  try {
    await fs.writeFile(options.output, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.writeFile(signatureOutput, `${signature}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await fs.rm(options.output, { force: true }).catch(() => {});
    await fs.rm(signatureOutput, { force: true }).catch(() => {});
    throw error;
  }
  return { metadata, output: options.output, signatureOutput };
}

if (require.main === module) {
  createOnlineReleaseMetadata().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createOnlineReleaseMetadata, readArguments, signatureOutputPath };
