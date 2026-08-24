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
  assert.match(main, /ipcMain\.handle\("app:get-identity", \(\) => \(\{[\s\S]*version: app\.getVersion\(\),[\s\S]*mode: app\.isPackaged \? "packaged" : "dev",[\s\S]*appPath: app\.getAppPath\(\)/);
  assert.match(main, /return result\.selected\.updateTransaction\?\.phase === "prepared"[\s\S]*: null;/);
  assert.match(main, /const temporaryEditsPath = `\$\{editsPath\}\.\$\{randomUUID\(\)\}\.tmp`;/);
  assert.match(main, /await writeFile\(temporaryEditsPath,[\s\S]*await rename\(temporaryEditsPath, editsPath\)/);
  assert.match(preload, /getClientVersion: \(\) => ipcRenderer\.invoke\("app:get-version"\)/);
  assert.match(preload, /getClientIdentity: \(\) => ipcRenderer\.invoke\("app:get-identity"\)/);
  assert.match(preload, /selectDroppedMedia: \(file\) => ipcRenderer\.invoke\("media:select-dropped-file", webUtils\.getPathForFile\(file\)\)/);
  assert.match(preload, /confirmDocumentAction: \(action, details\) => ipcRenderer\.invoke\("dialog:confirm-document-action", action, details\)/);
  assert.match(main, /async function validateSelectedMediaPath\(inputPath\) \{[\s\S]*isSupportedMediaPath\(inputPath\)[\s\S]*await stat\(inputPath\)[\s\S]*fileInfo\.isFile\(\)/);
  assert.match(main, /ipcMain\.handle\("media:select-dropped-file", async \(_event, inputPath\) => validateSelectedMediaPath\(inputPath\)\)/);
  assert.match(main, /function getDocumentActionConfirmation\(action, details\) \{[\s\S]*case "restore-recognized"[\s\S]*case "select-new-media"[\s\S]*case "discard-unsaved-edits"[\s\S]*case "activate-update"[\s\S]*case "delete-speaker"[\s\S]*default:/);
  assert.match(main, /message: "Восстановить исходный текст\? Текущие правки будут заменены\./);
  assert.match(main, /title: "Удалить расшифровку\?"[\s\S]*buttons: \["Удалить расшифровку", "Отмена"\]/);
  assert.match(main, /message: "Открыть другой файл\? Текущая расшифровка сохранена и останется в Моих расшифровках\."/);
  assert.match(main, /ipcMain\.handle\("dialog:confirm-document-action", async \(event, action, details = null\) => \{[\s\S]*BrowserWindow\.fromWebContents\(event\.sender\)[\s\S]*dialog\.showMessageBox\(owner, getDocumentActionConfirmation\(action, details\)\)/);
  assert.match(preload, /onUpdateCommitted: \(callback\) =>/);
  assert.match(preload, /revealSupportReport: \(reportPath\) => ipcRenderer\.invoke\("support:reveal-report", reportPath\)/);
  assert.match(index, /id="client-version"/);
  assert.match(index, /id="dev-editor-trace"[^>]*hidden/);
  assert.match(index, /id="capture-dev-editor-trace"/);
  assert.match(index, /id="clear-dev-editor-trace"/);
  assert.match(index, /id="copy-dev-editor-trace"/);
  assert.match(index, /<script src="editorHistory\.js"><\/script>/);
  assert.match(index, /<script src="editorTyping\.js"><\/script>/);
  assert.match(main, /const metadata = getRunListMetadata\(path\.basename\(runDirectory\), runInfo\.mtimeMs\);/);
  assert.match(renderer, /const identity = await window\.asr\.getClientIdentity\(\);[\s\S]*Client v\$\{identity\.version\} · \$\{identity\.mode\}/);
  assert.match(renderer, /enableDevDiagnostics\(identity\.mode === "dev"\)/);
  assert.match(renderer, /function traceEditorSnapshot\(label, details = \{\}\)/);
  assert.match(renderer, /isTrusted: event\.isTrusted[\s\S]*controlState: event\.getModifierState\("Control"\)/);
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
  assert.match(renderer, /openSpeakersButton\.addEventListener\("click",[\s\S]*openDialog\(editorToolbar, \{ initialFocus: speakerNameInput \}\)/);
  assert.match(renderer, /if \(visibleDocument\.readOnly\) \{[\s\S]*speakerName\.textContent = `\$\{speaker\.name\}:`/);
  assert.match(renderer, /speakerControl\.textContent = speaker \? `\$\{speaker\.name\}:` : "\+ говорящий"/);
  assert.match(renderer, /function setParagraphSpeaker\(paragraphId, speakerId\) \{[\s\S]*paragraph\.type = "replica";[\s\S]*paragraph\.speakerId = speakerId;/);
  assert.doesNotMatch(renderer, /paragraph\.type = speakerId === null \? "text" : "replica"/);
  assert.match(renderer, /function buildRecognizedParagraphs\(segments, transcript = ""\) \{[\s\S]*return text\s*\? \[\{ type: "text", text, timing/);
  assert.match(index, /<dialog id="editor-toolbar"/);
  assert.match(index, /id="editor-actions-dialog"/);
  assert.match(renderer, /applyOpenedSavedRun\(result\);[\s\S]*setSavedRunsVisible\(false\)/);
  assert.match(renderer, /function formatSourceName\(filePath\)/);
  assert.match(renderer, /function renderDocumentVisibility\(visibleDocument\)[\s\S]*documentView\.hidden = !text/);
  assert.match(index, /id="media-drop-hint" class="media-drop-hint">или перетащите аудио \/ видео в окно/);
  assert.match(index, /<output id="file-name" hidden><\/output>/);
  assert.match(index, /id="media-drop-overlay"[^>]*hidden/);
  assert.match(index, /id="recognition-progress"/);
  assert.match(index, /id="recognition-elapsed"/);
  assert.match(renderer, /function startRecognitionProgress\(\)/);
  assert.match(renderer, /function stopRecognitionProgress\(\)/);
  assert.match(renderer, /const hasSelectedMedia = Boolean\(selectedFile \|\| sourceSegmentsPath\);[\s\S]*fileName\.hidden = !hasSelectedMedia;[\s\S]*mediaDropHint\.hidden = hasSelectedMedia;/);
  assert.match(renderer, /const AUTOSAVE_DELAY_MS = 1000;/);
  assert.match(index, /id="save-status"/);
  assert.match(renderer, /const TOAST_DURATION_MS = 5000;/);
  assert.match(renderer, /function showToast\(message\)/);
  assert.match(renderer, /savedRunsGuidance\.hidden = runs\.length === 0;/);
  assert.doesNotMatch(renderer, /status\.textContent = "Выберите сохранённый прогон\."/);
  assert.match(renderer, /function scheduleAutosave\(\)/);
  assert.match(renderer, /async function saveProjectAutomatically\(\)/);
  assert.match(renderer, /const editorHistory = window\.EditorHistory\.createEditorHistory\(\);/);
  assert.match(renderer, /const \{ TYPING_IDLE_MS, createTypingPlan \} = window\.EditorTyping;/);
  assert.match(renderer, /function runEditorTransaction\(kind, mutate, \{ restoreSelection = false \} = \{\}\)/);
  assert.match(renderer, /function restoreDocumentSelectionWhenOwned\(selection\) \{[\s\S]*getFocusOwningDialog\(\)/);
  assert.match(renderer, /function getFocusOwningDialog\(\) \{[\s\S]*dialog\.open/);
  assert.match(renderer, /function undoEditorTransaction\(\)/);
  assert.match(renderer, /function redoEditorTransaction\(\)/);
  assert.match(renderer, /function handleCompositionStart\(/);
  assert.match(renderer, /function discardUnconfirmedComposition\(\)/);
  assert.match(renderer, /event\.inputType === "historyUndo"/);
  assert.match(renderer, /textElement\.addEventListener\("beforeinput"/);
  assert.match(renderer, /event\.code === "KeyS"/);
  assert.match(renderer, /event\.code === "KeyZ"/);
  assert.match(renderer, /event\.code === "KeyY"/);
  assert.match(renderer, /function hasSeparateTextInputFocus\(\)/);
  assert.match(renderer, /function flushProjectFromShortcut\(\)/);
  const flushProjectFromShortcut = renderer.slice(
    renderer.indexOf("async function flushProjectFromShortcut"),
    renderer.indexOf("async function confirmDocumentCanBeReplaced"),
  );
  assert.doesNotMatch(flushProjectFromShortcut, /finishPendingTyping\(/);
  assert.match(renderer, /async function deleteSpeaker\(speakerId\)/);
  assert.match(renderer, /resetRecognizedButton\.addEventListener\("click", async \(\) => \{[\s\S]*closeDialog\(editorActionsDialog\)[\s\S]*runEditorTransaction\("restore-source",[\s\S]*\{ restoreSelection: false \}\)/);
  assert.match(renderer, /function canUseDocumentHistoryShortcut\(\) \{[\s\S]*!getFocusOwningDialog\(\)/);
  assert.match(renderer, /openDialog\(editorToolbar, \{ initialFocus: speakerNameInput \}\)/);
  const createSpeaker = renderer.slice(
    renderer.indexOf("function createSpeaker()"),
    renderer.indexOf("function deleteSpeaker("),
  );
  assert.match(createSpeaker, /referencedSpeakerIds/);
  assert.doesNotMatch(createSpeaker, /paragraph\.speakerId\s*=/);
  const speakerDirectory = renderer.slice(
    renderer.indexOf("function updateSpeakerDirectory("),
    renderer.indexOf("function createSpeaker()"),
  );
  assert.doesNotMatch(speakerDirectory, /reconcileParagraphSpeakerReferences\(/);
  assert.match(renderer, /window\.asr\.onCloseRequested\(async \(\) => \{[\s\S]*flushAutosaveBeforeClose\(\)/);
  assert.match(renderer, /fileName\.value = result\.sourceName \|\|/);
  assert.match(renderer, /recognitionProgressStage\.textContent = message;/);
  assert.match(renderer, /async function confirmDocumentAction\(action, details\) \{[\s\S]*window\.asr\.confirmDocumentAction\(action, details\)/);
  assert.match(renderer, /confirmDocumentAction\("select-new-media"\)/);
  assert.match(renderer, /confirmDocumentAction\("restore-recognized"\)/);
  assert.match(renderer, /confirmDocumentAction\("discard-unsaved-edits"\)/);
  assert.match(renderer, /confirmDocumentAction\("activate-update"\)/);
  assert.match(renderer, /confirmDocumentAction\("delete-speaker", \{ name: speaker\.name, usageCount \}\)/);
  assert.doesNotMatch(renderer, /\bwindow\.(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(index, /id="quick-title"/);
  assert.doesNotMatch(index, /id="quick-result"/);
  assert.doesNotMatch(index, /id="toggle-edit"/);
  assert.doesNotMatch(index, /id="toggle-speakers"/);
  assert.doesNotMatch(index, /id="open-editor"/);
  assert.doesNotMatch(index, /id="editor-view"/);
  assert.doesNotMatch(index, /К расшифровке/);
  assert.doesNotMatch(index, />Редактор</);
  assert.doesNotMatch(index, /Файл и текст остаются на этом компьютере/);
  assert.doesNotMatch(index, /selected-file-hint|Файл не выбран|Файл выбран\. Нажмите «Распознать»/);
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
  assert.match(styles, /\.media-drop-overlay \{[\s\S]*position: fixed;[\s\S]*pointer-events: none;/);
});

test("dialog polish preserves clear transcript and speaker actions", async () => {
  const [index, renderer, styles] = await Promise.all([
    fs.readFile(path.join(projectRoot, "src", "renderer", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "styles.css"), "utf8"),
  ]);

  assert.match(index, /Добавьте участников разговора и назначайте их репликам\./);
  assert.match(index, /<h2 id="editor-actions-title">Управление расшифровкой<\/h2>/);
  assert.match(index, /<button id="show-recognized"[^>]*>Исходный текст<\/button>/);
  assert.match(index, /<button id="show-edits"[^>]*>Мои правки<\/button>/);
  assert.match(index, /<button id="reset-recognized" class="danger-button"[^>]*>Восстановить исходный текст<\/button>/);
  assert.match(index, /<h3>Сохранённая расшифровка<\/h3>/);
  assert.match(index, /<button id="delete-run" class="danger-button"[^>]*>Удалить расшифровку<\/button>/);
  assert.match(index, /<button id="close-settings" class="secondary-button dialog-close"[^>]*>Закрыть<\/button>/);
  assert.match(index, /<button id="close-speakers" class="secondary-button dialog-close"[^>]*>Закрыть<\/button>/);
  assert.match(index, /<button id="close-editor-actions" class="secondary-button dialog-close"[^>]*>Закрыть<\/button>/);
  assert.match(index, /<div class="results-directory-actions">/);

  const speakerListRenderer = renderer.slice(
    renderer.indexOf("function renderSpeakerList()"),
    renderer.indexOf("function updateSpeakerDirectory("),
  );
  assert.match(speakerListRenderer, /name\.className = "speaker-list-name"/);
  assert.match(speakerListRenderer, /removeButton\.className = "danger-button speaker-remove"/);
  assert.doesNotMatch(speakerListRenderer, /name\.style\.color/);
  assert.match(styles, /\.dialog-close \{[\s\S]*border-color: var\(--color-border-strong\);/);
  assert.match(styles, /\.results-directory-actions \{[\s\S]*flex-wrap: wrap;/);
  assert.match(styles, /\.speaker-list li \{[\s\S]*border-bottom: 1px solid var\(--color-border\);/);
});

test("renderer adds dropped media through the existing selection lifecycle", async () => {
  const [renderer, index] = await Promise.all([
    fs.readFile(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "index.html"), "utf8"),
  ]);

  assert.match(index, /Отпустите аудио или видео для распознавания/);
  assert.match(renderer, /async function selectMediaFile\(filePath\) \{[\s\S]*confirmDocumentCanBeReplaced\(\)[\s\S]*sourceSegmentsPath && !await confirmDocumentAction\("select-new-media"\)[\s\S]*clearAutosaveTimer\(\)[\s\S]*selectedFile = filePath;/);
  assert.match(renderer, /document\.addEventListener\("dragover", \(event\) => \{[\s\S]*event\.preventDefault\(\)[\s\S]*dropEffect = "copy"/);
  const dropHandler = renderer.slice(
    renderer.indexOf('document.addEventListener("drop"'),
    renderer.indexOf('selectFileButton.addEventListener("click"'),
  );
  assert.match(dropHandler, /event\.preventDefault\(\)/);
  assert.match(dropHandler, /files\.length !== 1[\s\S]*Перетащите один аудио- или видеофайл/);
  assert.match(dropHandler, /window\.asr\.selectDroppedMedia\(files\[0\]\)[\s\S]*selectMediaFile\(filePath\)/);
  assert.doesNotMatch(dropHandler, /window\.asr\.transcribe\(/);
  assert.match(renderer, /function canAcceptDroppedMedia\(\) \{[\s\S]*!getFocusOwningDialog\(\)/);
});

test("renderer has no blocking JavaScript dialogs", async () => {
  const rendererDirectory = path.join(projectRoot, "src", "renderer");
  const files = await fs.readdir(rendererDirectory, { recursive: true });
  for (const file of files.filter((entry) => entry.endsWith(".js"))) {
    const source = await fs.readFile(path.join(rendererDirectory, file), "utf8");
    assert.doesNotMatch(source, /\bwindow\.(?:alert|confirm|prompt)\s*\(/, file);
  }
});
