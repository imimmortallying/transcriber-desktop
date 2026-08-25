"use strict";

const assert = require("node:assert/strict");
const { app, net, protocol } = require("electron");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MEDIA_PROTOCOL_SCHEME, createMediaProtocolHandler } = require("../../src/mediaProtocol");

protocol.registerSchemesAsPrivileged([{
  scheme: MEDIA_PROTOCOL_SCHEME,
  privileges: { secure: true, standard: true, stream: true },
}]);

async function main() {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "asr-media-protocol-"));
  const sourcePath = path.join(temporaryDirectory, "range-source.bin");
  try {
    await writeFile(sourcePath, "abcdefghijklmnopqrstuvwxyz", "utf8");
    await app.whenReady();
    protocol.handle(MEDIA_PROTOCOL_SCHEME, createMediaProtocolHandler({
      resolveAuthorization: async (token) => token === "allowed" ? { filePath: sourcePath } : null,
    }));

    const sourceUrl = `${MEDIA_PROTOCOL_SCHEME}://allowed/source`;
    const response = await net.fetch(sourceUrl, {
      headers: { Range: "bytes=5-9" },
    });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "fghij");

    const repeatedResponse = await net.fetch(sourceUrl, {
      headers: { Range: "bytes=20-22" },
    });
    assert.equal(repeatedResponse.status, 206);
    assert.equal(await repeatedResponse.text(), "uvw");
  } finally {
    protocol.unhandle(MEDIA_PROTOCOL_SCHEME);
    await rm(temporaryDirectory, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  app.exit(1);
});
