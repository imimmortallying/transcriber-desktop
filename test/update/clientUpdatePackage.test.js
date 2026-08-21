const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { path7za } = require("7zip-bin");
const {
  ClientUpdatePackageError,
  canonicalJson,
  readAndVerifyManifest,
  stageVerifiedClientUpdate,
} = require("../../src/update/clientUpdatePackage");
const { TEST_KEY_ID, TEST_PRIVATE_KEY, TEST_TRUSTED_SIGNERS } = require("./testSigning");

function archive(directory, outputPath, files) {
  return new Promise((resolve, reject) => {
    const child = spawn(path7za, ["a", "-tzip", "-mx=1", outputPath, ...files], {
      cwd: directory,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`7za exited with code ${code}.`)));
  });
}

async function withTemporaryDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "asr-update-package-test-"));
  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function createPackage(directory, { payload = "payload", payloadHash, keyId = TEST_KEY_ID, signature } = {}) {
  const payloadSource = path.join(directory, "client-source");
  await fs.mkdir(path.join(payloadSource, "resources"), { recursive: true });
  await fs.writeFile(path.join(payloadSource, "local-asr-prototype.exe"), "test executable");
  await fs.writeFile(path.join(payloadSource, "resources", "app.asar"), "test asar");
  const clientZip = path.join(directory, "client.zip");
  await archive(payloadSource, clientZip, ["local-asr-prototype.exe", "resources/app.asar"]);
  if (payload !== "payload") {
    await fs.writeFile(clientZip, payload);
  }
  const clientZipBytes = await fs.readFile(clientZip);
  const manifest = {
    formatVersion: 1,
    keyId,
    client: { version: "0.2.0", runtimeApiVersion: 1 },
    payload: {
      file: "client.zip",
      sha256: payloadHash || crypto.createHash("sha256").update(clientZipBytes).digest("hex"),
      bytes: clientZipBytes.length,
    },
  };
  const signed = signature || crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), TEST_PRIVATE_KEY).toString("base64");
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(directory, "manifest.sig"), signed);
  const packagePath = path.join(directory, "candidate.asrupdate");
  await archive(directory, packagePath, ["manifest.json", "manifest.sig", "client.zip"]);
  return { packagePath, manifest };
}

test("signed test package stages only after signature and payload verification", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { packagePath, manifest } = await createPackage(directory);
    assert.deepEqual(
      await readAndVerifyManifest(packagePath, { trustedSigners: TEST_TRUSTED_SIGNERS }),
      manifest,
    );
    const staged = await stageVerifiedClientUpdate(packagePath, path.join(directory, "staging"), {
      trustedSigners: TEST_TRUSTED_SIGNERS,
    });
    assert.equal(staged.manifest.client.version, "0.2.0");
    await assert.doesNotReject(fs.lstat(path.join(staged.clientDirectory, "local-asr-prototype.exe")));
    await assert.doesNotReject(fs.lstat(path.join(staged.clientDirectory, "resources", "app.asar")));
  });
});

test("production trust does not accept the separate test signing root", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { packagePath } = await createPackage(directory);
    await assert.rejects(
      readAndVerifyManifest(packagePath),
      (error) => error instanceof ClientUpdatePackageError && error.code === "UNTRUSTED_SIGNER",
    );
  });
});

test("payload mismatch rejects and removes the staging directory", async () => {
  await withTemporaryDirectory(async (directory) => {
    const { packagePath } = await createPackage(directory, { payloadHash: "0".repeat(64) });
    const stagingDirectory = path.join(directory, "staging");
    await assert.rejects(
      stageVerifiedClientUpdate(packagePath, stagingDirectory, { trustedSigners: TEST_TRUSTED_SIGNERS }),
      (error) => error instanceof ClientUpdatePackageError && error.code === "PAYLOAD_HASH_MISMATCH",
    );
    await assert.rejects(fs.lstat(stagingDirectory), { code: "ENOENT" });
  });
});

module.exports = { TEST_KEY_ID, TEST_PRIVATE_KEY, TEST_TRUSTED_SIGNERS };
