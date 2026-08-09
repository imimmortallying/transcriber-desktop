const selectFileButton = document.querySelector("#select-file");
const transcribeButton = document.querySelector("#transcribe");
const openSavedButton = document.querySelector("#open-saved");
const copyButton = document.querySelector("#copy");
const saveButton = document.querySelector("#save");
const saveProjectButton = document.querySelector("#save-project");
const resetRecognizedButton = document.querySelector("#reset-recognized");
const toggleEditsButton = document.querySelector("#toggle-edits");
const addSpeakerButton = document.querySelector("#add-speaker");
const speakerNameInput = document.querySelector("#speaker-name");
const speakerChoice = document.querySelector("#speaker-choice");
const assignSpeakerButton = document.querySelector("#assign-speaker");
const splitReplicaButton = document.querySelector("#split-replica");
const insertRemarkButton = document.querySelector("#insert-remark");
const editorToolbar = document.querySelector("#editor-toolbar");
const fileName = document.querySelector("#file-name");
const status = document.querySelector("#status");
const editor = document.querySelector("#editor");
const documentMode = document.querySelector("#document-mode");

const PROJECT_SCHEMA_VERSION = 1;

let selectedFile = null;
let sourceSegmentsPath = null;
let isRunning = false;
let isProjectDirty = false;
let hasProjectEdits = false;
let isShowingRecognized = false;
let recognizedSegments = [];
let recognizedTranscript = "";
let paragraphs = [];
let speakers = [];
let nextParagraphId = 1;
let nextSpeakerId = 1;

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

function setRunning(running) {
  isRunning = running;
  const visibleDocument = getVisibleDocument();
  const readOnly = visibleDocument.readOnly;
  selectFileButton.disabled = running;
  transcribeButton.disabled = running || !selectedFile;
  openSavedButton.disabled = running;
  const hasCleanText = Boolean(getCleanText(visibleDocument.paragraphs, visibleDocument.speakers));
  copyButton.disabled = running || !hasCleanText;
  saveButton.disabled = running || !hasCleanText;
  saveProjectButton.disabled = running || !sourceSegmentsPath;
  resetRecognizedButton.disabled = running || !sourceSegmentsPath;
  toggleEditsButton.disabled = running || !hasProjectEdits;
  toggleEditsButton.textContent = isShowingRecognized
    ? "Показать правки"
    : "Показать распознанное";
  documentMode.textContent = !sourceSegmentsPath
    ? "Просмотр: нет документа"
    : isShowingRecognized || !hasProjectEdits
      ? "Просмотр: распознанный текст"
      : "Просмотр: правки";
  addSpeakerButton.disabled = running || readOnly;
  speakerNameInput.disabled = running || readOnly;
  speakerChoice.disabled = running || readOnly || !speakers.length;
  assignSpeakerButton.disabled = running || readOnly || !paragraphs.length || !speakerChoice.value;
  splitReplicaButton.disabled = running || readOnly || !paragraphs.length || !speakerChoice.value;
  insertRemarkButton.disabled = running || readOnly || !paragraphs.length;
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
  const restoredParagraphs = project.paragraphs.map((paragraph) => {
    assertProject(paragraph && typeof paragraph === "object", "некорректный абзац.");
    assertProject(Number.isSafeInteger(paragraph.id) && paragraph.id > 0, "некорректный id абзаца.");
    assertProject(!paragraphIds.has(paragraph.id), "повторяющийся id абзаца.");
    assertProject(["text", "replica", "remark"].includes(paragraph.type), "некорректный тип абзаца.");
    assertProject(typeof paragraph.text === "string", "некорректный текст абзаца.");
    assertProject(paragraph.speakerId === null || speakerIds.has(paragraph.speakerId), "абзац ссылается на неизвестного говорящего.");
    assertProject(isStoredTime(paragraph.start), "некорректный таймкод абзаца.");
    assertProject(Array.isArray(paragraph.timing), "отсутствует карта таймингов абзаца.");
    const timing = paragraph.timing.map((part) => {
      assertProject(part && typeof part === "object", "некорректная часть карты таймингов.");
      assertProject(Number.isSafeInteger(part.from) && Number.isSafeInteger(part.to), "некорректные границы карты таймингов.");
      assertProject(part.from >= 0 && part.to >= part.from && part.to <= paragraph.text.length, "границы карты таймингов выходят за текст абзаца.");
      assertProject(isStoredTime(part.start), "некорректный таймкод в карте таймингов.");
      return { from: part.from, to: part.to, start: part.start };
    });
    paragraphIds.add(paragraph.id);
    return {
      id: paragraph.id,
      type: paragraph.type,
      text: paragraph.text,
      speakerId: paragraph.speakerId,
      start: paragraph.start,
      timing,
    };
  });

  paragraphs = restoredParagraphs;
  speakers = restoredSpeakers;
  nextParagraphId = Math.max(0, ...paragraphs.map((paragraph) => paragraph.id)) + 1;
  nextSpeakerId = Math.max(0, ...speakers.map((speaker) => speaker.id)) + 1;
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

function updateSpeakerChoices() {
  const selectedId = speakerChoice.value;
  speakerChoice.replaceChildren(new Option("Выберите говорящего", ""));
  for (const speaker of speakers) {
    speakerChoice.add(new Option(speaker.name, String(speaker.id)));
  }
  speakerChoice.value = speakers.some((speaker) => String(speaker.id) === selectedId)
    ? selectedId
    : "";
  setRunning(isRunning);
}

function createSpeaker() {
  const normalizedName = speakerNameInput.value.trim();
  if (!normalizedName) {
    status.textContent = "Введите имя нового говорящего.";
    speakerNameInput.focus();
    return;
  }

  let speaker = speakers.find((item) => item.name === normalizedName);
  if (!speaker) {
    speaker = {
      id: nextSpeakerId++,
      name: normalizedName,
      color: getSpeakerColor(speakers.length),
    };
    speakers.push(speaker);
    markProjectDirty();
  }

  updateSpeakerChoices();
  speakerChoice.value = String(speaker.id);
  speakerNameInput.value = "";
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

function focusParagraph(paragraphId) {
  const textElement = editor.querySelector(`[data-paragraph-id="${paragraphId}"]`);
  textElement?.focus();
  if (textElement) {
    const range = document.createRange();
    range.selectNodeContents(textElement);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function splitDocument(kind) {
  const context = getSelectionContext();
  if (!context) {
    return;
  }

  const { paragraph, textElement, offset } = context;
  const sourceText = textElement.textContent || "";
  const originalStart = paragraph.start;
  const { left, right, point } = splitTiming(paragraph, offset);
  const index = paragraphs.findIndex((item) => item.id === paragraph.id);
  paragraph.text = sourceText.slice(0, offset);
  paragraph.timing = left;
  syncStart(paragraph, originalStart);
  markProjectDirty();

  if (kind === "replica") {
    const nextParagraph = createParagraph({
      type: "replica",
      text: sourceText.slice(offset),
      speakerId: Number(speakerChoice.value),
      start: point,
      timing: right,
    });
    syncStart(nextParagraph, point);
    paragraphs.splice(index + 1, 0, nextParagraph);
    renderEditor();
    focusParagraph(nextParagraph.id);
    return;
  }

  const remark = createParagraph({ type: "remark", start: point });
  const continuation = createParagraph({
    type: paragraph.type,
    text: sourceText.slice(offset),
    speakerId: paragraph.speakerId,
    start: point,
    timing: right,
  });
  syncStart(continuation, point);
  const inserted = continuation.text ? [remark, continuation] : [remark];
  paragraphs.splice(index + 1, 0, ...inserted);
  renderEditor();
  focusParagraph(remark.id);
}

function assignSpeaker() {
  const context = getSelectionContext();
  if (!context || !speakerChoice.value) {
    return;
  }

  context.paragraph.type = "replica";
  context.paragraph.speakerId = Number(speakerChoice.value);
  markProjectDirty();
  renderEditor();
  focusParagraph(context.paragraph.id);
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
    textElement.dataset.placeholder = paragraph.type === "remark"
      ? "Введите ремарку"
      : "Текст протокола";
    textElement.textContent = paragraph.text;
    if (!visibleDocument.readOnly) {
      textElement.addEventListener("input", () => {
        rescaleTiming(paragraph, textElement.textContent || "");
        markProjectDirty();
      });
      textElement.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        if (event.ctrlKey && speakerChoice.value) {
          splitDocument("replica");
        } else if (event.altKey) {
          splitDocument("remark");
        } else {
          status.textContent = "Используйте Ctrl+Enter для реплики или Alt+Enter для ремарки.";
        }
      });
    }

    const speaker = paragraph.type === "replica"
      ? getSpeaker(paragraph.speakerId, visibleDocument.speakers)
      : null;
    if (speaker) {
      const label = document.createElement("span");
      label.className = "speaker-label";
      label.style.color = speaker.color;
      label.textContent = `${speaker.name}:`;
      content.append(label);
    }
    content.append(textElement);
    paragraphElement.append(timecode, content);
    editor.append(paragraphElement);
  }

  setRunning(isRunning);
}

selectFileButton.addEventListener("click", async () => {
  const filePath = await window.asr.selectMedia();
  if (!filePath) {
    return;
  }

  selectedFile = filePath;
  sourceSegmentsPath = null;
  clearRecognizedSource();
  resetEditorState();
  isProjectDirty = false;
  hasProjectEdits = false;
  isShowingRecognized = false;
  fileName.value = filePath;
  updateSpeakerChoices();
  renderEditor();
  status.textContent = "Файл выбран. Можно начать распознавание.";
  setRunning(false);
});

transcribeButton.addEventListener("click", async () => {
  if (!selectedFile || isRunning) {
    return;
  }

  setRunning(true);
  sourceSegmentsPath = null;
  clearRecognizedSource();
  resetEditorState();
  isProjectDirty = false;
  hasProjectEdits = false;
  isShowingRecognized = false;
  updateSpeakerChoices();
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

  setRunning(true);
  status.textContent = "Выберите файл segments_asr.json.";
  try {
    const result = await window.asr.openSavedSegments();
    if (!result) {
      status.textContent = "Открытие сохранённого результата отменено.";
      return;
    }

    selectedFile = null;
    sourceSegmentsPath = null;
    clearRecognizedSource();
    isProjectDirty = false;
    hasProjectEdits = false;
    isShowingRecognized = false;
    resetEditorState();
    fileName.value = result.sourcePath;
    setRecognizedSource(result.segments);
    if (result.project) {
      restoreProject(result.project);
      hasProjectEdits = true;
      status.textContent = "Открыт сохранённый проект редактора.";
    } else {
      loadSegments(result.segments);
      status.textContent = result.segments.length
        ? `Открыто: сегментов — ${result.segments.length}.`
        : "В сохранённом результате нет сегментов.";
    }
    sourceSegmentsPath = result.sourcePath;
    isProjectDirty = false;
    updateSpeakerChoices();
  } catch (error) {
    status.textContent = `Ошибка открытия: ${error.message}`;
  } finally {
    setRunning(false);
    renderEditor();
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
speakerChoice.addEventListener("change", () => setRunning(isRunning));
assignSpeakerButton.addEventListener("click", assignSpeaker);
splitReplicaButton.addEventListener("click", () => splitDocument("replica"));
insertRemarkButton.addEventListener("click", () => splitDocument("remark"));

copyButton.addEventListener("click", async () => {
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
  if (isProjectDirty && !window.confirm("Несохранённые правки будут отброшены. Продолжить?")) {
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
    updateSpeakerChoices();
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

toggleEditsButton.addEventListener("click", () => {
  if (!hasProjectEdits || isRunning) {
    return;
  }

  isShowingRecognized = !isShowingRecognized;
  renderEditor();
  status.textContent = isShowingRecognized
    ? "Показан распознанный текст. Правки сохранены в памяти."
    : "Показаны правки редактора.";
});

window.asr.onProgress((message) => {
  status.textContent = message;
});
