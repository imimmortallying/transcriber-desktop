const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");
const { readFile, rm, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { readSavedSegments, runRecognition } = require("./recognition/runRecognition");

const pipelineConfigPath = path.resolve(__dirname, "../pipeline/config.json");

function createWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function getRunDirectory(segmentsPath) {
  if (typeof segmentsPath !== "string") {
    throw new Error("Не найден исходный файл segments_asr.json.");
  }

  if (path.basename(segmentsPath).toLowerCase() !== "segments_asr.json") {
    throw new Error("Выберите файл segments_asr.json из сохранённого прогона.");
  }

  return path.dirname(path.resolve(segmentsPath));
}

function getEditsPath(segmentsPath) {
  return path.join(getRunDirectory(segmentsPath), "segments_asr.edits.json");
}

async function getPipelineDataDirectory() {
  let config;
  try {
    config = JSON.parse(await readFile(pipelineConfigPath, "utf8"));
  } catch (error) {
    throw new Error(`Не удалось прочитать настройки папки результатов: ${error.message}`);
  }

  const dataDir = typeof config.data_dir === "string" ? config.data_dir : "../data/pipeline";
  return path.resolve(path.dirname(pipelineConfigPath), dataDir);
}

async function getExistingManagedRunDirectory(segmentsPath) {
  const runDirectory = getRunDirectory(segmentsPath);
  const dataDirectory = await getPipelineDataDirectory();
  const relativePath = path.relative(dataDirectory, runDirectory);
  if (
    !relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.dirname(relativePath) !== "."
    || path.isAbsolute(relativePath)
  ) {
    throw new Error("Управление папкой доступно только для прогонов из data/pipeline.");
  }

  let sourceInfo;
  try {
    sourceInfo = await stat(segmentsPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Файл segments_asr.json уже удалён.");
    }
    throw error;
  }
  if (!sourceInfo.isFile()) {
    throw new Error("Файл segments_asr.json уже недоступен.");
  }

  let runInfo;
  try {
    runInfo = await stat(runDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Папка прогона уже удалена.");
    }
    throw error;
  }
  if (!runInfo.isDirectory()) {
    throw new Error("Папка прогона уже недоступна.");
  }

  return runDirectory;
}

async function readProjectEdits(segmentsPath) {
  const editsPath = getEditsPath(segmentsPath);
  let rawProject;
  try {
    rawProject = await readFile(editsPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  try {
    return JSON.parse(rawProject);
  } catch {
    throw new Error("Файл segments_asr.edits.json содержит некорректный JSON.");
  }
}

ipcMain.handle("dialog:select-media", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Выберите аудио или видео",
    properties: ["openFile"],
    filters: [{
      name: "Аудио и видео",
      extensions: ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "mkv", "avi", "mov", "webm"],
    }],
  });

  return canceled ? null : filePaths[0];
});

ipcMain.handle("dialog:open-saved-segments", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Открыть сохранённый результат",
    properties: ["openFile"],
    filters: [{ name: "ASR-сегменты", extensions: ["json"] }],
  });
  if (canceled || !filePaths[0]) {
    return null;
  }

  const segmentsPath = filePaths[0];
  if (path.basename(segmentsPath).toLowerCase() !== "segments_asr.json") {
    throw new Error("Выберите файл segments_asr.json из сохранённого прогона.");
  }

  return {
    sourcePath: segmentsPath,
    segments: await readSavedSegments(segmentsPath),
    project: await readProjectEdits(segmentsPath),
  };
});

ipcMain.handle("project:save", async (_event, segmentsPath, project) => {
  if (typeof segmentsPath !== "string" || !project || typeof project !== "object") {
    throw new Error("Не удалось сохранить проект редактора.");
  }

  const sourceInfo = await stat(segmentsPath);
  if (!sourceInfo.isFile()) {
    throw new Error("Файл segments_asr.json не найден.");
  }

  const editsPath = getEditsPath(segmentsPath);
  await writeFile(editsPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  return editsPath;
});

ipcMain.handle("segments:reload", async (_event, segmentsPath) => {
  if (typeof segmentsPath !== "string") {
    throw new Error("Не найден исходный файл segments_asr.json.");
  }

  getEditsPath(segmentsPath);
  return readSavedSegments(segmentsPath);
});

ipcMain.handle("run:reveal-in-folder", async (_event, segmentsPath) => {
  const runDirectory = await getExistingManagedRunDirectory(segmentsPath);
  const errorMessage = await shell.openPath(runDirectory);
  if (errorMessage) {
    throw new Error(`Не удалось открыть папку прогона: ${errorMessage}`);
  }
});

ipcMain.handle("run:confirm-delete", async (_event, segmentsPath) => {
  await getExistingManagedRunDirectory(segmentsPath);
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Удалить прогон распознавания?",
    message: "Папка прогона будет удалена без возможности восстановления.",
    detail: "Будут удалены подготовленное аудио, результаты распознавания и сохранённые правки, если они есть.",
    buttons: ["Удалить прогон", "Отмена"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });

  return response === 0;
});

ipcMain.handle("run:delete", async (_event, segmentsPath) => {
  const runDirectory = await getExistingManagedRunDirectory(segmentsPath);

  try {
    await rm(runDirectory, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Папка прогона уже удалена.");
    }
    throw new Error(`Не удалось удалить папку прогона: ${error.message}`);
  }

  return true;
});

ipcMain.handle("recognition:run", async (event, inputPath) => {
  if (typeof inputPath !== "string") {
    throw new Error("Не выбран файл для распознавания.");
  }

  const fileInfo = await stat(inputPath);
  if (!fileInfo.isFile()) {
    throw new Error("Выбранный путь не является файлом.");
  }

  return runRecognition(inputPath, {
    onProgress(status) {
      event.sender.send("recognition:progress", status);
    },
  });
});

ipcMain.handle("clipboard:write-text", (_event, text) => {
  if (typeof text !== "string") {
    throw new Error("Не удалось подготовить текст для копирования.");
  }

  clipboard.writeText(text);
});

ipcMain.handle("dialog:save-transcript", async (_event, transcript) => {
  if (typeof transcript !== "string" || !transcript.trim()) {
    throw new Error("Нет текста для сохранения.");
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Сохранить расшифровку",
    defaultPath: "transcript.txt",
    filters: [{ name: "Текст", extensions: ["txt"] }],
  });
  if (canceled || !filePath) {
    return null;
  }

  await writeFile(filePath, transcript, "utf8");
  return filePath;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
