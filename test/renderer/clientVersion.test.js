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
  assert.match(main, /const temporaryEditsPath = `\$\{editsPath\}\.\$\{randomUUID\(\)\}\.tmp`;/);
  assert.match(main, /await writeFile\(temporaryEditsPath,[\s\S]*await rename\(temporaryEditsPath, editsPath\)/);
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

test("renderer keeps one stable document for reading and editing", async () => {
  const [index, renderer, styles] = await Promise.all([
    fs.readFile(path.join(projectRoot, "src", "renderer", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "styles.css"), "utf8"),
  ]);

  assert.match(index, /id="source-view"/);
  assert.match(index, /id="document-view"[^>]*hidden/);
  assert.match(index, /<details id="document-more"/);
  assert.match(index, /id="open-speakers"/);
  assert.match(index, /id="saved-runs-guidance"/);
  assert.match(index, /Управлять говорящими/);
  assert.match(index, /<dialog id="advanced-panel"/);
  assert.match(index, /<dialog id="saved-runs"/);
  assert.match(index, /id="close-settings"/);
  assert.match(index, /id="close-saved-runs"/);
  assert.match(index, /Мои расшифровки/);
  assert.match(renderer, /return \{ paragraphs, speakers, readOnly: false \};/);
  assert.match(renderer, /openSpeakersButton\.addEventListener\("click",[\s\S]*openDialog\(editorToolbar\)/);
  assert.match(renderer, /if \(visibleDocument\.readOnly\) \{[\s\S]*speakerName\.textContent = `\$\{speaker\.name\}:`/);
  assert.match(renderer, /speakerControl\.textContent = speaker \? `\$\{speaker\.name\}:` : "\+ говорящий"/);
  assert.match(renderer, /function setParagraphSpeaker\(paragraphId, speakerId\) \{[\s\S]*paragraph\.speakerId = speakerId;/);
  assert.doesNotMatch(renderer, /paragraph\.type = speakerId === null \? "text" : "replica"/);
  assert.match(renderer, /function buildRecognizedParagraphs\(segments, transcript = ""\) \{[\s\S]*return text\s*\? \[\{ type: "text", text, timing/);
  assert.match(index, /<dialog id="editor-toolbar"/);
  assert.match(index, /id="editor-actions-dialog"/);
  assert.match(renderer, /applyOpenedSavedRun\(result\);[\s\S]*setSavedRunsVisible\(false\)/);
  assert.match(renderer, /function formatSourceName\(filePath\)/);
  assert.match(renderer, /function renderDocumentVisibility\(visibleDocument\)[\s\S]*documentView\.hidden = !text/);
  assert.match(index, /id="selected-file-hint"/);
  assert.match(index, /id="recognition-progress"/);
  assert.match(index, /id="recognition-elapsed"/);
  assert.match(renderer, /function startRecognitionProgress\(\)/);
  assert.match(renderer, /function stopRecognitionProgress\(\)/);
  assert.match(renderer, /const AUTOSAVE_DELAY_MS = 1000;/);
  assert.match(renderer, /const TOAST_DURATION_MS = 5000;/);
  assert.match(renderer, /function showToast\(message\)/);
  assert.match(renderer, /savedRunsGuidance\.hidden = runs\.length === 0;/);
  assert.doesNotMatch(renderer, /status\.textContent = "Выберите сохранённый прогон\."/);
  assert.match(renderer, /function scheduleAutosave\(\)/);
  assert.match(renderer, /async function saveProjectAutomatically\(\)/);
  assert.match(renderer, /window\.asr\.onCloseRequested\(async \(\) => \{[\s\S]*flushAutosaveBeforeClose\(\)/);
  assert.match(renderer, /fileName\.value = "Сохранённая расшифровка"/);
  assert.match(renderer, /recognitionProgressStage\.textContent = message;/);
  assert.doesNotMatch(index, /id="quick-title"/);
  assert.doesNotMatch(index, /id="quick-result"/);
  assert.doesNotMatch(index, /id="toggle-edit"/);
  assert.doesNotMatch(index, /id="toggle-speakers"/);
  assert.doesNotMatch(index, /id="open-editor"/);
  assert.doesNotMatch(index, /id="editor-view"/);
  assert.doesNotMatch(index, /К расшифровке/);
  assert.doesNotMatch(index, />Редактор</);
  assert.doesNotMatch(index, /Файл и текст остаются на этом компьютере/);
  assert.doesNotMatch(index, /<progress/);
  assert.doesNotMatch(renderer, /распознано сегментов/);
  assert.doesNotMatch(renderer, /Открыто: сегментов/);
  assert.match(styles, /--space-4: 16px;/);
  assert.match(styles, /--color-primary: #1769d3;/);
  assert.match(styles, /\.app-dialog \{/);
  assert.match(styles, /\.document-view \{/);
  assert.match(styles, /grid-template-columns: max-content minmax\(0, 1fr\);/);
  assert.match(styles, /\.editor-more-actions \{/);
  assert.match(styles, /\.recognition-progress\[hidden\] \{/);
});
