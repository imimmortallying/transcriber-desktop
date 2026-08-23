"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  RELEASE_SIGNING_KEY_ID,
  npmInvocation,
  readReleaseVersion,
  releaseClient,
} = require("../../scripts/releaseClient");
const { releaseFullSetup } = require("../../scripts/releaseFullSetup");
const { releasePublic } = require("../../scripts/releasePublic");

async function withTemporaryProject(callback) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asr-release-tooling-test-"));
  try {
    await fs.writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "local-asr-prototype", version: "0.0.0" }));
    await callback(projectRoot);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

function argumentValue(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

test("Client release propagates one version to its signed artifacts and keeps signing files out of release output", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const privateKeyFile = path.join(projectRoot, "external-private-key.pem");
    const passphraseFile = path.join(projectRoot, "external-passphrase.txt");
    await Promise.all([
      fs.writeFile(privateKeyFile, "private-key-content"),
      fs.writeFile(passphraseFile, "passphrase-content"),
    ]);
    const calls = [];
    const output = [];
    const run = async (command, argumentsList) => {
      calls.push({ command, argumentsList });
      if (argumentsList.slice(-2).join(" ") === "run dist:client") {
        await fs.mkdir(path.join(projectRoot, "dist"), { recursive: true });
        await fs.writeFile(path.join(projectRoot, "dist", "local-asr-prototype-client-1.2.3-win-x64.zip"), "client zip");
      }
      if (argumentsList[0] && argumentsList[0].endsWith("createClientUpdatePackage.js")) {
        await fs.writeFile(argumentValue(argumentsList, "--output"), "signed update package");
      }
      if (argumentsList[0] && argumentsList[0].endsWith("createOnlineReleaseMetadata.js")) {
        const metadataOutput = argumentValue(argumentsList, "--output");
        await fs.writeFile(metadataOutput, "signed metadata");
        await fs.writeFile(metadataOutput.replace(/\.json$/, ".sig"), "metadata signature");
      }
    };

    const release = await releaseClient(["1.2.3"], {
      projectRoot,
      environment: {
        ASR_RELEASE_PRIVATE_KEY_FILE: privateKeyFile,
        ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE: passphraseFile,
        npm_execpath: path.join(projectRoot, "npm-cli.js"),
      },
      run,
      validateSigning: async (configuration) => {
        assert.equal(configuration.keyId, RELEASE_SIGNING_KEY_ID);
        assert.equal(configuration.privateKeyFile, privateKeyFile);
        assert.equal(configuration.privateKeyPassphraseFile, passphraseFile);
      },
      writeOutput: (message) => output.push(message),
    });

    assert.equal(release.directory, path.join(projectRoot, "dist", "release-1.2.3"));
    assert.deepEqual((await fs.readdir(release.directory)).sort(), [
      "latest.json",
      "latest.sig",
      "local-asr-prototype-client-1.2.3-win-x64.asrupdate",
    ]);
    assert.equal(calls[0].argumentsList.at(-3), "1.2.3");
    const packageCall = calls.find((call) => call.argumentsList[0]?.endsWith("createClientUpdatePackage.js"));
    const metadataCall = calls.find((call) => call.argumentsList[0]?.endsWith("createOnlineReleaseMetadata.js"));
    assert.equal(argumentValue(packageCall.argumentsList, "--version"), "1.2.3");
    assert.equal(argumentValue(packageCall.argumentsList, "--key-id"), RELEASE_SIGNING_KEY_ID);
    assert.equal(
      argumentValue(metadataCall.argumentsList, "--artifact-url"),
      "https://github.com/imimmortallying/asr-desktop-releases/releases/download/v1.2.3/local-asr-prototype-client-1.2.3-win-x64.asrupdate",
    );
    const releaseContents = await Promise.all(release.files.map((filePath) => fs.readFile(filePath, "utf8")));
    assert.ok(releaseContents.every((contents) => !contents.includes("private-key-content") && !contents.includes("passphrase-content")));
    assert.match(output[0], /GitHub tag: v1\.2\.3/);
  });
});

test("public release refuses an existing durable target before version mutation or builds", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const privateKeyFile = path.join(projectRoot, "external-private-key.pem");
    const passphraseFile = path.join(projectRoot, "external-passphrase.txt");
    const releaseDirectory = path.join(projectRoot, "dist", "release-1.2.3");
    await fs.mkdir(releaseDirectory, { recursive: true });
    await Promise.all([
      fs.writeFile(privateKeyFile, "private-key-content"),
      fs.writeFile(passphraseFile, "passphrase-content"),
      fs.writeFile(path.join(releaseDirectory, "published.txt"), "durable", "utf8"),
    ]);
    let runCalls = 0;
    await assert.rejects(
      releasePublic(["1.2.3"], {
        projectRoot,
        environment: {
          ASR_RELEASE_PRIVATE_KEY_FILE: privateKeyFile,
          ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE: passphraseFile,
        },
        run: async () => { runCalls += 1; },
        validateSigning: async () => {},
      }),
      /Refusing to overwrite existing release output/,
    );
    assert.equal(runCalls, 0);
    assert.equal(JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version, "0.0.0");
    assert.equal(await fs.readFile(path.join(releaseDirectory, "published.txt"), "utf8"), "durable");
  });
});

test("Client release rejects missing signing configuration before changing project metadata or starting a build", async () => {
  await withTemporaryProject(async (projectRoot) => {
    let runCalls = 0;
    await assert.rejects(
      releaseClient(["1.2.3"], {
        projectRoot,
        environment: {},
        run: async () => { runCalls += 1; },
        validateSigning: async () => { throw new Error("must not validate"); },
      }),
      /ASR_RELEASE_PRIVATE_KEY_FILE/,
    );
    assert.equal(runCalls, 0);
    assert.equal((await fs.readdir(projectRoot)).includes("dist"), false);
    assert.equal(JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version, "0.0.0");
  });
});

test("public release stages one Client version and the matching Full Setup without release secrets", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const privateKeyFile = path.join(projectRoot, "external-private-key.pem");
    const passphraseFile = path.join(projectRoot, "external-passphrase.txt");
    await fs.mkdir(path.join(projectRoot, "dist", "release-1.2.2"), { recursive: true });
    await Promise.all([
      fs.writeFile(privateKeyFile, "private-key-content"),
      fs.writeFile(passphraseFile, "passphrase-content"),
      fs.writeFile(path.join(projectRoot, "dist", "stale-build-output.txt"), "stale", "utf8"),
      fs.writeFile(path.join(projectRoot, "dist", "release-1.2.2", "previous-release.txt"), "durable", "utf8"),
    ]);
    const calls = [];
    const output = [];
    const run = async (command, argumentsList) => {
      calls.push({ command, argumentsList });
      if (argumentsList.slice(-2).join(" ") === "run dist:client") {
        await fs.mkdir(path.join(projectRoot, "dist"), { recursive: true });
        await fs.writeFile(path.join(projectRoot, "dist", "local-asr-prototype-client-1.2.3-win-x64.zip"), "client zip");
      }
      if (argumentsList[0] && argumentsList[0].endsWith("createClientUpdatePackage.js")) {
        await fs.writeFile(argumentValue(argumentsList, "--output"), "signed update package");
      }
      if (argumentsList[0] && argumentsList[0].endsWith("createOnlineReleaseMetadata.js")) {
        const metadataOutput = argumentValue(argumentsList, "--output");
        await fs.writeFile(metadataOutput, "signed metadata");
        await fs.writeFile(metadataOutput.replace(/\.json$/, ".sig"), "metadata signature");
      }
      if (argumentsList.slice(-2).join(" ") === "run dist:win") {
        await fs.writeFile(path.join(projectRoot, "dist", "local-asr-prototype Setup 1.2.3.exe"), "full setup");
      }
    };

    const release = await releasePublic(["1.2.3"], {
      projectRoot,
      environment: {
        ASR_RELEASE_PRIVATE_KEY_FILE: privateKeyFile,
        ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE: passphraseFile,
        npm_execpath: path.join(projectRoot, "npm-cli.js"),
      },
      run,
      validateSigning: async (configuration) => {
        assert.equal(configuration.keyId, RELEASE_SIGNING_KEY_ID);
        assert.equal(configuration.privateKeyFile, privateKeyFile);
        assert.equal(configuration.privateKeyPassphraseFile, passphraseFile);
      },
      writeOutput: (message) => output.push(message),
    });

    assert.equal(calls.filter((call) => call.argumentsList.includes("version")).length, 1);
    assert.deepEqual((await fs.readdir(release.directory)).sort(), [
      "latest.json",
      "latest.sig",
      "local-asr-prototype Setup 1.2.3.exe",
      "local-asr-prototype-client-1.2.3-win-x64.asrupdate",
    ]);
    await assert.rejects(fs.lstat(path.join(projectRoot, "dist", "stale-build-output.txt")), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(projectRoot, "dist", "release-1.2.2", "previous-release.txt"), "utf8"), "durable");
    const packageCall = calls.find((call) => call.argumentsList[0]?.endsWith("createClientUpdatePackage.js"));
    assert.equal(argumentValue(packageCall.argumentsList, "--version"), "1.2.3");
    assert.ok(calls.some((call) => call.argumentsList.slice(-2).join(" ") === "run dist:win"));
    const releaseContents = await Promise.all(release.files.map((filePath) => fs.readFile(filePath, "utf8")));
    assert.ok(releaseContents.every((contents) => !contents.includes("private-key-content") && !contents.includes("passphrase-content")));
    assert.match(output[0], /New\/offline installation: .*local-asr-prototype Setup 1\.2\.3\.exe/);
  });
});

test("public release rejects version or signing preconditions before changing project metadata or starting a build", async () => {
  await withTemporaryProject(async (projectRoot) => {
    let runCalls = 0;
    const run = async () => { runCalls += 1; };
    await assert.rejects(
      releasePublic(["v1.2.3"], {
        projectRoot,
        run,
      }),
      /Usage/,
    );
    await assert.rejects(
      releasePublic(["1.2.3"], {
        projectRoot,
        environment: {},
        run,
        validateSigning: async () => { throw new Error("must not validate"); },
      }),
      /ASR_RELEASE_PRIVATE_KEY_FILE/,
    );
    assert.equal(runCalls, 0);
    assert.equal((await fs.readdir(projectRoot)).includes("dist"), false);
    assert.equal(JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version, "0.0.0");
  });
});

test("release commands accept only numeric three-part versions and Full Setup remains separate", async () => {
  assert.equal(readReleaseVersion(["0.1.2"]), "0.1.2");
  assert.throws(() => readReleaseVersion(["v0.1.2"]), /Usage/);
  await withTemporaryProject(async (projectRoot) => {
    const calls = [];
    const result = await releaseFullSetup(["2.0.0"], {
      projectRoot,
      run: async (command, argumentsList) => calls.push({ command, argumentsList }),
      environment: { npm_execpath: path.join(projectRoot, "npm-cli.js") },
      writeOutput: () => {},
    });
    assert.deepEqual(result, { version: "2.0.0" });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].argumentsList.slice(-2), ["run", "dist:win"]);
  });
});

test("Windows npm invocation runs the npm CLI through node instead of spawning npm.cmd", () => {
  const invocation = npmInvocation(
    ["run", "dist:client"],
    { npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" },
    "win32",
    "C:\\Program Files\\nodejs\\node.exe",
  );
  assert.deepEqual(invocation, {
    command: "C:\\Program Files\\nodejs\\node.exe",
    argumentsList: [
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      "run",
      "dist:client",
    ],
  });
});
