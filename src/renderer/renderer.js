const selectFileButton = document.querySelector("#select-file");
const transcribeButton = document.querySelector("#transcribe");
const moreMenu = document.querySelector("#more-menu");
const openSavedButton = document.querySelector("#open-saved");
const toggleSettingsButton = document.querySelector("#toggle-settings");
const selectedFileHint = document.querySelector("#selected-file-hint");
const documentView = document.querySelector("#document-view");
const documentMore = document.querySelector("#document-more");
const openSpeakersButton = document.querySelector("#open-speakers");
const openEditorActionsButton = document.querySelector("#open-editor-actions");
const advancedPanel = document.querySelector("#advanced-panel");
const closeSettingsButton = document.querySelector("#close-settings");
const closeSavedRunsButton = document.querySelector("#close-saved-runs");
const savedRunsPanel = document.querySelector("#saved-runs");
const savedRunsList = document.querySelector("#saved-runs-list");
const savedRunsEmpty = document.querySelector("#saved-runs-empty");
const savedRunsGuidance = document.querySelector("#saved-runs-guidance");
const copyTextButton = document.querySelector("#copy-text");
const saveButton = document.querySelector("#save");
const saveStatus = document.querySelector("#save-status");
const resetRecognizedButton = document.querySelector("#reset-recognized");
const showRecognizedButton = document.querySelector("#show-recognized");
const showEditsButton = document.querySelector("#show-edits");
const revealRunButton = document.querySelector("#reveal-run");
const deleteRunButton = document.querySelector("#delete-run");
const runActionsGroup = document.querySelector("#run-actions-group");
const addSpeakerButton = document.querySelector("#add-speaker");
const speakerNameInput = document.querySelector("#speaker-name");
const speakerList = document.querySelector("#speaker-list");
const editorToolbar = document.querySelector("#editor-toolbar");
const closeSpeakersButton = document.querySelector("#close-speakers");
const editorActionsDialog = document.querySelector("#editor-actions-dialog");
const closeEditorActionsButton = document.querySelector("#close-editor-actions");
const fileName = document.querySelector("#file-name");
const resultsDirectory = document.querySelector("#results-directory");
const selectResultsDirectoryButton = document.querySelector("#select-results-directory");
const revealResultsDirectoryButton = document.querySelector("#reveal-results-directory");
const checkOnlineUpdateButton = document.querySelector("#check-online-update");
const downloadOnlineUpdateButton = document.querySelector("#download-online-update");
const selectUpdatePackageButton = document.querySelector("#select-update-package");
const prepareUpdateButton = document.querySelector("#prepare-update");
const activateUpdateButton = document.querySelector("#activate-update");
const cancelUpdateButton = document.querySelector("#cancel-update");
const updatePackageName = document.querySelector("#update-package-name");
const updateStatus = document.querySelector("#update-status");
const status = document.querySelector("#status");
const supportReport = document.querySelector("#support-report");
const supportReportMessage = document.querySelector("#support-report-message");
const revealSupportReportButton = document.querySelector("#reveal-support-report");
const closeSupportReportButton = document.querySelector("#close-support-report");
const recognitionProgress = document.querySelector("#recognition-progress");
const recognitionProgressStage = document.querySelector("#recognition-progress-stage");
const recognitionElapsed = document.querySelector("#recognition-elapsed");
const editor = document.querySelector("#editor");
const clientVersion = document.querySelector("#client-version");
const devEditorTrace = document.querySelector("#dev-editor-trace");
const captureDevEditorTraceButton = document.querySelector("#capture-dev-editor-trace");
const clearDevEditorTraceButton = document.querySelector("#clear-dev-editor-trace");
const copyDevEditorTraceButton = document.querySelector("#copy-dev-editor-trace");
const devEditorTraceOutput = document.querySelector("#dev-editor-trace-output");
const modalDialogs = [
  advancedPanel,
  savedRunsPanel,
  supportReport,
  editorToolbar,
  editorActionsDialog,
];

const PROJECT_SCHEMA_VERSION = 1;
const AUTOSAVE_DELAY_MS = 1000;
const TOAST_DURATION_MS = 5000;
const ICON_PATHS = {
  folder: ["M3 6h5l2 2h11v10H3z"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 14h10l1-14", "M9 7V4h6v3"],
};

let selectedFile = null;
let sourceSegmentsPath = null;
let isRunning = false;
let isProjectDirty = false;
let hasProjectEdits = false;
let isShowingRecognized = false;
let isSavedRunOpen = false;
let resultsDirectoryPath = null;
let recognizedSegments = [];
let recognizedTranscript = "";
let paragraphs = [];
let speakers = [];
let nextParagraphId = 1;
let nextSpeakerId = 1;
let openSpeakerPopoverParagraphId = null;
let selectedUpdatePackage = null;
let preparedUpdate = null;
let updateOperationInProgress = false;
let availableOnlineUpdate = null;
let pendingSupportReportPath = null;
let recognitionStartedAt = null;
let recognitionTimerId = null;
let autosaveTimerId = null;
let autosavePromise = null;
let projectRevision = 0;
let toastTimerId = null;
let typingTimerId = null;
let typingContext = null;
let compositionState = null;
let compositionCommitTimerId = null;
let lastDocumentSelection = null;
let devDiagnosticsEnabled = false;
let devTraceSnapshotSequence = 0;
let devTraceEventSequence = 0;
const devTraceSnapshots = [];
const devTraceEvents = [];
const editorHistory = window.EditorHistory.createEditorHistory();
const { TYPING_IDLE_MS, createTypingPlan } = window.EditorTyping;

async function showClientVersion() {
  try {
    const identity = await window.asr.getClientIdentity();
    clientVersion.textContent = `Client v${identity.version} · ${identity.mode}\n${identity.appPath}`;
    enableDevDiagnostics(identity.mode === "dev");
  } catch {
    clientVersion.textContent = "Client version unavailable";
  }
}

function describeTraceElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    className: typeof element.className === "string" ? element.className : null,
    contentEditable: element.getAttribute("contenteditable"),
    isContentEditable: element instanceof HTMLElement ? element.isContentEditable : false,
    disabled: element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? element.disabled
      : null,
    inert: element.inert || element.hasAttribute("inert"),
    readWrite: element instanceof HTMLElement && typeof element.matches === "function"
      ? element.matches(":read-write")
      : null,
  };
}

function collectInertAncestors(element) {
  const chain = [];
  let current = element instanceof Element ? element : null;
  while (current) {
    chain.push({
      ...describeTraceElement(current),
      inert: current.inert || current.hasAttribute("inert"),
    });
    current = current.parentElement;
  }
  return chain;
}

function describeTraceNode(node) {
  return describeTraceElement(node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement);
}

function getDomSelectionSnapshot() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return { rangeCount: 0, logical: captureDocumentSelection() };
  }
  const range = selection.getRangeAt(0);
  return {
    rangeCount: selection.rangeCount,
    isCollapsed: selection.isCollapsed,
    anchor: { node: describeTraceNode(selection.anchorNode), offset: selection.anchorOffset },
    focus: { node: describeTraceNode(selection.focusNode), offset: selection.focusOffset },
    range: {
      start: { node: describeTraceNode(range.startContainer), offset: range.startOffset },
      end: { node: describeTraceNode(range.endContainer), offset: range.endOffset },
    },
    logical: captureDocumentSelection(),
  };
}

function renderDevTraceOutput() {
  if (!devDiagnosticsEnabled) {
    return;
  }
  devEditorTraceOutput.textContent = JSON.stringify({
    events: devTraceEvents,
    snapshots: devTraceSnapshots,
  }, null, 2);
}

function traceEditorSnapshot(label, details = {}) {
  if (!devDiagnosticsEnabled) {
    return;
  }
  const firstParagraph = paragraphs[0] || null;
  const firstParagraphElement = firstParagraph
    ? editor.querySelector(`[data-paragraph-id="${firstParagraph.id}"]`)?.closest(".document-paragraph")
    : null;
  const firstSpeakerElement = firstParagraphElement?.querySelector(".speaker-control, .speaker-name") || null;
  const editorStyle = getComputedStyle(editor);
  const firstTextElement = firstParagraphElement?.querySelector(".document-text") || null;
  const firstTextStyle = firstTextElement ? getComputedStyle(firstTextElement) : null;
  const snapshot = {
    sequence: ++devTraceSnapshotSequence,
    label,
    at: new Date().toISOString(),
    details,
    flags: {
      isRunning,
      isShowingRecognized,
      isProjectDirty,
      hasProjectEdits,
      compositionActive: Boolean(compositionState),
      openSpeakerPopoverParagraphId,
    },
    activeElement: describeTraceElement(document.activeElement),
    documentHasFocus: document.hasFocus(),
    dialogs: modalDialogs.map((dialog) => ({
      id: dialog.id,
      open: dialog.open,
      modal: typeof dialog.matches === "function" ? dialog.matches(":modal") : false,
    })),
    inert: {
      main: collectInertAncestors(document.querySelector("main")),
      documentView: collectInertAncestors(documentView),
      editor: collectInertAncestors(editor),
    },
    editor: {
      contentEditable: editor.getAttribute("contenteditable"),
      pointerEvents: editorStyle.pointerEvents,
      display: editorStyle.display,
      visibility: editorStyle.visibility,
      firstText: firstTextElement ? {
        contentEditable: firstTextElement.getAttribute("contenteditable"),
        isContentEditable: firstTextElement.isContentEditable,
        pointerEvents: firstTextStyle.pointerEvents,
        display: firstTextStyle.display,
        visibility: firstTextStyle.visibility,
        userSelect: firstTextStyle.userSelect,
        webkitUserModify: firstTextStyle.webkitUserModify,
        readWrite: firstTextElement.matches(":read-write"),
      } : null,
    },
    selection: getDomSelectionSnapshot(),
    firstParagraph: firstParagraph ? {
      id: firstParagraph.id,
      type: firstParagraph.type,
      speakerId: firstParagraph.speakerId,
      resolvedSpeaker: getSpeaker(firstParagraph.speakerId),
      renderedSpeakerControl: firstSpeakerElement?.textContent || null,
      renderedBeforeText: firstParagraphElement?.querySelector(".paragraph-content")?.textContent || null,
    } : null,
  };
  devTraceSnapshots.push(snapshot);
  if (devTraceSnapshots.length > 40) {
    devTraceSnapshots.shift();
  }
  console.info("[editor-trace]", snapshot);
  renderDevTraceOutput();
}

function traceEditorEvent(event) {
  if (!devDiagnosticsEnabled) {
    return;
  }
  const record = {
    sequence: ++devTraceEventSequence,
    at: new Date().toISOString(),
    type: event.type,
    target: describeTraceElement(event.target),
    activeElement: describeTraceElement(document.activeElement),
    cancelable: event.cancelable,
    isTrusted: event.isTrusted,
    key: event instanceof KeyboardEvent ? event.key : null,
    code: event instanceof KeyboardEvent ? event.code : null,
    repeat: event instanceof KeyboardEvent ? event.repeat : false,
    location: event instanceof KeyboardEvent ? event.location : null,
    ctrlKey: event instanceof KeyboardEvent ? event.ctrlKey : false,
    altKey: event instanceof KeyboardEvent ? event.altKey : false,
    metaKey: event instanceof KeyboardEvent ? event.metaKey : false,
    shiftKey: event instanceof KeyboardEvent ? event.shiftKey : false,
    modifiers: event instanceof KeyboardEvent ? {
      alt: event.altKey,
      control: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      controlState: event.getModifierState("Control"),
      capsLock: event.getModifierState("CapsLock"),
    } : null,
    inputType: event instanceof InputEvent ? event.inputType : null,
    isComposing: Boolean(event.isComposing),
    defaultPrevented: event.defaultPrevented,
  };
  queueMicrotask(() => {
    record.defaultPrevented = event.defaultPrevented;
    devTraceEvents.push(record);
    if (devTraceEvents.length > 100) {
      devTraceEvents.shift();
    }
    renderDevTraceOutput();
  });

  const target = event.target instanceof Element ? event.target : null;
  if (event.type === "pointerdown" && target?.closest("#editor")) {
    window.setTimeout(() => traceEditorSnapshot("editor:pointer-attempt", { target: describeTraceElement(target) }), 0);
  }
  if (event.type === "pointerdown" && target?.matches("#speaker-name")) {
    window.setTimeout(() => traceEditorSnapshot("speaker-name:pointer-attempt"), 0);
  }
  if (["focusin", "beforeinput", "input"].includes(event.type) && target?.closest("#editor")) {
    window.setTimeout(() => traceEditorSnapshot(`editor:${event.type}`, { target: describeTraceElement(target) }), 0);
  }
  if (event.type === "focusin" && target?.matches("#speaker-name")) {
    window.setTimeout(() => traceEditorSnapshot("speaker-name:focusin"), 0);
  }
  if (event.type === "keydown"
    && target?.closest("#editor")
    && !["Alt", "Control", "Meta", "Shift"].includes(record.key)) {
    window.setTimeout(() => traceEditorSnapshot("editor:keydown-post-dispatch", {
      key: record.key,
      code: record.code,
      modifiers: record.modifiers,
      defaultPrevented: record.defaultPrevented,
    }), 50);
  }
}

function enableDevDiagnostics(enabled) {
  devDiagnosticsEnabled = enabled;
  devEditorTrace.hidden = !enabled;
  if (!enabled) {
    return;
  }
  ["pointerdown", "mousedown", "click", "focusin", "keydown", "keyup", "beforeinput", "input"].forEach((type) => {
    document.addEventListener(type, traceEditorEvent, true);
  });
  traceEditorSnapshot("dev-diagnostics-enabled");
}

captureDevEditorTraceButton.addEventListener("click", () => {
  traceEditorSnapshot("manual-snapshot");
});

clearDevEditorTraceButton.addEventListener("click", () => {
  devTraceSnapshots.length = 0;
  devTraceEvents.length = 0;
  devTraceSnapshotSequence = 0;
  devTraceEventSequence = 0;
  renderDevTraceOutput();
  traceEditorSnapshot("trace-cleared");
});

copyDevEditorTraceButton.addEventListener("click", async () => {
  try {
    await window.asr.copyText(devEditorTraceOutput.textContent);
    showToast("Трасса скопирована.");
  } catch (error) {
    showToast(`Не удалось скопировать трассу: ${error.message}`);
  }
});

function getSpeakerColor(index) {
  return `hsl(${(index * 137.508) % 360} 58% 42%)`;
}

function createParagraph(values = {}) {
  return {
    id: nextParagraphId++,
    type: "text",
    text: "",
    speakerId: null,
    start: null,
    timing: [],
    ...values,
  };
}

function resetEditorState() {
  paragraphs = [];
  speakers = [];
  nextParagraphId = 1;
  nextSpeakerId = 1;
  closeDialog(editorToolbar);
}

function captureEditorState() {
  return {
    paragraphs: paragraphs.map((paragraph) => ({
      ...paragraph,
      timing: paragraph.timing.map((part) => ({ ...part })),
    })),
    nextParagraphId,
  };
}

function applyEditorState(state) {
  paragraphs = state.paragraphs.map((paragraph) => ({
    ...paragraph,
    timing: paragraph.timing.map((part) => ({ ...part })),
  }));
  nextParagraphId = state.nextParagraphId;
  reconcileParagraphSpeakerReferences();
}

function reconcileParagraphSpeakerReferences() {
  const speakerIds = new Set(speakers.map((speaker) => speaker.id));
  for (const paragraph of paragraphs) {
    if (paragraph.speakerId !== null && !speakerIds.has(paragraph.speakerId)) {
      paragraph.speakerId = null;
    }
  }
}

function clearTypingTimer() {
  if (typingTimerId) {
    window.clearTimeout(typingTimerId);
  }
  typingTimerId = null;
}

function clearCompositionCommitTimer() {
  if (compositionCommitTimerId) {
    window.clearTimeout(compositionCommitTimerId);
  }
  compositionCommitTimerId = null;
}

function clearEditorHistory() {
  clearTypingTimer();
  clearCompositionCommitTimer();
  typingContext = null;
  compositionState = null;
  lastDocumentSelection = null;
  editorHistory.clear();
}

function initializeEditorHistory() {
  clearTypingTimer();
  clearCompositionCommitTimer();
  typingContext = null;
  compositionState = null;
  const selection = captureDocumentSelection();
  lastDocumentSelection = selection;
  editorHistory.initialize(captureEditorState(), selection);
}

function findTextPosition(textElement, requestedOffset) {
  const offset = Math.max(0, requestedOffset);
  const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent.length;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
    node = walker.nextNode();
  }
  return { node: textElement, offset: textElement.childNodes.length };
}

function selectionPoint(node, offset) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const textElement = element?.closest(".document-text");
  if (!textElement || !editor.contains(textElement)) {
    return null;
  }
  const paragraphId = Number(textElement.dataset.paragraphId);
  if (!getParagraph(paragraphId)) {
    return null;
  }
  const range = document.createRange();
  range.selectNodeContents(textElement);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return { paragraphId, offset: range.toString().length };
}

function captureDocumentSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const anchor = selectionPoint(selection.anchorNode, selection.anchorOffset);
  const focus = selectionPoint(selection.focusNode, selection.focusOffset);
  return anchor && focus ? { anchor, focus } : null;
}

function restoreDocumentSelection(selection) {
  if (!selection?.anchor || !selection.focus) {
    return false;
  }
  const anchorElement = editor.querySelector(`[data-paragraph-id="${selection.anchor.paragraphId}"]`);
  const focusElement = editor.querySelector(`[data-paragraph-id="${selection.focus.paragraphId}"]`);
  if (!anchorElement || !focusElement) {
    return false;
  }
  const anchor = findTextPosition(anchorElement, selection.anchor.offset);
  const focus = findTextPosition(focusElement, selection.focus.offset);
  focusElement.focus();
  const browserSelection = window.getSelection();
  browserSelection.removeAllRanges();
  if (typeof browserSelection.setBaseAndExtent === "function") {
    browserSelection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  } else {
    const range = document.createRange();
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
    browserSelection.addRange(range);
  }
  lastDocumentSelection = captureDocumentSelection();
  return true;
}

function getFocusOwningDialog() {
  return modalDialogs.find((dialog) => dialog.open) || null;
}

function restoreDocumentSelectionWhenOwned(selection) {
  if (getFocusOwningDialog() || isRunning || isShowingRecognized) {
    traceEditorSnapshot("selection-restore-skipped", {
      hasFocusOwningDialog: Boolean(getFocusOwningDialog()),
      isRunning,
      isShowingRecognized,
    });
    return false;
  }
  const restored = restoreDocumentSelection(selection);
  traceEditorSnapshot("selection-restore-finished", { restored });
  return restored;
}

function sameSelection(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finishPendingTyping() {
  clearTypingTimer();
  if (!editorHistory.hasPendingTyping() || compositionState) {
    return false;
  }
  const selection = typingContext?.afterSelection || captureDocumentSelection() || lastDocumentSelection;
  editorHistory.finishTyping(captureEditorState(), selection, { kind: "typing" });
  typingContext = null;
  lastDocumentSelection = selection;
  return true;
}

function scheduleTypingFinish() {
  clearTypingTimer();
  typingTimerId = window.setTimeout(() => {
    typingTimerId = null;
    finishPendingTyping();
  }, TYPING_IDLE_MS);
}

function beginTypingTransaction(paragraph, event) {
  const selection = captureDocumentSelection() || lastDocumentSelection;
  const plan = createTypingPlan({
    paragraphId: paragraph.id,
    inputType: event.inputType || "",
    data: event.data,
    textBefore: paragraph.text,
    selectionBefore: selection,
    previous: typingContext,
  });
  if (!plan.canContinue) {
    finishPendingTyping();
    editorHistory.beginTyping({ continuityKey: String(paragraph.id), selection });
    typingContext = { paragraphId: paragraph.id, mode: plan.mode, afterSelection: selection };
  }
  typingContext.finishAfter = plan.finishAfter;
}

function runEditorTransaction(kind, mutate, { restoreSelection = false } = {}) {
  if (isShowingRecognized || compositionState || getFocusOwningDialog()) {
    return false;
  }
  finishPendingTyping();
  const selectionBefore = captureDocumentSelection() || lastDocumentSelection;
  editorHistory.setCurrentSelection(selectionBefore);
  const result = mutate();
  if (!result) {
    return false;
  }
  const selectionAfter = result.selection || selectionBefore;
  markProjectDirty();
  renderSpeakerList();
  renderEditor();
  if (restoreSelection) {
    restoreDocumentSelectionWhenOwned(selectionAfter);
  } else {
    traceEditorSnapshot("selection-restore-not-requested", { kind });
  }
  editorHistory.record(captureEditorState(), selectionAfter, { kind });
  return true;
}

function applyHistoryEntry(entry, { restoreSelection = true } = {}) {
  applyEditorState(entry.document);
  openSpeakerPopoverParagraphId = null;
  isShowingRecognized = false;
  markProjectDirty();
  renderSpeakerList();
  renderEditor();
  if (restoreSelection) {
    restoreDocumentSelectionWhenOwned(entry.selection);
  }
}

function undoEditorTransaction() {
  if (isShowingRecognized || compositionState || getFocusOwningDialog()) {
    return false;
  }
  finishPendingTyping();
  const entry = editorHistory.undo();
  if (!entry) {
    return false;
  }
  applyHistoryEntry(entry);
  return true;
}

function redoEditorTransaction() {
  if (isShowingRecognized || compositionState || getFocusOwningDialog()) {
    return false;
  }
  finishPendingTyping();
  const entry = editorHistory.redo();
  if (!entry) {
    return false;
  }
  applyHistoryEntry(entry);
  return true;
}

function discardUnconfirmedComposition() {
  if (!compositionState) {
    return false;
  }
  clearCompositionCommitTimer();
  compositionState = null;
  renderEditor();
  return true;
}

function finalizeEditorHistoryForLifecycle() {
  discardUnconfirmedComposition();
  finishPendingTyping();
}

function clearToast() {
  if (toastTimerId) {
    window.clearTimeout(toastTimerId);
  }
  toastTimerId = null;
  status.textContent = "";
}

function clearSaveStatus() {
  saveStatus.textContent = "";
  saveStatus.hidden = false;
  delete saveStatus.dataset.state;
}

function setSaveStatus(state, message) {
  saveStatus.dataset.state = state;
  saveStatus.textContent = message;
  saveStatus.hidden = false;
}

function showSavingStatus() {
  if (saveStatus.dataset.state !== "error") {
    setSaveStatus("saving", "Сохраняю…");
  }
}

function showToast(message) {
  clearToast();
  status.textContent = message;
  toastTimerId = window.setTimeout(() => {
    status.textContent = "";
    toastTimerId = null;
  }, TOAST_DURATION_MS);
}

function markProjectDirty() {
  isProjectDirty = true;
  projectRevision += 1;
  if (sourceSegmentsPath) {
    hasProjectEdits = true;
    showSavingStatus();
  }
  scheduleAutosave();
  setRunning(isRunning);
}

function openDialog(dialog, { initialFocus = null } = {}) {
  if (!dialog.open) {
    dialog.showModal();
  }
  traceEditorSnapshot("dialog-opened", { dialogId: dialog.id });
  const focusTarget = initialFocus || dialog.querySelector("[autofocus]");
  if (focusTarget instanceof HTMLElement && !focusTarget.hasAttribute("disabled")) {
    window.requestAnimationFrame(() => {
      if (dialog.open && getFocusOwningDialog() === dialog) {
        focusTarget.focus();
      }
    });
  }
}

function closeDialog(dialog) {
  if (dialog.open) {
    dialog.close();
    traceEditorSnapshot("dialog-closed", { dialogId: dialog.id });
  }
}

async function confirmDocumentAction(action, details) {
  try {
    return await window.asr.confirmDocumentAction(action, details);
  } catch (error) {
    showToast(`Не удалось открыть подтверждение: ${error.message}`);
    return false;
  }
}

function setRunning(running) {
  isRunning = running;
  const visibleDocument = getVisibleDocument();
  const readOnly = visibleDocument.readOnly;
  selectFileButton.disabled = running;
  transcribeButton.disabled = running || !selectedFile;
  selectedFileHint.hidden = running || !selectedFile || Boolean(sourceSegmentsPath);
  openSavedButton.disabled = running;
  toggleSettingsButton.disabled = running;
  openSpeakersButton.disabled = running || !sourceSegmentsPath || isShowingRecognized;
  selectResultsDirectoryButton.disabled = running;
  revealResultsDirectoryButton.disabled = running || !resultsDirectoryPath;
  const hasCleanText = Boolean(getCleanText(visibleDocument.paragraphs, visibleDocument.speakers));
  copyTextButton.disabled = running || !hasCleanText;
  saveButton.disabled = running || !hasCleanText;
  resetRecognizedButton.disabled = running || !sourceSegmentsPath;
  showRecognizedButton.disabled = running || !hasProjectEdits;
  showEditsButton.disabled = running || !hasProjectEdits;
  revealRunButton.disabled = running || !isSavedRunOpen;
  deleteRunButton.disabled = running || !isSavedRunOpen;
  showRecognizedButton.classList.toggle("is-active", isShowingRecognized);
  showRecognizedButton.setAttribute("aria-pressed", String(isShowingRecognized));
  showEditsButton.classList.toggle("is-active", !isShowingRecognized);
  showEditsButton.setAttribute("aria-pressed", String(!isShowingRecognized));
  addSpeakerButton.disabled = running || readOnly;
  speakerNameInput.disabled = running || readOnly;
  speakerList.querySelectorAll("button").forEach((button) => {
    button.disabled = running || readOnly;
  });
  savedRunsPanel.querySelectorAll("button").forEach((button) => {
    button.disabled = running;
  });
  renderUpdateControls();
  updateActiveSavedRun();
}

function clearSupportReport() {
  pendingSupportReportPath = null;
  closeDialog(supportReport);
  supportReportMessage.textContent = "";
}

function showSupportReport(error) {
  pendingSupportReportPath = error.reportPath || null;
  revealSupportReportButton.hidden = !pendingSupportReportPath;
  supportReportMessage.textContent = pendingSupportReportPath
    ? `Подготовлен технический отчёт (${error.code}). Откройте папку, приложите файл к письму и отправьте его на ${error.supportEmail}. Аудио, расшифровки и имена файлов в отчёт не входят.`
    : `Не удалось подготовить технический отчёт (${error.code}). Сообщите этот код на ${error.supportEmail}.`;
  openDialog(supportReport);
}

function formatElapsedTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function startRecognitionProgress() {
  recognitionStartedAt = Date.now();
  recognitionProgressStage.textContent = "Запускаю распознавание…";
  recognitionElapsed.value = "00:00";
  recognitionProgress.hidden = false;
  recognitionTimerId = window.setInterval(() => {
    recognitionElapsed.value = formatElapsedTime(Date.now() - recognitionStartedAt);
  }, 1000);
}

function stopRecognitionProgress() {
  if (recognitionTimerId) {
    window.clearInterval(recognitionTimerId);
  }
  recognitionTimerId = null;
  recognitionStartedAt = null;
  recognitionProgress.hidden = true;
}

function clearAutosaveTimer() {
  if (autosaveTimerId) {
    window.clearTimeout(autosaveTimerId);
  }
  autosaveTimerId = null;
}

function scheduleAutosave() {
  clearAutosaveTimer();
  if (!sourceSegmentsPath || !isProjectDirty) {
    return;
  }

  autosaveTimerId = window.setTimeout(() => {
    autosaveTimerId = null;
    saveProjectAutomatically();
  }, AUTOSAVE_DELAY_MS);
}

async function saveProjectAutomatically() {
  if (autosavePromise) {
    await autosavePromise;
    return;
  }
  if (!sourceSegmentsPath || !isProjectDirty) {
    return;
  }

  const revision = projectRevision;
  const segmentsPath = sourceSegmentsPath;
  showSavingStatus();
  autosavePromise = window.asr.saveProject(segmentsPath, serializeProject());
  try {
    await autosavePromise;
    if (sourceSegmentsPath === segmentsPath && projectRevision === revision) {
      isProjectDirty = false;
      setSaveStatus("saved", "Сохранено");
    } else if (sourceSegmentsPath === segmentsPath) {
      scheduleAutosave();
    }
  } catch (error) {
    setSaveStatus("error", `Не удалось сохранить правки: ${error.message}`);
  } finally {
    autosavePromise = null;
  }
}

async function flushProjectFromShortcut() {
  if (!sourceSegmentsPath || isRunning || compositionState) {
    return false;
  }
  clearAutosaveTimer();
  if (!isProjectDirty) {
    setSaveStatus("saved", "Сохранено");
    return true;
  }
  await saveProjectAutomatically();
  return true;
}

async function confirmDocumentCanBeReplaced() {
  finalizeEditorHistoryForLifecycle();
  if (!isProjectDirty) {
    return true;
  }

  clearAutosaveTimer();
  await saveProjectAutomatically();
  return !isProjectDirty || await confirmDocumentAction("discard-unsaved-edits");
}

async function flushAutosaveBeforeClose() {
  finalizeEditorHistoryForLifecycle();
  clearAutosaveTimer();
  await saveProjectAutomatically();
}

async function stopAutosaveForDeletedRun() {
  finalizeEditorHistoryForLifecycle();
  clearAutosaveTimer();
  if (autosavePromise) {
    await autosavePromise;
  }
}

function renderUpdateControls() {
  checkOnlineUpdateButton.disabled = updateOperationInProgress || Boolean(preparedUpdate);
  downloadOnlineUpdateButton.disabled = updateOperationInProgress || Boolean(preparedUpdate) || !availableOnlineUpdate;
  selectUpdatePackageButton.disabled = updateOperationInProgress || Boolean(preparedUpdate);
  prepareUpdateButton.disabled = updateOperationInProgress || !selectedUpdatePackage || Boolean(preparedUpdate);
  activateUpdateButton.disabled = updateOperationInProgress || isRunning || !preparedUpdate;
  cancelUpdateButton.disabled = updateOperationInProgress || isRunning || !preparedUpdate;
  updatePackageName.textContent = selectedUpdatePackage || "Файл обновления не выбран";
  updateStatus.textContent = preparedUpdate
    ? `Обновление Client ${preparedUpdate.candidateClient.version} подготовлено. Для применения нужен перезапуск.`
    : "Обновление не подготовлено.";
}

async function refreshUpdateStatus() {
  try {
    preparedUpdate = await window.asr.getUpdateStatus();
  } catch {
    preparedUpdate = null;
  }
  renderUpdateControls();
}

window.asr.onUpdateCommitted(() => {
  refreshUpdateStatus();
  showToast("Обновление приложения применено.");
});

toggleSettingsButton.addEventListener("click", () => {
  if (isRunning) {
    return;
  }
  moreMenu.open = false;
  openDialog(advancedPanel);
});

closeSettingsButton.addEventListener("click", () => closeDialog(advancedPanel));

openSpeakersButton.addEventListener("click", () => {
  if (!isRunning && sourceSegmentsPath && !isShowingRecognized) {
    traceEditorSnapshot("speakers: before-open");
    documentMore.open = false;
    openDialog(editorToolbar, { initialFocus: speakerNameInput });
  }
});

closeSpeakersButton.addEventListener("click", () => closeDialog(editorToolbar));

openEditorActionsButton.addEventListener("click", () => {
  if (!isRunning) {
    documentMore.open = false;
    openDialog(editorActionsDialog);
  }
});

closeEditorActionsButton.addEventListener("click", () => closeDialog(editorActionsDialog));

function formatTimecode(seconds) {
  if (!Number.isFinite(seconds)) {
    return "--:--";
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const twoDigits = (value) => String(value).padStart(2, "0");
  return hours ? `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(secs)}`
    : `${twoDigits(minutes)}:${twoDigits(secs)}`;
}

function getSpeaker(speakerId, speakerList = speakers) {
  return speakerList.find((speaker) => speaker.id === speakerId) || null;
}

function getParagraph(paragraphId) {
  return paragraphs.find((paragraph) => paragraph.id === paragraphId) || null;
}

function getCleanText(paragraphList = paragraphs, speakerList = speakers) {
  return paragraphList
    .map((paragraph) => {
      const text = paragraph.text.trim();
      if (!text) {
        return "";
      }

      const speaker = paragraph.type === "replica"
        ? getSpeaker(paragraph.speakerId, speakerList)
        : null;
      return speaker ? `${speaker.name}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildRecognizedParagraphs(segments, transcript = "") {
  const timing = [];
  let text = "";
  for (const segment of segments) {
    const segmentText = segment.text.trim();
    if (!segmentText) {
      continue;
    }
    if (text) {
      text += " ";
    }
    const from = text.length;
    text += segmentText;
    timing.push({ from, to: text.length, start: segment.start });
  }
  return text
    ? [{ type: "text", text, timing, start: timing[0]?.start ?? null }]
    : transcript.trim() ? [{ type: "text", text: transcript }] : [];
}

function setRecognizedSource(segments, transcript = "") {
  recognizedSegments = segments.map((segment) => ({ ...segment }));
  recognizedTranscript = transcript;
}

function clearRecognizedSource() {
  recognizedSegments = [];
  recognizedTranscript = "";
}

function setSavedRunActionsVisible(visible) {
  runActionsGroup.hidden = !visible;
}

function setResultsDirectory(dataDirectory) {
  resultsDirectoryPath = dataDirectory;
  resultsDirectory.textContent = dataDirectory;
  resultsDirectory.title = dataDirectory;
  setRunning(isRunning);
}

async function loadResultsDirectory() {
  try {
    setResultsDirectory(await window.asr.getResultsDirectory());
  } catch (error) {
    resultsDirectory.textContent = "Папка результатов недоступна";
    resultsDirectory.title = "Папка результатов недоступна";
    showToast(`Ошибка настроек: ${error.message}`);
  }
}

function resetDeletedRunState() {
  clearAutosaveTimer();
  clearEditorHistory();
  clearSaveStatus();
  selectedFile = null;
  sourceSegmentsPath = null;
  isSavedRunOpen = false;
  clearRecognizedSource();
  resetEditorState();
  isProjectDirty = false;
  hasProjectEdits = false;
  isShowingRecognized = false;
  openSpeakerPopoverParagraphId = null;
  fileName.value = "Файл не выбран";
  setSavedRunActionsVisible(false);
  renderSpeakerList();
  closeDialog(editorActionsDialog);
  documentView.hidden = true;
  renderEditor();
}

function formatSourceName(filePath) {
  return String(filePath).split(/[\\/]/).filter(Boolean).at(-1) || "Файл не выбран";
}

function setSavedRunsVisible(visible) {
  openSavedButton.setAttribute("aria-expanded", String(visible));
  if (visible) {
    openDialog(savedRunsPanel);
  } else {
    closeDialog(savedRunsPanel);
  }
}

function formatRunDate(date) {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsedDate);
}

function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  for (const pathData of ICON_PATHS[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

function updateActiveSavedRun() {
  savedRunsList.querySelectorAll(".saved-run").forEach((item) => {
    const active = item.dataset.segmentsPath === sourceSegmentsPath;
    item.classList.toggle("is-active", active);
    item.querySelector(".saved-run-open").setAttribute("aria-current", active ? "true" : "false");
  });
}

function renderSavedRuns(runs) {
  savedRunsList.textContent = "";
  savedRunsEmpty.hidden = runs.length > 0;
  savedRunsGuidance.hidden = runs.length === 0;

  for (const run of runs) {
    const item = document.createElement("li");
    item.className = "saved-run";
    item.dataset.segmentsPath = run.segmentsPath;

    const openRunButton = document.createElement("button");
    openRunButton.className = "saved-run-open";
    openRunButton.type = "button";
    openRunButton.setAttribute("aria-label", `Открыть прогон ${run.sourceName}`);

    const name = document.createElement("span");
    name.className = "saved-run-name";
    name.textContent = run.sourceName;
    const date = document.createElement("span");
    date.className = "saved-run-date";
    date.textContent = formatRunDate(run.date);
    openRunButton.append(name, date);
    openRunButton.addEventListener("click", () => openSavedRun(run.segmentsPath));

    const actions = document.createElement("div");
    actions.className = "saved-run-actions";
    const revealButton = document.createElement("button");
    revealButton.className = "icon-button";
    revealButton.type = "button";
    revealButton.setAttribute("aria-label", `Открыть папку прогона ${run.sourceName}`);
    revealButton.title = "Открыть в папке";
    revealButton.append(createIcon("folder"));
    revealButton.addEventListener("click", () => revealSavedRun(run.segmentsPath));
    const deleteButton = document.createElement("button");
    deleteButton.className = "icon-button danger-button";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Удалить прогон ${run.sourceName}`);
    deleteButton.title = "Удалить";
    deleteButton.append(createIcon("trash"));
    deleteButton.addEventListener("click", () => deleteSavedRun(run.segmentsPath));
    actions.append(revealButton, deleteButton);
    item.append(openRunButton, actions);
    savedRunsList.append(item);
  }

  setRunning(isRunning);
}

async function refreshSavedRuns() {
  const runs = await window.asr.listRuns();
  renderSavedRuns(runs);
}

function applyOpenedSavedRun(result) {
  clearAutosaveTimer();
  clearEditorHistory();
  clearSaveStatus();
  selectedFile = null;
  sourceSegmentsPath = null;
  clearRecognizedSource();
  isProjectDirty = false;
  hasProjectEdits = false;
  isShowingRecognized = false;
  openSpeakerPopoverParagraphId = null;
  resetEditorState();
  fileName.value = result.sourceName || (result.date ? `Расшифровка от ${formatRunDate(result.date)}` : "Сохранённая расшифровка");
  setRecognizedSource(result.segments);
  if (result.project) {
    const { migratedRemark } = restoreProject(result.project);
    hasProjectEdits = true;
    showToast(migratedRemark
      ? "Открыт сохранённый проект. Ремарки из старого файла преобразованы в обычный текст."
      : "Открыты сохранённые правки.");
  } else {
    loadSegments(result.segments);
    if (!result.segments.length) {
      showToast("В сохранённом результате нет текста.");
    }
  }
  sourceSegmentsPath = result.sourcePath;
  isSavedRunOpen = true;
  setSavedRunActionsVisible(true);
  isProjectDirty = false;
  renderSpeakerList();
  renderEditor();
  initializeEditorHistory();
}

async function openSavedRun(segmentsPath) {
  if (isRunning) {
    return;
  }
  if (!await confirmDocumentCanBeReplaced()) {
    return;
  }

  setRunning(true);
  clearToast();
  try {
    const result = await window.asr.openRun(segmentsPath);
    applyOpenedSavedRun(result);
    setSavedRunsVisible(false);
  } catch (error) {
    showToast(`Ошибка открытия: ${error.message}`);
  } finally {
    setRunning(false);
    renderEditor();
  }
}

async function revealSavedRun(segmentsPath) {
  if (isRunning) {
    return;
  }

  setRunning(true);
  clearToast();
  try {
    await window.asr.revealRunInFolder(segmentsPath);
    showToast("Папка прогона открыта.");
  } catch (error) {
    showToast(`Ошибка открытия папки: ${error.message}`);
  } finally {
    setRunning(false);
  }
}

async function deleteSavedRun(segmentsPath) {
  if (isRunning) {
    return;
  }

  clearToast();
  try {
    const confirmed = await window.asr.confirmDeleteRun(segmentsPath);
    if (!confirmed) {
      showToast("Удаление прогона отменено.");
      return;
    }

    if (segmentsPath === sourceSegmentsPath) {
      await stopAutosaveForDeletedRun();
    }
    setRunning(true);
    clearToast();
    await window.asr.deleteRun(segmentsPath);
    await refreshSavedRuns();
    if (segmentsPath === sourceSegmentsPath) {
      resetDeletedRunState();
    }
    showToast("Прогон удалён вместе с подготовленным аудио, результатами и сохранёнными правками.");
  } catch (error) {
    showToast(`Ошибка удаления прогона: ${error.message}`);
  } finally {
    setRunning(false);
  }
}

function loadSegments(segments, transcript = "") {
  paragraphs = buildRecognizedParagraphs(segments, transcript)
    .map((values) => createParagraph(values));
}

function getVisibleDocument() {
  if (!isShowingRecognized) {
    return { paragraphs, speakers, readOnly: false };
  }

  return {
    paragraphs: buildRecognizedParagraphs(recognizedSegments, recognizedTranscript)
      .map((values, index) => ({ id: index + 1, speakerId: null, ...values })),
    speakers: [],
    readOnly: true,
  };
}

function assertProject(condition, message) {
  if (!condition) {
    throw new Error(`Файл segments_asr.edits.json: ${message}`);
  }
}

function isStoredTime(value) {
  return value === null || Number.isFinite(value);
}

function restoreProject(project) {
  assertProject(project && typeof project === "object" && !Array.isArray(project), "ожидался объект.");
  assertProject(project.schemaVersion === PROJECT_SCHEMA_VERSION, "неподдерживаемая версия формата.");
  assertProject(Array.isArray(project.paragraphs), "отсутствует массив paragraphs.");
  assertProject(Array.isArray(project.speakers), "отсутствует массив speakers.");

  const speakerIds = new Set();
  const restoredSpeakers = project.speakers.map((speaker) => {
    assertProject(speaker && typeof speaker === "object", "некорректный говорящий.");
    assertProject(Number.isSafeInteger(speaker.id) && speaker.id > 0, "некорректный id говорящего.");
    assertProject(!speakerIds.has(speaker.id), "повторяющийся id говорящего.");
    assertProject(typeof speaker.name === "string" && speaker.name.trim(), "некорректное имя говорящего.");
    assertProject(typeof speaker.color === "string" && speaker.color, "некорректный цвет говорящего.");
    speakerIds.add(speaker.id);
    return { id: speaker.id, name: speaker.name, color: speaker.color };
  });

  const paragraphIds = new Set();
  let migratedRemark = false;
  const restoredParagraphs = project.paragraphs.map((paragraph) => {
    assertProject(paragraph && typeof paragraph === "object", "некорректный абзац.");
    assertProject(Number.isSafeInteger(paragraph.id) && paragraph.id > 0, "некорректный id абзаца.");
    assertProject(!paragraphIds.has(paragraph.id), "повторяющийся id абзаца.");
    assertProject(["text", "replica", "remark"].includes(paragraph.type), "некорректный тип абзаца.");
    assertProject(typeof paragraph.text === "string", "некорректный текст абзаца.");
    assertProject(isStoredTime(paragraph.start), "некорректный таймкод абзаца.");
    assertProject(Array.isArray(paragraph.timing), "отсутствует карта таймингов абзаца.");
    const timing = paragraph.timing.map((part) => {
      assertProject(part && typeof part === "object", "некорректная часть карты таймингов.");
      assertProject(Number.isSafeInteger(part.from) && Number.isSafeInteger(part.to), "некорректные границы карты таймингов.");
      assertProject(part.from >= 0 && part.to >= part.from && part.to <= paragraph.text.length, "границы карты таймингов выходят за текст абзаца.");
      assertProject(isStoredTime(part.start), "некорректный таймкод в карте таймингов.");
      return { from: part.from, to: part.to, start: part.start };
    });
    const type = paragraph.type === "remark" ? "text" : paragraph.type;
    const speakerId = paragraph.type === "remark" ? null : paragraph.speakerId;
    assertProject(speakerId === null || speakerIds.has(speakerId), "абзац ссылается на неизвестного говорящего.");
    assertProject(type === "replica" || speakerId === null, "обычный абзац не может иметь говорящего.");
    migratedRemark ||= paragraph.type === "remark";
    paragraphIds.add(paragraph.id);
    return {
      id: paragraph.id,
      type,
      text: paragraph.text,
      speakerId,
      start: paragraph.start,
      timing,
    };
  });

  paragraphs = restoredParagraphs;
  speakers = restoredSpeakers;
  nextParagraphId = Math.max(0, ...paragraphs.map((paragraph) => paragraph.id)) + 1;
  nextSpeakerId = Math.max(0, ...speakers.map((speaker) => speaker.id)) + 1;
  return { migratedRemark };
}

function serializeProject() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    paragraphs: paragraphs.map((paragraph) => ({
      ...paragraph,
      timing: paragraph.timing.map((part) => ({ ...part })),
    })),
    speakers: speakers.map((speaker) => ({ ...speaker })),
  };
}

function renderSpeakerList() {
  speakerList.replaceChildren();
  for (const speaker of speakers) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.style.color = speaker.color;
    name.textContent = speaker.name;
    const removeButton = document.createElement("button");
    removeButton.className = "speaker-remove";
    removeButton.type = "button";
    removeButton.disabled = isRunning || isShowingRecognized;
    removeButton.textContent = "Удалить";
    removeButton.addEventListener("click", () => deleteSpeaker(speaker.id));
    item.append(name, removeButton);
    speakerList.append(item);
  }
}

function updateSpeakerDirectory(mutate, { renderDocument = false } = {}) {
  finishPendingTyping();
  if (!mutate()) {
    return false;
  }
  markProjectDirty();
  renderSpeakerList();
  if (renderDocument) {
    renderEditor();
  }
  return true;
}

function createSpeaker() {
  traceEditorSnapshot("speaker-create: before");
  const normalizedName = speakerNameInput.value.trim();
  if (!normalizedName) {
    showToast("Введите имя нового говорящего.");
    speakerNameInput.focus();
    return;
  }

  if (!speakers.some((item) => item.name === normalizedName)) {
    updateSpeakerDirectory(() => {
      const referencedSpeakerIds = paragraphs
        .map((paragraph) => paragraph.speakerId)
        .filter(Number.isInteger);
      const speakerId = Math.max(nextSpeakerId, ...speakers.map((item) => item.id + 1), ...referencedSpeakerIds.map((id) => id + 1));
      nextSpeakerId = speakerId + 1;
      speakers.push({
        id: speakerId,
        name: normalizedName,
        color: getSpeakerColor(speakers.length),
      });
      return true;
    });
  }

  speakerNameInput.value = "";
  renderSpeakerList();
  setRunning(isRunning);
  traceEditorSnapshot("speaker-create: after");
}

async function deleteSpeaker(speakerId) {
  traceEditorSnapshot("speaker-delete: before", { speakerId });
  const speaker = getSpeaker(speakerId);
  if (!speaker) {
    return;
  }
  const usageCount = paragraphs.filter((paragraph) => paragraph.speakerId === speakerId).length;
  if (!await confirmDocumentAction("delete-speaker", { name: speaker.name, usageCount })) {
    return;
  }
  updateSpeakerDirectory(() => {
    speakers = speakers.filter((item) => item.id !== speakerId);
    for (const paragraph of paragraphs) {
      if (paragraph.speakerId === speakerId) {
        paragraph.speakerId = null;
      }
    }
    return true;
  }, { renderDocument: true });
  traceEditorSnapshot("speaker-delete: after", { speakerId });
}

function getSelectionContext() {
  const selection = window.getSelection();
  const documentSelection = captureDocumentSelection();
  if (!selection?.rangeCount || !documentSelection) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!range.collapsed) {
    showToast("Поставьте курсор в нужное место текста.");
    return null;
  }

  const textElement = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
    ? selection.anchorNode.closest(".document-text")
    : selection.anchorNode?.parentElement?.closest(".document-text");
  if (!textElement || !editor.contains(textElement)) {
    showToast("Поставьте курсор в абзац документа.");
    return null;
  }

  const paragraph = getParagraph(Number(textElement.dataset.paragraphId));
  if (!paragraph) {
    return null;
  }

  return { paragraph, textElement, offset: documentSelection.anchor.offset };
}

function getSegmentStart(timing, offset, fallbackStart) {
  const part = timing.find((item) => offset >= item.from && offset <= item.to)
    || timing.find((item) => offset < item.from)
    || timing.at(-1);
  return part?.start ?? fallbackStart;
}

function splitTiming(paragraph, offset) {
  const point = getSegmentStart(paragraph.timing, offset, paragraph.start);
  const left = [];
  const right = [];

  for (const part of paragraph.timing) {
    if (part.to <= offset) {
      left.push({ ...part });
    } else if (part.from >= offset) {
      right.push({ ...part, from: part.from - offset, to: part.to - offset });
    } else {
      left.push({ ...part, to: offset });
      right.push({ ...part, from: 0, to: part.to - offset });
    }
  }

  return { left, right, point };
}

function syncStart(paragraph, fallbackStart = paragraph.start) {
  if (paragraph.timing.length) {
    paragraph.start = paragraph.timing[0].start;
  } else {
    paragraph.start = fallbackStart;
  }
}

function rescaleTiming(paragraph, nextText) {
  const previousLength = paragraph.text.length;
  if (!previousLength || previousLength === nextText.length) {
    paragraph.text = nextText;
    return;
  }

  const ratio = nextText.length / previousLength;
  paragraph.timing = paragraph.timing.map((part) => ({
    ...part,
    from: Math.round(part.from * ratio),
    to: Math.round(part.to * ratio),
  }));
  paragraph.text = nextText;
}

function splitParagraph() {
  const context = getSelectionContext();
  if (!context) {
    return;
  }

  const { paragraph, textElement, offset } = context;
  const sourceText = textElement.textContent || "";
  const leftText = sourceText.slice(0, offset);
  const rightText = sourceText.slice(offset);
  if (!leftText.trim() || !rightText.trim()) {
    showToast("Ctrl+Enter делит только текст с обеих сторон курсора.");
    return;
  }
  runEditorTransaction("split", () => {
    const originalStart = paragraph.start;
    const { left, right, point } = splitTiming(paragraph, offset);
    const index = paragraphs.findIndex((item) => item.id === paragraph.id);
    paragraph.text = leftText;
    paragraph.timing = left;
    syncStart(paragraph, originalStart);

    const nextParagraph = createParagraph({
      type: "replica",
      text: rightText,
      speakerId: paragraph.type === "replica" ? paragraph.speakerId : null,
      start: point,
      timing: right,
    });
    syncStart(nextParagraph, point);
    paragraphs.splice(index + 1, 0, nextParagraph);
    return {
      selection: {
        anchor: { paragraphId: nextParagraph.id, offset: 0 },
        focus: { paragraphId: nextParagraph.id, offset: 0 },
      },
    };
  }, { restoreSelection: true });
}

function mergeParagraphWithPrevious(paragraph) {
  const index = paragraphs.findIndex((item) => item.id === paragraph.id);
  if (index <= 0) {
    return false;
  }

  return runEditorTransaction("merge", () => {
    const previous = paragraphs[index - 1];
    const splitOffset = previous.text.length;
    previous.text += paragraph.text;
    previous.timing.push(...paragraph.timing.map((part) => ({
      ...part,
      from: part.from + splitOffset,
      to: part.to + splitOffset,
    })));
    syncStart(previous);
    paragraphs.splice(index, 1);
    openSpeakerPopoverParagraphId = null;
    return {
      selection: {
        anchor: { paragraphId: previous.id, offset: splitOffset },
        focus: { paragraphId: previous.id, offset: splitOffset },
      },
    };
  }, { restoreSelection: true });
}

function toggleSpeakerPopover(paragraphId) {
  openSpeakerPopoverParagraphId = openSpeakerPopoverParagraphId === paragraphId
    ? null
    : paragraphId;
  renderEditor();
}

function setParagraphSpeaker(paragraphId, speakerId) {
  const paragraph = getParagraph(paragraphId);
  if (!paragraph) {
    return;
  }

  runEditorTransaction("speaker-assign", () => {
    if (speakerId !== null) {
      paragraph.type = "replica";
    }
    paragraph.speakerId = speakerId;
    openSpeakerPopoverParagraphId = null;
    return {};
  }, { restoreSelection: true });
}

function handleDocumentBeforeInput(event, paragraph) {
  if (event.inputType === "historyUndo") {
    event.preventDefault();
    undoEditorTransaction();
    return;
  }
  if (event.inputType === "historyRedo") {
    event.preventDefault();
    redoEditorTransaction();
    return;
  }
  if (compositionState || event.isComposing) {
    return;
  }
  beginTypingTransaction(paragraph, event);
}

function handleDocumentInput(event, paragraph, textElement) {
  if (compositionState || event.isComposing) {
    return;
  }
  rescaleTiming(paragraph, textElement.textContent || "");
  markProjectDirty();
  const selection = captureDocumentSelection() || lastDocumentSelection;
  if (typingContext) {
    typingContext.afterSelection = selection;
  }
  lastDocumentSelection = selection;
  if (typingContext?.finishAfter) {
    finishPendingTyping();
    return;
  }
  scheduleTypingFinish();
}

function handleCompositionStart(paragraph, textElement) {
  finishPendingTyping();
  compositionState = {
    paragraphId: paragraph.id,
    textElement,
    stateBefore: JSON.stringify(captureEditorState()),
  };
}

function handleCompositionEnd() {
  clearCompositionCommitTimer();
  compositionCommitTimerId = window.setTimeout(() => {
    compositionCommitTimerId = null;
    const composition = compositionState;
    if (!composition) {
      return;
    }
    compositionState = null;
    const paragraph = getParagraph(composition.paragraphId);
    if (!paragraph || !composition.textElement.isConnected) {
      return;
    }
    rescaleTiming(paragraph, composition.textElement.textContent || "");
    const stateAfter = captureEditorState();
    const selection = captureDocumentSelection() || lastDocumentSelection;
    lastDocumentSelection = selection;
    if (JSON.stringify(stateAfter) === composition.stateBefore) {
      return;
    }
    markProjectDirty();
    editorHistory.record(stateAfter, selection, { kind: "typing" });
  }, 0);
}

function handleEditorKeydown(event) {
  if (event.isComposing || compositionState) {
    return;
  }
  if (event.key === "Enter") {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    splitParagraph();
    return;
  }
  if (event.key !== "Backspace") {
    return;
  }
  const context = getSelectionContext();
  if (!context || context.offset !== 0) {
    return;
  }
  if (paragraphs.findIndex((item) => item.id === context.paragraph.id) > 0) {
    event.preventDefault();
    mergeParagraphWithPrevious(context.paragraph);
  }
}

function renderDocumentVisibility(visibleDocument) {
  const text = getCleanText(visibleDocument.paragraphs, visibleDocument.speakers);
  documentView.hidden = !text;
}

function renderEditor() {
  const visibleDocument = getVisibleDocument();
  renderDocumentVisibility(visibleDocument);
  editor.replaceChildren();
  if (!visibleDocument.paragraphs.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "editor-placeholder";
    placeholder.textContent = "Здесь появится расшифровка.";
    editor.append(placeholder);
    setRunning(isRunning);
    traceEditorSnapshot("render-editor", { empty: true });
    return;
  }

  for (const paragraph of visibleDocument.paragraphs) {
    const paragraphElement = document.createElement("article");
    paragraphElement.className = "document-paragraph";
    const timecode = document.createElement("time");
    timecode.className = "paragraph-timecode";
    timecode.textContent = Number.isFinite(paragraph.start)
      ? `[${formatTimecode(paragraph.start)}]`
      : "[--:--]";
    const content = document.createElement("div");
    content.className = "paragraph-content";
    const textElement = document.createElement("div");
    textElement.className = "document-text";
    textElement.contentEditable = String(!isRunning && !visibleDocument.readOnly);
    textElement.dataset.paragraphId = String(paragraph.id);
    textElement.dataset.placeholder = "Текст протокола";
    textElement.textContent = paragraph.text;
    if (!visibleDocument.readOnly) {
      textElement.addEventListener("beforeinput", (event) => handleDocumentBeforeInput(event, paragraph));
      textElement.addEventListener("input", (event) => handleDocumentInput(event, paragraph, textElement));
      textElement.addEventListener("compositionstart", () => handleCompositionStart(paragraph, textElement));
      textElement.addEventListener("compositionend", handleCompositionEnd);
      textElement.addEventListener("keydown", handleEditorKeydown);
    }

    const speaker = getSpeaker(paragraph.speakerId, visibleDocument.speakers);
    if (visibleDocument.readOnly) {
      if (speaker) {
        const speakerName = document.createElement("span");
        speakerName.className = "speaker-name";
        speakerName.style.color = speaker.color;
        speakerName.textContent = `${speaker.name}:`;
        content.append(speakerName);
      }
    } else {
      const speakerControl = document.createElement("button");
      speakerControl.className = "speaker-control";
      speakerControl.type = "button";
      speakerControl.disabled = isRunning;
      speakerControl.classList.toggle("is-unassigned", !speaker);
      speakerControl.textContent = speaker ? `${speaker.name}:` : "+ говорящий";
      if (speaker) {
        speakerControl.style.borderColor = speaker.color;
        speakerControl.style.color = speaker.color;
      }
      speakerControl.addEventListener("click", () => toggleSpeakerPopover(paragraph.id));
      content.append(speakerControl);

      if (openSpeakerPopoverParagraphId === paragraph.id) {
        const popover = document.createElement("div");
        popover.className = "speaker-popover";
        popover.dataset.speakerPopover = "true";
        const noSpeakerButton = document.createElement("button");
        noSpeakerButton.type = "button";
        noSpeakerButton.disabled = isRunning;
        noSpeakerButton.textContent = "Без говорящего";
        noSpeakerButton.setAttribute("aria-pressed", String(paragraph.speakerId === null));
        noSpeakerButton.addEventListener("click", () => setParagraphSpeaker(paragraph.id, null));
        popover.append(noSpeakerButton);
        for (const availableSpeaker of speakers) {
          const choice = document.createElement("button");
          choice.type = "button";
          choice.disabled = isRunning;
          choice.textContent = availableSpeaker.name;
          choice.style.color = availableSpeaker.color;
          choice.setAttribute("aria-pressed", String(paragraph.speakerId === availableSpeaker.id));
          choice.addEventListener("click", () => setParagraphSpeaker(paragraph.id, availableSpeaker.id));
          popover.append(choice);
        }
        paragraphElement.append(popover);
      }
    }
    content.append(textElement);
    paragraphElement.append(timecode, content);
    editor.append(paragraphElement);
  }

  setRunning(isRunning);
  traceEditorSnapshot("render-editor", { empty: false });
}

selectUpdatePackageButton.addEventListener("click", async () => {
  if (updateOperationInProgress) {
    return;
  }
  const packagePath = await window.asr.selectUpdatePackage();
  if (!packagePath) {
    return;
  }
  selectedUpdatePackage = packagePath;
  renderUpdateControls();
});

checkOnlineUpdateButton.addEventListener("click", async () => {
  if (updateOperationInProgress || preparedUpdate) {
    return;
  }
  updateOperationInProgress = true;
  renderUpdateControls();
  clearToast();
  try {
    const result = await window.asr.checkOnlineUpdate();
    availableOnlineUpdate = result.available ? result : null;
    showToast(result.available
      ? `Доступно обновление Client ${result.version}. Скачайте его, чтобы продолжить.`
      : "Обновлений не найдено.");
  } catch (error) {
    availableOnlineUpdate = null;
    showToast(`Не удалось проверить обновления: ${error.message}`);
  } finally {
    updateOperationInProgress = false;
    renderUpdateControls();
  }
});

downloadOnlineUpdateButton.addEventListener("click", async () => {
  if (!availableOnlineUpdate || updateOperationInProgress || preparedUpdate) {
    return;
  }
  updateOperationInProgress = true;
  renderUpdateControls();
  clearToast();
  try {
    selectedUpdatePackage = await window.asr.downloadOnlineUpdate();
    availableOnlineUpdate = null;
    showToast("Обновление скачано. Подготовьте его, когда будете готовы.");
  } catch (error) {
    showToast(`Не удалось скачать обновление: ${error.message}`);
  } finally {
    updateOperationInProgress = false;
    renderUpdateControls();
  }
});

prepareUpdateButton.addEventListener("click", async () => {
  if (!selectedUpdatePackage || updateOperationInProgress || preparedUpdate) {
    return;
  }
  updateOperationInProgress = true;
  renderUpdateControls();
  clearToast();
  try {
    preparedUpdate = await window.asr.prepareUpdate(selectedUpdatePackage);
    selectedUpdatePackage = null;
    showToast("Обновление подготовлено. Можно продолжать работу или перезапустить приложение для применения.");
  } catch (error) {
    showToast(`Не удалось подготовить обновление: ${error.message}`);
  } finally {
    updateOperationInProgress = false;
    renderUpdateControls();
  }
});

cancelUpdateButton.addEventListener("click", async () => {
  if (!preparedUpdate || updateOperationInProgress || isRunning) {
    return;
  }
  updateOperationInProgress = true;
  renderUpdateControls();
  try {
    await window.asr.cancelUpdate();
    preparedUpdate = null;
    showToast("Подготовленное обновление отменено.");
  } catch (error) {
    showToast(`Не удалось отменить обновление: ${error.message}`);
  } finally {
    updateOperationInProgress = false;
    renderUpdateControls();
  }
});

activateUpdateButton.addEventListener("click", async () => {
  if (!preparedUpdate || updateOperationInProgress || isRunning) {
    return;
  }
  if (!await confirmDocumentAction("activate-update")) {
    return;
  }
  if (!await confirmDocumentCanBeReplaced()) {
    return;
  }
  updateOperationInProgress = true;
  renderUpdateControls();
  clearToast();
  try {
    await window.asr.activateUpdate();
  } catch (error) {
    updateOperationInProgress = false;
    showToast(`Не удалось применить обновление: ${error.message}`);
    renderUpdateControls();
  }
});

selectFileButton.addEventListener("click", async () => {
  traceEditorSnapshot("file-picker: before-open");
  const filePath = await window.asr.selectMedia();
  if (!filePath) {
    traceEditorSnapshot("file-picker: cancelled");
    return;
  }
  if (!await confirmDocumentCanBeReplaced()) {
    return;
  }

  clearAutosaveTimer();
  clearEditorHistory();
  clearSaveStatus();
  closeDialog(editorToolbar);
  selectedFile = filePath;
  sourceSegmentsPath = null;
  isSavedRunOpen = false;
  setSavedRunActionsVisible(false);
  clearRecognizedSource();
  resetEditorState();
  isProjectDirty = false;
  hasProjectEdits = false;
  isShowingRecognized = false;
  openSpeakerPopoverParagraphId = null;
  fileName.value = formatSourceName(filePath);
  renderSpeakerList();
  renderEditor();
  clearToast();
  setRunning(false);
});

transcribeButton.addEventListener("click", async () => {
  if (!selectedFile || isRunning) {
    return;
  }
  if (!await confirmDocumentCanBeReplaced()) {
    return;
  }

  setRunning(true);
  clearAutosaveTimer();
  clearEditorHistory();
  clearSaveStatus();
  closeDialog(editorToolbar);
  sourceSegmentsPath = null;
  isSavedRunOpen = false;
  setSavedRunActionsVisible(false);
  clearRecognizedSource();
  resetEditorState();
  isProjectDirty = false;
  hasProjectEdits = false;
  isShowingRecognized = false;
  openSpeakerPopoverParagraphId = null;
  renderSpeakerList();
  renderEditor();
  clearSupportReport();
  clearToast();
  startRecognitionProgress();
  try {
    const response = await window.asr.transcribe(selectedFile);
    stopRecognitionProgress();
    if (!response.ok) {
      showSupportReport(response.error);
      showToast(`Ошибка: ${response.error.message}`);
      return;
    }
    const { result } = response;
    sourceSegmentsPath = result.segmentsPath;
    setRecognizedSource(result.segments, result.transcript);
    loadSegments(result.segments, result.transcript);
    isProjectDirty = false;
    renderEditor();
    initializeEditorHistory();
    if (!result.segments.length) {
      showToast("Готово: речь не найдена.");
    }
  } catch (error) {
    showToast(`Ошибка: ${error.message}`);
  } finally {
    stopRecognitionProgress();
    setRunning(false);
    renderEditor();
  }
});

openSavedButton.addEventListener("click", async () => {
  if (isRunning) {
    return;
  }

  moreMenu.open = false;
  setSavedRunsVisible(true);
  setRunning(true);
  clearToast();
  try {
    await refreshSavedRuns();
  } catch (error) {
    setSavedRunsVisible(false);
    showToast(`Ошибка загрузки списка: ${error.message}`);
  } finally {
    setRunning(false);
  }
});

revealSupportReportButton.addEventListener("click", async () => {
  if (!pendingSupportReportPath) {
    return;
  }
  try {
    await window.asr.revealSupportReport(pendingSupportReportPath);
  } catch (error) {
    showToast(`Не удалось открыть файл отчёта: ${error.message}`);
  }
});

closeSavedRunsButton.addEventListener("click", () => setSavedRunsVisible(false));

closeSupportReportButton.addEventListener("click", () => closeDialog(supportReport));

savedRunsPanel.addEventListener("close", () => {
  openSavedButton.setAttribute("aria-expanded", "false");
});

selectResultsDirectoryButton.addEventListener("click", async () => {
  if (isRunning) {
    return;
  }

  setRunning(true);
  try {
    const dataDirectory = await window.asr.selectResultsDirectory();
    if (!dataDirectory) {
      showToast("Смена папки результатов отменена.");
      return;
    }

    setResultsDirectory(dataDirectory);
    isSavedRunOpen = false;
    setSavedRunActionsVisible(false);
    if (savedRunsPanel.open) {
      await refreshSavedRuns();
    }
    showToast("Папка результатов изменена. Новые прогоны будут сохранены в ней.");
  } catch (error) {
    showToast(`Ошибка смены папки результатов: ${error.message}`);
  } finally {
    setRunning(false);
  }
});

revealResultsDirectoryButton.addEventListener("click", async () => {
  if (isRunning || !resultsDirectoryPath) {
    return;
  }

  setRunning(true);
  clearToast();
  try {
    await window.asr.revealResultsDirectory();
    showToast("Папка результатов открыта.");
  } catch (error) {
    showToast(`Ошибка открытия папки результатов: ${error.message}`);
  } finally {
    setRunning(false);
  }
});

revealRunButton.addEventListener("click", async () => {
  if (!sourceSegmentsPath || !isSavedRunOpen || isRunning) {
    return;
  }

  setRunning(true);
  clearToast();
  try {
    await window.asr.revealRunInFolder(sourceSegmentsPath);
    showToast("Папка прогона открыта.");
  } catch (error) {
    showToast(`Ошибка открытия папки: ${error.message}`);
  } finally {
    setRunning(false);
  }
});

deleteRunButton.addEventListener("click", async () => {
  if (!sourceSegmentsPath || !isSavedRunOpen || isRunning) {
    return;
  }

  clearToast();
  try {
    const confirmed = await window.asr.confirmDeleteRun(sourceSegmentsPath);
    if (!confirmed) {
      showToast("Удаление прогона отменено.");
      return;
    }

    await stopAutosaveForDeletedRun();
    setRunning(true);
    clearToast();
    await window.asr.deleteRun(sourceSegmentsPath);
    resetDeletedRunState();
    showToast("Прогон удалён вместе с подготовленным аудио, результатами и сохранёнными правками.");
  } catch (error) {
    showToast(`Ошибка удаления прогона: ${error.message}`);
  } finally {
    setRunning(false);
  }
});

editorToolbar.addEventListener("mousedown", (event) => {
  if (event.target instanceof HTMLButtonElement) {
    event.preventDefault();
  }
});

addSpeakerButton.addEventListener("click", createSpeaker);
speakerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    createSpeaker();
  }
});
document.addEventListener("click", (event) => {
  if (openSpeakerPopoverParagraphId === null || !(event.target instanceof Element)) {
    return;
  }
  if (event.target.closest(".speaker-control, .speaker-popover")) {
    return;
  }
  openSpeakerPopoverParagraphId = null;
  renderEditor();
});

document.addEventListener("selectionchange", () => {
  const selection = captureDocumentSelection();
  if (!selection) {
    return;
  }
  if (typingContext && !sameSelection(selection, typingContext.afterSelection)) {
    finishPendingTyping();
  }
  lastDocumentSelection = selection;
});

function hasSeparateTextInputFocus() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) {
    return false;
  }
  if (focused.matches("input, textarea")) {
    return true;
  }
  return focused.isContentEditable && !focused.closest(".document-text");
}

function canUseDocumentHistoryShortcut() {
  return Boolean(sourceSegmentsPath)
    && !isRunning
    && !isShowingRecognized
    && !getFocusOwningDialog();
}

function hasShortcutModifier(event) {
  return (event.ctrlKey || event.metaKey) && !event.altKey;
}

document.addEventListener("keydown", (event) => {
  if (event.isComposing || compositionState) {
    return;
  }
  if (hasShortcutModifier(event) && event.code === "KeyS" && sourceSegmentsPath && !isRunning) {
    event.preventDefault();
    void flushProjectFromShortcut();
    return;
  }
  if (hasShortcutModifier(event) && !hasSeparateTextInputFocus() && canUseDocumentHistoryShortcut()) {
    const isUndo = event.code === "KeyZ" && !event.shiftKey;
    const isRedo = event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey);
    if (isUndo || isRedo) {
      event.preventDefault();
      if (isRedo) {
        redoEditorTransaction();
      } else {
        undoEditorTransaction();
      }
      return;
    }
  }
  if (event.key === "Escape") {
    moreMenu.open = false;
    documentMore.open = false;
  }
});

copyTextButton.addEventListener("click", async () => {
  try {
    const visibleDocument = getVisibleDocument();
    await window.asr.copyText(getCleanText(visibleDocument.paragraphs, visibleDocument.speakers));
    showToast("Чистый текст скопирован в буфер обмена.");
  } catch (error) {
    showToast(`Ошибка копирования: ${error.message}`);
  }
});

saveButton.addEventListener("click", async () => {
  try {
    const visibleDocument = getVisibleDocument();
    const savedPath = await window.asr.saveTranscript(
      getCleanText(visibleDocument.paragraphs, visibleDocument.speakers),
    );
    if (savedPath) {
      showToast(`Сохранено: ${savedPath}`);
    }
  } catch (error) {
    showToast(`Ошибка сохранения: ${error.message}`);
  }
});

resetRecognizedButton.addEventListener("click", async () => {
  if (!sourceSegmentsPath || isRunning) {
    return;
  }
  traceEditorSnapshot("restore: before-confirm");
  closeDialog(editorActionsDialog);
  if (!await confirmDocumentAction("restore-recognized")) {
    traceEditorSnapshot("restore: confirm-cancelled");
    return;
  }
  traceEditorSnapshot("restore: confirm-accepted");
  if (!await confirmDocumentCanBeReplaced()) {
    traceEditorSnapshot("restore: replacement-cancelled");
    return;
  }

  setRunning(true);
  try {
    const segments = await window.asr.reloadSegments(sourceSegmentsPath);
    setRecognizedSource(segments);
    isShowingRecognized = false;
    traceEditorSnapshot("restore: before-transaction");
    runEditorTransaction("restore-source", () => {
      paragraphs = [];
      nextParagraphId = 1;
      loadSegments(segments);
      openSpeakerPopoverParagraphId = null;
      const firstParagraph = paragraphs[0];
      return firstParagraph ? {
        selection: {
          anchor: { paragraphId: firstParagraph.id, offset: 0 },
          focus: { paragraphId: firstParagraph.id, offset: 0 },
        },
      } : { selection: null };
    }, { restoreSelection: false });
    traceEditorSnapshot("restore: after-transaction");
    hasProjectEdits = false;
    showToast(segments.length
      ? "Восстановлен распознанный текст."
      : "В сохранённом результате нет текста.");
  } catch (error) {
    showToast(`Ошибка сброса: ${error.message}`);
  } finally {
    setRunning(false);
    renderEditor();
    traceEditorSnapshot("restore: final-render");
  }
});

showRecognizedButton.addEventListener("click", () => {
  if (!hasProjectEdits || isRunning || isShowingRecognized) {
    return;
  }

  isShowingRecognized = true;
  setRunning(isRunning);
  renderEditor();
  showToast("Показан распознанный текст. Правки сохранены в памяти.");
});

showEditsButton.addEventListener("click", () => {
  if (!hasProjectEdits || isRunning || !isShowingRecognized) {
    return;
  }

  isShowingRecognized = false;
  setRunning(isRunning);
  renderEditor();
  showToast("Показаны правки редактора.");
});

window.asr.onCloseRequested(async () => {
  await flushAutosaveBeforeClose();
  window.asr.reportProjectDirty(isProjectDirty);
});

window.asr.onProgress((message) => {
  recognitionProgressStage.textContent = message;
});

loadResultsDirectory();
refreshUpdateStatus();
showClientVersion();
