"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

test("renderer obtains the running Client version from Electron main process", async () => {
  const [main, preload, index, renderer] = await Promise.all([
    fs.readFile(path.join(projectRoot, "src", "main.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "preload.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8"),
  ]);

  assert.match(main, /ipcMain\.handle\("app:get-version", \(\) => app\.getVersion\(\)\)/);
  assert.match(main, /return result\.selected\.updateTransaction\?\.phase === "prepared"[\s\S]*: null;/);
  assert.match(preload, /getClientVersion: \(\) => ipcRenderer\.invoke\("app:get-version"\)/);
  assert.match(preload, /onUpdateCommitted: \(callback\) =>/);
  assert.match(preload, /revealSupportReport: \(reportPath\) => ipcRenderer\.invoke\("support:reveal-report", reportPath\)/);
  assert.match(index, /id="client-version"/);
  assert.match(renderer, /Client v\$\{await window\.asr\.getClientVersion\(\)\}/);
  assert.match(renderer, /window\.asr\.onUpdateCommitted\(\(\) => \{[\s\S]*refreshUpdateStatus\(\)/);
  assert.match(renderer, /const response = await window\.asr\.transcribe\(selectedFile\);[\s\S]*showSupportReport\(response\.error\)/);
  assert.match(renderer, /window\.asr\.revealSupportReport\(pendingSupportReportPath\)/);
  assert.match(index, /id="support-report"/);
  assert.doesNotMatch(index, /Client v0\.1\.2/);
});
