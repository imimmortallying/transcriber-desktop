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

test("renderer keeps the Quick path separate from the Editor and secondary actions", async () => {
  const [index, renderer, styles] = await Promise.all([
    fs.readFile(path.join(projectRoot, "src", "renderer", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "styles.css"), "utf8"),
  ]);

  assert.match(index, /id="quick-view"/);
  assert.match(index, /id="quick-result"/);
  assert.match(index, /id="open-editor"/);
  assert.match(index, /id="editor-view"[^>]*hidden/);
  assert.match(index, /id="toggle-speakers"/);
  assert.match(index, /id="advanced-panel"[^>]*hidden/);
  assert.match(index, /Мои расшифровки/);
  assert.match(renderer, /function setEditorOpen\(open\)[\s\S]*quickView\.hidden = open;[\s\S]*editorView\.hidden = !open;/);
  assert.match(renderer, /openEditorButton\.addEventListener\("click",[\s\S]*setEditorOpen\(true\)/);
  assert.match(renderer, /toggleSpeakersButton\.addEventListener\("click",[\s\S]*setSpeakerToolsVisible\(!areSpeakerToolsOpen\)/);
  assert.match(renderer, /applyOpenedSavedRun\(result\);[\s\S]*setEditorOpen\(true\)/);
  assert.match(renderer, /function formatSourceName\(filePath\)/);
  assert.match(renderer, /function renderQuickPreview\(visibleDocument\)[\s\S]*quickResult\.hidden = !text/);
  assert.match(index, /class="context-hint">Файл и текст остаются на этом компьютере\./);
  assert.match(index, /id="selected-file-hint"/);
  assert.match(styles, /--space-4: 16px;/);
  assert.match(styles, /--color-primary: #1769d3;/);
  assert.match(styles, /\.context-hint \{/);
});
