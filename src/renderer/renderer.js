const selectFileButton = document.querySelector("#select-file");
const transcribeButton = document.querySelector("#transcribe");
const openSavedButton = document.querySelector("#open-saved");
const copyButton = document.querySelector("#copy");
const saveButton = document.querySelector("#save");
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

let selectedFile = null;
let isRunning = false;
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

function setRunning(running) {
  isRunning = running;
  selectFileButton.disabled = running;
  transcribeButton.disabled = running || !selectedFile;
  openSavedButton.disabled = running;
  const hasCleanText = Boolean(getCleanText());
  copyButton.disabled = running || !hasCleanText;
  saveButton.disabled = running || !hasCleanText;
  addSpeakerButton.disabled = running;
  speakerNameInput.disabled = running;
  speakerChoice.disabled = running || !speakers.length;
  assignSpeakerButton.disabled = running || !paragraphs.length || !speakerChoice.value;
  splitReplicaButton.disabled = running || !paragraphs.length || !speakerChoice.value;
  insertRemarkButton.disabled = running || !paragraphs.length;
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

function getSpeaker(speakerId) {
  return speakers.find((speaker) => speaker.id === speakerId) || null;
}

function getParagraph(paragraphId) {
  return paragraphs.find((paragraph) => paragraph.id === paragraphId) || null;
}

function getCleanText() {
  return paragraphs
    .map((paragraph) => {
      const text = paragraph.text.trim();
      if (!text) {
        return "";
      }

      const speaker = paragraph.type === "replica" ? getSpeaker(paragraph.speakerId) : null;
      return speaker ? `${speaker.name}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n\n");
}

function loadSegments(segments, transcript = "") {
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
  paragraphs = text
    ? [createParagraph({ text, timing, start: timing[0]?.start ?? null })]
    : transcript.trim() ? [createParagraph({ text: transcript })] : [];
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
  renderEditor();
  focusParagraph(context.paragraph.id);
}

function renderEditor() {
  editor.replaceChildren();
  if (!paragraphs.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "editor-placeholder";
    placeholder.textContent = "Здесь появится расшифровка.";
    editor.append(placeholder);
    setRunning(isRunning);
    return;
  }

  for (const paragraph of paragraphs) {
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
    textElement.contentEditable = String(!isRunning);
    textElement.dataset.paragraphId = String(paragraph.id);
    textElement.dataset.placeholder = paragraph.type === "remark"
      ? "Введите ремарку"
      : "Текст протокола";
    textElement.textContent = paragraph.text;
    textElement.addEventListener("input", () => {
      rescaleTiming(paragraph, textElement.textContent || "");
      setRunning(isRunning);
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

    const speaker = paragraph.type === "replica" ? getSpeaker(paragraph.speakerId) : null;
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
  paragraphs = [];
  speakers = [];
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
  paragraphs = [];
  renderEditor();
  status.textContent = "Запускаю распознавание…";
  try {
    const result = await window.asr.transcribe(selectedFile);
    loadSegments(result.segments, result.transcript);
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
    paragraphs = [];
    speakers = [];
    fileName.value = result.sourcePath;
    updateSpeakerChoices();
    loadSegments(result.segments);
    status.textContent = result.segments.length
      ? `Открыто: сегментов — ${result.segments.length}.`
      : "В сохранённом результате нет сегментов.";
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
    await window.asr.copyText(getCleanText());
    status.textContent = "Чистый текст скопирован в буфер обмена.";
  } catch (error) {
    status.textContent = `Ошибка копирования: ${error.message}`;
  }
});

saveButton.addEventListener("click", async () => {
  try {
    const savedPath = await window.asr.saveTranscript(getCleanText());
    if (savedPath) {
      status.textContent = `Сохранено: ${savedPath}`;
    }
  } catch (error) {
    status.textContent = `Ошибка сохранения: ${error.message}`;
  }
});

window.asr.onProgress((message) => {
  status.textContent = message;
});
