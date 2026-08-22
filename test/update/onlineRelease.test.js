"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
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
const {
  ONLINE_RELEASE_PRODUCT,
  ONLINE_RELEASE_PURPOSE,
  ONLINE_RELEASE_SCHEMA_VERSION,
  ONLINE_RELEASE_TARGET,
  OnlineReleaseError,
  assertOnlineArtifactUrl,
  assertMetadataDiscoveryUrl,
  checkForOnlineUpdate,
  compareClientVersions,
  downloadOnlineUpdate,
  onlineReleaseSignaturePayload,
  verifyOnlineReleaseMetadata,
} = require("../../src/update/onlineRelease");
const { TEST_KEY_ID, TEST_PRIVATE_KEY, TEST_TRUSTED_SIGNERS } = require("./testSigning");
const { DEFAULT_ONLINE_RELEASE_METADATA_URL } = require("../../src/update/onlineReleaseConfig");

async function withTemporaryDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "asr-online-release-test-"));
  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function createOnlineUpdateTemporaryDirectory(parentDirectory) {
  return fs.mkdtemp(path.join(parentDirectory, "asr-online-update-"));
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function signedMetadata(baseUrl, artifact, version = "0.2.0") {
  const metadata = {
    schemaVersion: ONLINE_RELEASE_SCHEMA_VERSION,
    purpose: ONLINE_RELEASE_PURPOSE,
    keyId: TEST_KEY_ID,
    product: ONLINE_RELEASE_PRODUCT,
    target: ONLINE_RELEASE_TARGET,
    client: { version },
    artifact: {
      url: `${baseUrl}/artifact.asrupdate`,
      sha256: crypto.createHash("sha256").update(artifact).digest("hex"),
      bytes: artifact.length,
    },
  };
  return {
    metadata,
    signature: crypto.sign(null, onlineReleaseSignaturePayload(metadata), TEST_PRIVATE_KEY).toString("base64"),
  };
}

const testRequestOptions = { trustedSigners: TEST_TRUSTED_SIGNERS, request: http.request, allowHttpForTests: true };

test("production Client contains the stable public distribution metadata endpoint", () => {
  assert.equal(
    DEFAULT_ONLINE_RELEASE_METADATA_URL,
    "https://github.com/imimmortallying/asr-desktop-releases/releases/latest/download/latest.json",
  );
});

test("metadata discovery accepts only the GitHub latest metadata asset form", () => {
  assert.doesNotThrow(() => assertMetadataDiscoveryUrl(DEFAULT_ONLINE_RELEASE_METADATA_URL));
  for (const url of [
    "https://github.com/imimmortallying/asr-desktop-releases/releases/download/v0.1.2/latest.json",
    "https://github.com/imimmortallying/asr-desktop-releases/releases/latest/download/not-latest.json",
    "https://github.com/imimmortallying/asr-desktop-releases/releases/download/latest/latest.json",
    "https://github.com/imimmortallying/asr-desktop-releases/releases/latest/download/latest.json?next=1",
    "https://example.test/imimmortallying/asr-desktop-releases/releases/latest/download/latest.json",
  ]) {
    assert.throws(() => assertMetadataDiscoveryUrl(url), (error) => error instanceof OnlineReleaseError);
  }
});

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

async function createSignedTestPackage(directory) {
  const clientDirectory = path.join(directory, "client-source");
  await fs.mkdir(path.join(clientDirectory, "resources"), { recursive: true });
  await fs.writeFile(path.join(clientDirectory, "local-asr-prototype.exe"), "test executable");
  await fs.writeFile(path.join(clientDirectory, "resources", "app.asar"), "test asar");
  const clientZip = path.join(directory, "client.zip");
  await archive(clientDirectory, clientZip, ["local-asr-prototype.exe", "resources/app.asar"]);
  const payload = await fs.readFile(clientZip);
  const manifest = {
    formatVersion: 1,
    keyId: TEST_KEY_ID,
    client: { version: "0.2.0", runtimeApiVersion: 1 },
    payload: {
      file: "client.zip",
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
      bytes: payload.length,
    },
  };
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(directory, "manifest.sig"), crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), TEST_PRIVATE_KEY).toString("base64"));
  const packagePath = path.join(directory, "candidate.asrupdate");
  await archive(directory, packagePath, ["manifest.json", "manifest.sig", "client.zip"]);
  return packagePath;
}

test("signed online metadata recognizes only newer Client versions", async () => {
  await withServer((_request, response) => response.end(), async (baseUrl) => {
    const release = signedMetadata(baseUrl, Buffer.from("artifact"));
    assert.equal(verifyOnlineReleaseMetadata(release.metadata, release.signature, testRequestOptions).client.version, "0.2.0");
    assert.equal(compareClientVersions("0.2.0", "0.1.9"), 1);
    assert.equal(compareClientVersions("0.2.0", "0.2.0"), 0);
    assert.equal(compareClientVersions("0.1.9", "0.2.0"), -1);
  });
});

test("online metadata rejects tampering, wrong identity and package-protocol signatures", async () => {
  await withServer((_request, response) => response.end(), async (baseUrl) => {
    const release = signedMetadata(baseUrl, Buffer.from("artifact"));
    for (const [changed, signature] of [
      [{ ...release.metadata, product: "other-product" }, release.signature],
      [{ ...release.metadata, target: "linux-x64" }, release.signature],
      [{ ...release.metadata, schemaVersion: 2 }, release.signature],
      [{ ...release.metadata, client: { version: "9.9.9" } }, release.signature],
      [release.metadata, crypto.sign(null, Buffer.from("not an online metadata signature"), TEST_PRIVATE_KEY).toString("base64")],
    ]) {
      assert.throws(
        () => verifyOnlineReleaseMetadata(changed, signature, testRequestOptions),
        (error) => error instanceof OnlineReleaseError,
      );
    }
  });
});

test("production artifact URL is limited to immutable GitHub Releases assets", () => {
  assert.doesNotThrow(() => assertOnlineArtifactUrl("https://github.com/example/asr/releases/download/v0.2.0/client.asrupdate"));
  for (const url of [
    "https://github.com/example/asr/releases/latest/download/latest.json",
    "https://github.com/example/asr/releases/download/latest/client.asrupdate",
    "https://github.com/example/asr/releases/download/0.2.0/client.asrupdate",
    "https://github.com/example/asr/releases/download/v0.2.0/client.zip",
    "https://example.test/client.asrupdate",
    "http://github.com/example/asr/releases/download/v0.2.0/client.asrupdate",
  ]) {
    assert.throws(() => assertOnlineArtifactUrl(url), (error) => error instanceof OnlineReleaseError);
  }
});

test("explicit metadata check reports newer, same and older release without touching an artifact", async () => {
  let release;
  let artifactRequested = false;
  await withServer((request, response) => {
    if (request.url === "/latest.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(release.metadata));
      return;
    }
    if (request.url === "/latest.sig") {
      response.end(release.signature);
      return;
    }
    artifactRequested = true;
    response.statusCode = 500;
    response.end();
  }, async (baseUrl) => {
    const artifact = Buffer.from("artifact");
    for (const [remoteVersion, installedVersion, expected] of [["0.2.0", "0.1.0", true], ["0.1.0", "0.1.0", false], ["0.0.9", "0.1.0", false]]) {
      release = signedMetadata(baseUrl, artifact, remoteVersion);
      const result = await checkForOnlineUpdate({ installedVersion, metadataUrl: `${baseUrl}/latest.json`, ...testRequestOptions });
      assert.equal(result.available, expected);
    }
    assert.equal(artifactRequested, false);
  });
});

test("unavailable, oversized and interrupted online responses fail without completed artifacts", async () => {
  await withTemporaryDirectory(async (directory) => {
    await assert.rejects(
      checkForOnlineUpdate({ installedVersion: "0.1.0", metadataUrl: "http://127.0.0.1:1/latest.json", ...testRequestOptions }),
      (error) => error instanceof OnlineReleaseError && error.code === "ONLINE_NETWORK_FAILURE",
    );

    let release;
    await withServer((request, response) => {
      if (request.url === "/latest.json") {
        response.setHeader("content-length", "65537");
        response.end("x");
        return;
      }
      if (request.url === "/latest.sig") {
        response.end(release?.signature || "invalid");
        return;
      }
      response.setHeader("content-length", String(release.metadata.artifact.bytes));
      response.write("partial");
      response.destroy();
    }, async (baseUrl) => {
      await assert.rejects(
        checkForOnlineUpdate({ installedVersion: "0.1.0", metadataUrl: `${baseUrl}/latest.json`, ...testRequestOptions }),
        (error) => error instanceof OnlineReleaseError && error.code === "ONLINE_DOWNLOAD_TOO_LARGE",
      );
      release = signedMetadata(baseUrl, Buffer.from("complete artifact"));
      const downloadDirectory = await createOnlineUpdateTemporaryDirectory(directory);
      await assert.rejects(
        downloadOnlineUpdate(release.metadata, release.signature, downloadDirectory, testRequestOptions),
        (error) => error instanceof OnlineReleaseError,
      );
      await assert.rejects(fs.lstat(downloadDirectory), { code: "ENOENT" });
    });
  });
});

test("download accepts an already-created mkdtemp directory without a second mkdir", async () => {
  await withTemporaryDirectory(async (directory) => {
    const artifact = Buffer.from("complete artifact");
    let release;
    await withServer((request, response) => {
      if (request.url === "/artifact.asrupdate") {
        response.setHeader("content-length", String(artifact.length));
        response.end(artifact);
        return;
      }
      response.end();
    }, async (baseUrl) => {
      release = signedMetadata(baseUrl, artifact);
      const downloadDirectory = await createOnlineUpdateTemporaryDirectory(directory);
      const packagePath = await downloadOnlineUpdate(release.metadata, release.signature, downloadDirectory, testRequestOptions);
      assert.equal(packagePath, path.join(downloadDirectory, "client.asrupdate"));
      assert.deepEqual(await fs.readFile(packagePath), artifact);
      await assert.rejects(fs.lstat(path.join(downloadDirectory, "client.asrupdate.partial")), { code: "ENOENT" });
    });
  });
});

test("downloaded online artifact is still passed to the existing package verifier", async () => {
  await withTemporaryDirectory(async (directory) => {
    const corruptPackage = Buffer.from("not an ASR update package");
    let release;
    await withServer((request, response) => {
      if (request.url === "/artifact.asrupdate") {
        response.setHeader("content-length", String(corruptPackage.length));
        response.end(corruptPackage);
        return;
      }
      if (request.url === "/latest.sig") {
        response.end(release.signature);
        return;
      }
      response.end(JSON.stringify(release.metadata));
    }, async (baseUrl) => {
      release = signedMetadata(baseUrl, corruptPackage);
      const downloadDirectory = await createOnlineUpdateTemporaryDirectory(directory);
      const packagePath = await downloadOnlineUpdate(release.metadata, release.signature, downloadDirectory, testRequestOptions);
      assert.equal(packagePath, path.join(downloadDirectory, "client.asrupdate"));
      await assert.rejects(fs.lstat(path.join(downloadDirectory, "client.asrupdate.partial")), { code: "ENOENT" });
      await assert.rejects(
        readAndVerifyManifest(packagePath),
        (error) => error instanceof ClientUpdatePackageError && error.code === "INVALID_UPDATE_PACKAGE",
      );
    });
  });
});

test("a verified online package enters the unchanged local staging verifier", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sourcePackage = await createSignedTestPackage(directory);
    const artifact = await fs.readFile(sourcePackage);
    let release;
    await withServer((request, response) => {
      if (request.url === "/artifact.asrupdate") {
        response.setHeader("content-length", String(artifact.length));
        response.end(artifact);
        return;
      }
      if (request.url === "/latest.sig") {
        response.end(release.signature);
        return;
      }
      response.end(JSON.stringify(release.metadata));
    }, async (baseUrl) => {
      release = signedMetadata(baseUrl, artifact);
      const downloadDirectory = await createOnlineUpdateTemporaryDirectory(directory);
      const packagePath = await downloadOnlineUpdate(release.metadata, release.signature, downloadDirectory, testRequestOptions);
      const staged = await stageVerifiedClientUpdate(packagePath, path.join(directory, "staging"), {
        trustedSigners: TEST_TRUSTED_SIGNERS,
      });
      assert.equal(staged.manifest.client.version, "0.2.0");
      await assert.doesNotReject(fs.lstat(path.join(staged.clientDirectory, "local-asr-prototype.exe")));
    });
  });
});

test("online IPC exposes actions without renderer-controlled URLs or a listener", async () => {
  const [preload, main, acquisition] = await Promise.all([
    fs.readFile(path.join(__dirname, "../../src/preload.js"), "utf8"),
    fs.readFile(path.join(__dirname, "../../src/main.js"), "utf8"),
    fs.readFile(path.join(__dirname, "../../src/update/onlineRelease.js"), "utf8"),
  ]);
  assert.match(preload, /checkOnlineUpdate: \(\) =>/);
  assert.match(preload, /downloadOnlineUpdate: \(\) =>/);
  assert.doesNotMatch(preload, /downloadOnlineUpdate: \([^)]/);
  assert.doesNotMatch(main, /createServer|\.listen\(/);
  assert.doesNotMatch(acquisition, /createServer|\.listen\(/);
  assert.doesNotMatch(acquisition, /node:child_process|\bspawn\(/);
});
