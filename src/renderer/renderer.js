const selectFileButton = document.querySelector("#select-file");
const transcribeButton = document.querySelector("#transcribe");
const openSavedButton = document.querySelector("#open-saved");
const closeSavedRunsButton = document.querySelector("#close-saved-runs");
const savedRunsPanel = document.querySelector("#saved-runs");
const savedRunsList = document.querySelector("#saved-runs-list");
const savedRunsEmpty = document.querySelector("#saved-runs-empty");
const copyTextButton = document.querySelector("#copy-text");
const saveButton = document.querySelector("#save");
const saveProjectButton = document.querySelector("#save-project");
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
const editor = document.querySelector("#editor");
const documentMode = document.querySelector("#document-mode");
const clientVersion = document.querySelector("#client-version");

const PROJECT_SCHEMA_VERSION = 1;
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

async function showClientVersion() {
  try {
    clientVersion.textContent = `Client v${await window.asr.getClientVersion()}`;
  } catch {
    clientVersion.textContent = "Client version unavailable";
  }
}

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
}

function markProjectDirty() {
  isProjectDirty = true;
  if (sourceSegmentsPath) {
    hasProjectEdits = true;
  }
  setRunning(isRunning);
}

function confirmDiscardUnsavedChanges() {
  return !isProjectDirty || window.confirm("Несохранённые правки будут потеряны. Продолжить?");
}

function setRunning(running) {
  isRunning = running;
  const visibleDocument = getVisibleDocument();
  const readOnly = visibleDocument.readOnly;
  selectFileButton.disabled = running;
  transcribeButton.disabled = running || !selectedFile;
  openSavedButton.disabled = running;
  selectResultsDirectoryButton.disabled = running;
  revealResultsDirectoryButton.disabled = running || !resultsDirectoryPath;
  const hasCleanText = Boolean(getCleanText(visibleDocument.paragraphs, visibleDocument.speakers));
  copyTextButton.disabled = running || !hasCleanText;
  saveButton.disabled = running || !hasCleanText;
  saveProjectButton.disabled = running || !sourceSegmentsPath;
  resetRecognizedButton.disabled = running || !sourceSegmentsPath;
  showRecognizedButton.disabled = running || !hasProjectEdits;
  showEditsButton.disabled = running || !hasProjectEdits;
  revealRunButton.disabled = running || !isSavedRunOpen;
  deleteRunButton.disabled = running || !isSavedRunOpen;
  showRecognizedButton.classList.toggle("is-active", isShowingRecognized);
  showRecognizedButton.setAttribute("aria-pressed", String(isShowingRecognized));
  showEditsButton.classList.toggle("is-active", !isShowingRecognized);
  showEditsButton.setAttribute("aria-pressed", String(!isShowingRecognized));
  documentMode.textContent = !sourceSegmentsPath
    ? "Просмотр: нет документа"
    : isShowingRecognized || !hasProjectEdits
      ? "Просмотр: распознанный текст"
      : "Просмотр: правки";
  addSpeakerButton.disabled = running || readOnly;
  speakerNameInput.disabled = running || readOnly;
  savedRunsPanel.querySelectorAll("button").forEach((button) => {
    button.disabled = running;
  });
  renderUpdateControls();
  updateActiveSavedRun();
}

function renderUpdateControls() {
  checkOnlineUpdateButton.disabled = updateOperationInProgress || Boolean(preparedUpdate);
  downloadOnlineUpdateButton.disabled = updateOperationInProgress || Boolean(preparedUpdate) || !availableOnlineUpdate;
  selectUpdatePackageButton.disabled = updateOperationInProgress || Boolean(preparedUpdate);
  prepareUpdateButton.disabled = updateOperationInProgress || !selectedUpdatePackage || Boolean(preparedUpdate);
  activateUpdateButton.disabled = updateOperationInProgress || isRunning || !preparedUpdate;
  cancelUpdateButton.disabled = updateOperationInProgress || isRunning || !preparedUpdate;
  updatePackageName.textContent = selectedUpdatePackage || "No update package selected";
  updateStatus.textContent = preparedUpdate
    ? `Prepared Client ${preparedUpdate.candidateClient.version}; restart is required to apply it.`
    : "No Client Update is prepared.";
}

async function refreshUpdateStatus() {
  try {
    preparedUpdate = await window.asr.getUpdateStatus();
  } catch {
    preparedUpdate = null;
  }
  renderUpdateControls();
}

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
    status.textContent = `Ошибка настроек: ${error.message}`;
  }
}

function resetDeletedRunState() {
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
  renderEditor();
}

function setSavedRunsVisible(visible) {
  savedRunsPanel.hidden = !visible;
  openSavedButton.setAttribute("aria-expanded", String(visible));
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
  selectedFile = null;
  sourceSegmentsPath = null;
  clearRecognizedSource();
  isProjectDirty = false;
  hasProjectEdits = false;
  isShowingRecognized = false;
  openSpeakerPopoverParagraphId = null;
  resetEditorState();
  fileName.value = result.sourcePath;
  setRecognizedSource(result.segments);
  if (result.project) {
    const { migratedRemark } = restoreProject(result.project);
    hasProjectEdits = true;
    status.textContent = migratedRemark
      ? "Открыт сохранённый проект. Ремарки из старого файла преобразованы в обычный текст."
      : "Открыт сохранённый проект редактора.";
  } else {
    loadSegments(result.segments);
    status.textContent = result.segments.length
      ? `Открыто: сегментов — ${result.segments.length}.`
      : "В сохранённом результате нет сегментов.";
  }
  sourceSegmentsPath = result.sourcePath;
  isSavedRunOpen = true;
  setSavedRunActionsVisible(true);
  isProjectDirty = false;
  renderSpeakerList();
}

async function openSavedRun(segmentsPath) {
  if (isRunning) {
    return;
  }
  if (!confirmDiscardUnsavedChanges()) {
    return;
  }

  setRunning(true);
  status.textContent = "Открываю сохранённый результат…";
  try {
    const result = await window.asr.openRun(segmentsPath);
    applyOpenedSavedRun(result);
    setSavedRunsVisible(false);
  } catch (error) {
    status.textContent = `Ошибка открытия: ${error.message}`;
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
  status.textContent = "Открываю папку прогона…";
  try {
    await window.asr.revealRunInFolder(segmentsPath);
    status.textContent = "Папка прогона открыта.";
  } catch (error) {
    status.textContent = `Ошибка открытия папки: ${error.message}`;
  } finally {
    setRunning(false);
  }
}

async function deleteSavedRun(segmentsPath) {
  if (isRunning) {
    return;
  }

  status.textContent = "Ожидаю подтверждение удаления прогона…";
  try {
    const confirmed = await window.asr.confirmDeleteRun(segmentsPath);
    if (!confirmed) {
      status.textContent = "Удаление прогона отменено.";
      return;
    }

    setRunning(true);
    status.textContent = "Удаляю прогон…";
    await window.asr.deleteRun(segmentsPath);
    await refreshSavedRuns();
    status.textContent = "Прогон удалён вместе с подготовленным аудио, результатами и сохранёнными правками.";
  } catch (error) {
    status.textContent = `Ошибка удаления прогона: ${error.message}`;
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
    item.style.color = speaker.color;
    item.textContent = speaker.name;
    speakerList.append(item);
  }
}

function createSpeaker() {
  const normalizedName = speakerNameInput.value.trim();
  if (!normalizedName) {
    status.textContent = "Введите имя нового говорящего.";
    speakerNameInput.focus();
    return;
  }

  if (!speakers.some((item) => item.name === normalizedName)) {
    speakers.push({
      id: nextSpeakerId++,
      name: normalizedName,
      color: getSpeakerColor(speakers.length),
    });
    markProjectDirty();
  }

  speakerNameInput.value = "";
  renderSpeakerList();
  setRunning(isRunning);
}

function getSelectionContext() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!range.collapsed) {
    status.textContent = "Поставьте курсор в нужное место текста.";
    return null;
  }

  const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const textElement = node?.closest(".document-text");
  if (!textElement || !editor.contains(textElement)) {
    status.textContent = "Поставьте курсор в абзац документа.";
    return null;
  }

  const paragraph = getParagraph(Number(textElement.dataset.paragraphId));
  if (!paragraph) {
    return null;
  }

  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(textElement);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  return { paragraph, textElement, offset: beforeRange.toString().length };
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

function focusParagraph(paragraphId, offset = 0) {
  const textElement = editor.querySelector(`[data-paragraph-id="${paragraphId}"]`);
  textElement?.focus();
  if (textElement) {
    const range = document.createRange();
    const textNode = textElement.firstChild;
    if (textNode?.nodeType === Node.TEXT_NODE) {
      range.setStart(textNode, Math.min(offset, textNode.textContent.length));
      range.collapse(true);
    } else {
      range.selectNodeContents(textElement);
      range.collapse(true);
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
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
    status.textContent = "Ctrl+Enter делит только текст с обеих сторон курсора.";
    return;
  }
  const originalStart = paragraph.start;
  const { left, right, point } = splitTiming(paragraph, offset);
  const index = paragraphs.findIndex((item) => item.id === paragraph.id);
  paragraph.text = leftText;
  paragraph.timing = left;
  syncStart(paragraph, originalStart);
  markProjectDirty();

  const nextParagraph = createParagraph({
    type: "replica",
    text: rightText,
    speakerId: paragraph.type === "replica" ? paragraph.speakerId : null,
    start: point,
    timing: right,
  });
  syncStart(nextParagraph, point);
  paragraphs.splice(index + 1, 0, nextParagraph);
  renderEditor();
  focusParagraph(nextParagraph.id);
}

function mergeParagraphWithPrevious(paragraph) {
  const index = paragraphs.findIndex((item) => item.id === paragraph.id);
  if (index <= 0) {
    return false;
  }

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
  markProjectDirty();
  renderEditor();
  focusParagraph(previous.id, splitOffset);
  return true;
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

  paragraph.type = speakerId === null ? "text" : "replica";
  paragraph.speakerId = speakerId;
  openSpeakerPopoverParagraphId = null;
  markProjectDirty();
  renderEditor();
}

function renderEditor() {
  const visibleDocument = getVisibleDocument();
  editor.replaceChildren();
  if (!visibleDocument.paragraphs.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "editor-placeholder";
    placeholder.textContent = "Здесь появится расшифровка.";
    editor.append(placeholder);
    setRunning(isRunning);
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
      textElement.addEventListener("input", () => {
        rescaleTiming(paragraph, textElement.textContent || "");
        markProjectDirty();
      });
      textElement.addEventListener("keydown", (event) => {
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
      });
    }

    const speaker = paragraph.type === "replica"
      ? getSpeaker(paragraph.speakerId, visibleDocument.speakers)
      : null;
    if (!visibleDocument.readOnly && paragraph.type === "replica") {
      const speakerControl = document.createElement("button");
      speakerControl.className = "speaker-control";
      speakerControl.type = "button";
      speakerControl.disabled = isRunning;
      speakerControl.textContent = speaker ? speaker.name : "Назначить говорящего";
      if (speaker) {
        speakerControl.style.borderColor = speaker.color;
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
  status.textContent = "Checking for Client Updates…";
  try {
    const result = await window.asr.checkOnlineUpdate();
    availableOnlineUpdate = result.available ? result : null;
    status.textContent = result.available
      ? `Client ${result.version} is available. Download it to continue.`
      : "No Client Update is available.";
  } catch (error) {
    availableOnlineUpdate = null;
    status.textContent = `Unable to check for updates: ${error.message}`;
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
  status.textContent = `Downloading Client ${availableOnlineUpdate.version}…`;
  try {
    selectedUpdatePackage = await window.asr.downloadOnlineUpdate();
    availableOnlineUpdate = null;
    status.textContent = "Client Update downloaded. Prepare it when ready.";
  } catch (error) {
    status.textContent = `Unable to download Client Update: ${error.message}`;
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
  status.textContent = "Preparing signed Client Update…";
  try {
    preparedUpdate = await window.asr.prepareUpdate(selectedUpdatePackage);
    selectedUpdatePackage = null;
    status.textContent = "Client Update is prepared. Continue working or restart to apply it.";
  } catch (error) {
    status.textContent = `Update preparation failed: ${error.message}`;
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
    status.textContent = "Prepared Client Update was cancelled.";
  } catch (error) {
    status.textContent = `Update cancellation failed: ${error.message}`;
  } finally {
    updateOperationInProgress = false;
    renderUpdateControls();
  }
});

activateUpdateButton.addEventListener("click", async () => {
  if (!preparedUpdate || updateOperationInProgress || isRunning) {
    return;
  }
  if (!window.confirm("ASR will restart and be temporarily unavailable while the new Client starts. Continue?")) {
    return;
  }
  if (!confirmDiscardUnsavedChanges()) {
    return;
  }
  isProjectDirty = false;
  updateOperationInProgress = true;
  renderUpdateControls();
  status.textContent = "Restarting ASR to validate the prepared Client Update…";
  try {
    await window.asr.activateUpdate();
  } catch (error) {
    updateOperationInProgress = false;
    status.textContent = `Update activation failed: ${error.message}`;
    renderUpdateControls();
  }
});

selectFileButton.addEventListener("click", async () => {
  const filePath = await window.asr.selectMedia();
  if (!filePath) {
    return;
  }
  if (!confirmDiscardUnsavedChanges()) {
    return;
  }

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
  fileName.value = filePath;
  renderSpeakerList();
  renderEditor();
  status.textContent = "Файл выбран. Можно начать распознавание.";
  setRunning(false);
});

transcribeButton.addEventListener("click", async () => {
  if (!selectedFile || isRunning) {
    return;
  }
  if (!confirmDiscardUnsavedChanges()) {
    return;
  }

  setRunning(true);
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
  status.textContent = "Запускаю распознавание…";
  try {
    const result = await window.asr.transcribe(selectedFile);
    sourceSegmentsPath = result.segmentsPath;
    setRecognizedSource(result.segments, result.transcript);
    loadSegments(result.segments, result.transcript);
    isProjectDirty = false;
    renderEditor();
    status.textContent = result.segments.length
      ? `Готово: распознано сегментов — ${result.segments.length}.`
      : "Готово: речь не найдена.";
  } catch (error) {
    status.textContent = `Ошибка: ${error.message}`;
  } finally {
    setRunning(false);
    renderEditor();
  }
});

openSavedButton.addEventListener("click", async () => {
  if (isRunning) {
    return;
  }

  if (!savedRunsPanel.hidden) {
    setSavedRunsVisible(false);
    return;
  }

  setSavedRunsVisible(true);
  setRunning(true);
  status.textContent = "Загружаю сохранённые прогоны…";
  try {
    await refreshSavedRuns();
    status.textContent = "Выберите сохранённый прогон.";
  } catch (error) {
    setSavedRunsVisible(false);
    status.textContent = `Ошибка загрузки списка: ${error.message}`;
  } finally {
    setRunning(false);
  }
});

closeSavedRunsButton.addEventListener("click", () => setSavedRunsVisible(false));

selectResultsDirectoryButton.addEventListener("click", async () => {
  if (isRunning) {
    return;
  }

  setRunning(true);
  try {
    const dataDirectory = await window.asr.selectResultsDirectory();
    if (!dataDirectory) {
      status.textContent = "Смена папки результатов отменена.";
      return;
    }

    setResultsDirectory(dataDirectory);
    isSavedRunOpen = false;
    setSavedRunActionsVisible(false);
    if (!savedRunsPanel.hidden) {
      await refreshSavedRuns();
    }
    status.textContent = "Папка результатов изменена. Новые прогоны будут сохранены в ней.";
  } catch (error) {
    status.textContent = `Ошибка смены папки результатов: ${error.message}`;
  } finally {
    setRunning(false);
  }
});

revealResultsDirectoryButton.addEventListener("click", async () => {
  if (isRunning || !resultsDirectoryPath) {
    return;
  }

  setRunning(true);
  status.textContent = "Открываю папку результатов…";
  try {
    await window.asr.revealResultsDirectory();
    status.textContent = "Папка результатов открыта.";
  } catch (error) {
    status.textContent = `Ошибка открытия папки результатов: ${error.message}`;
  } finally {
    setRunning(false);
  }
});

revealRunButton.addEventListener("click", async () => {
  if (!sourceSegmentsPath || !isSavedRunOpen || isRunning) {
    return;
  }

  setRunning(true);
  status.textContent = "Открываю папку прогона…";
  try {
    await window.asr.revealRunInFolder(sourceSegmentsPath);
    status.textContent = "Папка прогона открыта.";
  } catch (error) {
    status.textContent = `Ошибка открытия папки: ${error.message}`;
  } finally {
    setRunning(false);
  }
});

deleteRunButton.addEventListener("click", async () => {
  if (!sourceSegmentsPath || !isSavedRunOpen || isRunning) {
    return;
  }

  status.textContent = "Ожидаю подтверждение удаления прогона…";
  try {
    const confirmed = await window.asr.confirmDeleteRun(sourceSegmentsPath);
    if (!confirmed) {
      status.textContent = "Удаление прогона отменено.";
      return;
    }

    setRunning(true);
    status.textContent = "Удаляю прогон…";
    await window.asr.deleteRun(sourceSegmentsPath);
    resetDeletedRunState();
    status.textContent = "Прогон удалён вместе с подготовленным аудио, результатами и сохранёнными правками.";
  } catch (error) {
    status.textContent = `Ошибка удаления прогона: ${error.message}`;
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !savedRunsPanel.hidden) {
    setSavedRunsVisible(false);
  }
});

copyTextButton.addEventListener("click", async () => {
  try {
    const visibleDocument = getVisibleDocument();
    await window.asr.copyText(getCleanText(visibleDocument.paragraphs, visibleDocument.speakers));
    status.textContent = "Чистый текст скопирован в буфер обмена.";
  } catch (error) {
    status.textContent = `Ошибка копирования: ${error.message}`;
  }
});

saveButton.addEventListener("click", async () => {
  try {
    const visibleDocument = getVisibleDocument();
    const savedPath = await window.asr.saveTranscript(
      getCleanText(visibleDocument.paragraphs, visibleDocument.speakers),
    );
    if (savedPath) {
      status.textContent = `Сохранено: ${savedPath}`;
    }
  } catch (error) {
    status.textContent = `Ошибка сохранения: ${error.message}`;
  }
});

saveProjectButton.addEventListener("click", async () => {
  if (!sourceSegmentsPath || isRunning) {
    return;
  }

  setRunning(true);
  try {
    const savedPath = await window.asr.saveProject(sourceSegmentsPath, serializeProject());
    isProjectDirty = false;
    status.textContent = `Проект сохранён: ${savedPath}`;
  } catch (error) {
    status.textContent = `Ошибка сохранения проекта: ${error.message}`;
  } finally {
    setRunning(false);
  }
});

resetRecognizedButton.addEventListener("click", async () => {
  if (!sourceSegmentsPath || isRunning) {
    return;
  }
  if (!confirmDiscardUnsavedChanges()) {
    return;
  }

  setRunning(true);
  try {
    const segments = await window.asr.reloadSegments(sourceSegmentsPath);
    setRecognizedSource(segments);
    resetEditorState();
    loadSegments(segments);
    isProjectDirty = false;
    hasProjectEdits = false;
    isShowingRecognized = false;
    openSpeakerPopoverParagraphId = null;
    renderSpeakerList();
    status.textContent = segments.length
      ? `Восстановлен распознанный текст: сегментов — ${segments.length}.`
      : "В сохранённом результате нет сегментов.";
  } catch (error) {
    status.textContent = `Ошибка сброса: ${error.message}`;
  } finally {
    setRunning(false);
    renderEditor();
  }
});

showRecognizedButton.addEventListener("click", () => {
  if (!hasProjectEdits || isRunning || isShowingRecognized) {
    return;
  }

  isShowingRecognized = true;
  setRunning(isRunning);
  renderEditor();
  status.textContent = "Показан распознанный текст. Правки сохранены в памяти.";
});

showEditsButton.addEventListener("click", () => {
  if (!hasProjectEdits || isRunning || !isShowingRecognized) {
    return;
  }

  isShowingRecognized = false;
  setRunning(isRunning);
  renderEditor();
  status.textContent = "Показаны правки редактора.";
});

window.asr.onCloseRequested(() => {
  window.asr.reportProjectDirty(isProjectDirty);
});

window.asr.onProgress((message) => {
  status.textContent = message;
});

loadResultsDirectory();
refreshUpdateStatus();
showClientVersion();
