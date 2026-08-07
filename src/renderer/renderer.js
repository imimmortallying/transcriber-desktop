const selectFileButton = document.querySelector("#select-file");
const transcribeButton = document.querySelector("#transcribe");
const saveButton = document.querySelector("#save");
const fileName = document.querySelector("#file-name");
const status = document.querySelector("#status");
const transcript = document.querySelector("#transcript");

let selectedFile = null;
let isRunning = false;

function setRunning(running) {
  isRunning = running;
  selectFileButton.disabled = running;
  transcribeButton.disabled = running || !selectedFile;
  saveButton.disabled = running || !transcript.value;
}

selectFileButton.addEventListener("click", async () => {
  const filePath = await window.asr.selectMedia();
  if (!filePath) {
    return;
  }

  selectedFile = filePath;
  fileName.value = filePath;
  transcript.value = "";
  status.textContent = "Файл выбран. Можно начать распознавание.";
  setRunning(false);
});

transcribeButton.addEventListener("click", async () => {
  if (!selectedFile || isRunning) {
    return;
  }

  setRunning(true);
  transcript.value = "";
  status.textContent = "Запускаю распознавание…";
  try {
    const result = await window.asr.transcribe(selectedFile);
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
