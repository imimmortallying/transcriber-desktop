"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

test("main owns media authorization while renderer only receives an opaque capability", async () => {
  const [main, preload, index, renderer] = await Promise.all([
    fs.readFile(path.join(projectRoot, "src", "main.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "preload.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8"),
  ]);

  assert.match(main, /protocol\.registerSchemesAsPrivileged\(\[\{[\s\S]*stream: true/);
  assert.match(main, /protocol\.handle\(MEDIA_PROTOCOL_SCHEME, createMediaProtocolHandler/);
  assert.match(main, /const sourceMetadata = await createSourceMediaMetadata\(inputPath\)/);
  assert.match(main, /const resolvedSegmentsPath = path\.resolve\(segmentsPath\);[\s\S]*mediaAuthorizations\.set\(token, \{[\s\S]*segmentsPath: resolvedSegmentsPath,[\s\S]*metadata,[\s\S]*fileState: validation\.fileState/);
  assert.match(main, /validateAuthorizedSource\(authorization\.metadata, authorization\.fileState\)/);
  assert.match(main, /url: `\$\{MEDIA_PROTOCOL_SCHEME\}:\/\/\$\{token\}\/source`/);
  assert.match(main, /ipcMain\.handle\("media:relink-source"/);
  assert.match(main, /window\.webContents\.on\("will-navigate", \(event\) => event\.preventDefault\(\)\)/);
  assert.match(main, /window\.webContents\.setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(preload, /relinkMediaSource: \(segmentsPath, filePath\) => ipcRenderer\.invoke\("media:relink-source", segmentsPath, filePath\)/);
  assert.match(index, /Content-Security-Policy" content="[^"]*media-src asr-media:/);
  assert.doesNotMatch(index, /media-src 'self'/);
  assert.match(renderer, /createMediaController\(\)/);
  assert.match(renderer, /relinkMediaSource\(sourceSegmentsPath, filePath\)/);
  assert.doesNotMatch(renderer, /asr-media:\/\//);
});
