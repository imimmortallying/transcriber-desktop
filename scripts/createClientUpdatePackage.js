"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { path7za } = require("7zip-bin");
const { RUNTIME_API_VERSION } = require("../src/runtime/resolveRuntime");
const {
  UPDATE_PACKAGE_FORMAT_VERSION,
  canonicalJson,
  stageVerifiedClientUpdate,
} = require("../src/update/clientUpdatePackage");
const { PRODUCTION_TRUSTED_SIGNERS } = require("../src/update/productionTrust");
const { validateClientKey } = require("../src/update/installationState");

function usage() {
  return "Usage: node scripts/createClientUpdatePackage.js --input <Client ZIP> --output <package.asrupdate> --version <Client version> --key-id <production key ID> --private-key-file <external PEM> [--private-key-passphrase-file <external text file>]";
}

function readArguments(argumentsList) {
  const required = new Set(["--input", "--output", "--version", "--key-id", "--private-key-file"]);
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
    version: validateClientKey(values["--version"]),
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
  throw new Error("Refusing to overwrite an existing update package.");
}

function archive(directory, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(path7za, ["a", "-tzip", "-mx=1", outputPath, "manifest.json", "manifest.sig", "client.zip"], {
      cwd: directory,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`7za exited with code ${code}.`));
    });
  });
}

async function createClientUpdatePackage(argumentsList = process.argv.slice(2)) {
  const options = readArguments(argumentsList);
  const signer = PRODUCTION_TRUSTED_SIGNERS[options.keyId];
  if (!signer) {
    throw new Error("The key ID is not a pinned production signing key.");
  }
  await assertNewOutput(options.output);
  const [payload, privateKeyPem, rawPassphrase] = await Promise.all([
    fs.readFile(options.input),
    fs.readFile(options.privateKeyFile, "utf8"),
    options.privateKeyPassphraseFile ? fs.readFile(options.privateKeyPassphraseFile, "utf8") : undefined,
  ]);
  const privateKey = crypto.createPrivateKey({
    key: privateKeyPem,
    format: "pem",
    type: "pkcs8",
    ...(rawPassphrase === undefined ? {} : { passphrase: rawPassphrase.replace(/\r?\n$/, "") }),
  });
  const derivedPublicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  if (derivedPublicKey !== signer.publicKeyPem) {
    throw new Error("The supplied private key does not match the pinned production signing key.");
  }
  const manifest = {
    formatVersion: UPDATE_PACKAGE_FORMAT_VERSION,
    keyId: options.keyId,
    client: { version: options.version, runtimeApiVersion: RUNTIME_API_VERSION },
    payload: {
      file: "client.zip",
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
      bytes: payload.length,
    },
  };
  const signature = crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), privateKey).toString("base64");
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "asr-update-package-"));
  const stagedOutput = path.join(temporaryDirectory, path.basename(options.output));
  try {
    await Promise.all([
      fs.copyFile(options.input, path.join(temporaryDirectory, "client.zip")),
      fs.writeFile(path.join(temporaryDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      fs.writeFile(path.join(temporaryDirectory, "manifest.sig"), `${signature}\n`, "utf8"),
    ]);
    await archive(temporaryDirectory, stagedOutput);
    const verified = await stageVerifiedClientUpdate(
      stagedOutput,
      path.join(temporaryDirectory, "verified"),
    );
    if (canonicalJson(verified.manifest) !== canonicalJson(manifest)) {
      throw new Error("The generated update package did not retain its signed manifest.");
    }
    await fs.rename(stagedOutput, options.output);
    return { output: options.output, manifest };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  createClientUpdatePackage().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createClientUpdatePackage, readArguments };
