const selectFileButton = document.querySelector("#select-file");
const transcribeButton = document.querySelector("#transcribe");
const diarizeButton = document.querySelector("#diarize");
const saveButton = document.querySelector("#save");
const showFlatButton = document.querySelector("#show-flat");
const showMergedDialogButton = document.querySelector("#show-dialog-merged");
const showRawDialogButton = document.querySelector("#show-dialog-raw");
const fileName = document.querySelector("#file-name");
const status = document.querySelector("#status");
const transcript = document.querySelector("#transcript");
const dialog = document.querySelector("#dialog");

let selectedFile = null;
let isRunning = false;
let recognitionResult = null;

function setRunning(running) {
  isRunning = running;
  selectFileButton.disabled = running;
  transcribeButton.disabled = running || !selectedFile;
  diarizeButton.disabled = running || !recognitionResult?.runId;
  saveButton.disabled = running || !transcript.value;
}

function setView(view) {
  const isDialog = view !== "flat";
  transcript.hidden = isDialog;
  dialog.hidden = !isDialog;
  showFlatButton.setAttribute("aria-pressed", String(view === "flat"));
  showMergedDialogButton.setAttribute("aria-pressed", String(view === "merged"));
  showRawDialogButton.setAttribute("aria-pressed", String(view === "raw"));
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

function renderDialog(segments, { mergeConsecutive = true } = {}) {
  const speakerNames = new Map();
  const turns = [];
  for (const segment of segments) {
    const speaker = segment.speaker || "UNKNOWN";
    const current = turns.at(-1);
    if (mergeConsecutive && current && current.speaker === speaker) {
      current.text.push(segment.text);
    } else {
      turns.push({ speaker, start: segment.start, text: [segment.text] });
    }
  }

  dialog.replaceChildren();
  for (const turn of turns) {
    if (!speakerNames.has(turn.speaker)) {
      speakerNames.set(turn.speaker, speakerNames.size + 1);
    }
    const turnElement = document.createElement("article");
    turnElement.className = "dialog-turn";
    const speakerName = turn.speaker === "UNKNOWN"
      ? "Говорящий не определён"
      : `Говорящий ${speakerNames.get(turn.speaker)}`;
    const text = turn.text.filter(Boolean).join(" ");

    if (!mergeConsecutive) {
      const lineElement = document.createElement("p");
      lineElement.className = "dialog-line";
      lineElement.textContent = `[${formatTimecode(turn.start)}] ${speakerName}: ${text}`;
      turnElement.append(lineElement);
      dialog.append(turnElement);
      continue;
    }

    const speakerElement = document.createElement("p");
    speakerElement.className = "dialog-speaker";
    speakerElement.textContent = speakerName;
    const textElement = document.createElement("p");
    textElement.className = "dialog-text";
    textElement.textContent = text;
    turnElement.append(speakerElement, textElement);
    dialog.append(turnElement);
  }
}

selectFileButton.addEventListener("click", async () => {
  const filePath = await window.asr.selectMedia();
  if (!filePath) {
    return;
  }

  selectedFile = filePath;
  recognitionResult = null;
  fileName.value = filePath;
  transcript.value = "";
  dialog.replaceChildren();
  showMergedDialogButton.disabled = true;
  showRawDialogButton.disabled = true;
  setView("flat");
  status.textContent = "Файл выбран. Можно начать распознавание.";
  setRunning(false);
});

transcribeButton.addEventListener("click", async () => {
  if (!selectedFile || isRunning) {
    return;
  }

  setRunning(true);
  recognitionResult = null;
  transcript.value = "";
  dialog.replaceChildren();
  showMergedDialogButton.disabled = true;
  showRawDialogButton.disabled = true;
  setView("flat");
  status.textContent = "Запускаю распознавание…";
  try {
    const result = await window.asr.transcribe(selectedFile);
    recognitionResult = result;
    transcript.value = result.transcript || "";
    status.textContent = result.segments.length
      ? `Готово: распознано сегментов — ${result.segments.length}.`
      : "Готово: речь не найдена.";
  } catch (error) {
    status.textContent = `Ошибка: ${error.message}`;
  } finally {
    setRunning(false);
  }
});

diarizeButton.addEventListener("click", async () => {
  if (!recognitionResult?.runId || isRunning) {
    return;
  }

  setRunning(true);
  try {
    const result = await window.asr.diarize(recognitionResult.runId);
    recognitionResult.segments = result.segments;
    renderDialog(result.segments, { mergeConsecutive: true });
    showMergedDialogButton.disabled = false;
    showRawDialogButton.disabled = false;
    setView("merged");
    status.textContent = "Готово: говорящие разделены.";
  } catch (error) {
    status.textContent = `Ошибка диаризации: ${error.message}`;
  } finally {
    setRunning(false);
  }
});

showFlatButton.addEventListener("click", () => setView("flat"));
showMergedDialogButton.addEventListener("click", () => {
  renderDialog(recognitionResult.segments, { mergeConsecutive: true });
  setView("merged");
});
showRawDialogButton.addEventListener("click", () => {
  renderDialog(recognitionResult.segments, { mergeConsecutive: false });
  setView("raw");
});

saveButton.addEventListener("click", async () => {
  try {
    const savedPath = await window.asr.saveTranscript(transcript.value);
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
