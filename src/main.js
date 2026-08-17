const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");
const { randomUUID } = require("node:crypto");
const { readFile, readdir, rm, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { readSavedSegments, runRecognition } = require("./recognition/runRecognition");

const pipelineDirectory = app.isPackaged
  ? path.join(process.resourcesPath, "pipeline")
  : path.resolve(__dirname, "../pipeline");
const pipelineConfigPath = path.join(pipelineDirectory, "config.json");

function getResultsSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

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

  let closeApproved = false;
  let closeCheckInProgress = false;
  let closeConfirmationVisible = false;
  let rendererReady = false;

  window.webContents.once("did-finish-load", () => {
    rendererReady = true;
  });

  const handleCloseState = async (event, isProjectDirty) => {
    if (event.sender !== window.webContents || !closeCheckInProgress) {
      return;
    }

    closeCheckInProgress = false;
    if (!isProjectDirty) {
      closeApproved = true;
      window.close();
      return;
    }

    closeConfirmationVisible = true;
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Несохранённые правки",
      message: "Несохранённые правки будут потеряны. Закрыть приложение?",
      buttons: ["Отмена", "Закрыть"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    closeConfirmationVisible = false;

    if (response === 1) {
      closeApproved = true;
      window.close();
    }
  };

  ipcMain.on("editor:close-state", handleCloseState);
  window.once("closed", () => {
    ipcMain.removeListener("editor:close-state", handleCloseState);
  });

  window.on("close", (event) => {
    if (closeApproved || !rendererReady) {
      return;
    }

    event.preventDefault();
    if (closeCheckInProgress || closeConfirmationVisible) {
      return;
    }

    closeCheckInProgress = true;
    window.webContents.send("editor:request-close");
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
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "pipeline");
  }

  let config;
  try {
    config = JSON.parse(await readFile(pipelineConfigPath, "utf8"));
  } catch (error) {
    throw new Error(`Не удалось прочитать настройки папки результатов: ${error.message}`);
  }

  const dataDir = typeof config.data_dir === "string" ? config.data_dir : "../data/pipeline";
  return path.resolve(path.dirname(pipelineConfigPath), dataDir);
}

async function getUserDataDirectory() {
  let rawSettings;
  try {
    rawSettings = await readFile(getResultsSettingsPath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Не удалось прочитать пользовательские настройки: ${error.message}`);
  }

  let settings;
  try {
    settings = JSON.parse(rawSettings);
  } catch {
    throw new Error("Пользовательские настройки содержат некорректный JSON.");
  }

  return typeof settings.data_dir === "string" && settings.data_dir.trim()
    ? path.resolve(settings.data_dir)
    : null;
}

async function getResultsDataDirectory() {
  return await getUserDataDirectory() || getPipelineDataDirectory();
}

async function saveUserDataDirectory(dataDirectory) {
  await writeFile(
    getResultsSettingsPath(),
    `${JSON.stringify({ data_dir: dataDirectory }, null, 2)}\n`,
    "utf8",
  );
}

async function validateWritableDataDirectory(dataDirectory) {
  let directoryInfo;
  try {
    directoryInfo = await stat(dataDirectory);
  } catch (error) {
    throw new Error(`Папка результатов недоступна: ${error.message}`);
  }
  if (!directoryInfo.isDirectory()) {
    throw new Error("Выбранный путь не является папкой.");
  }

  const markerPath = path.join(dataDirectory, `.local-asr-write-test-${randomUUID()}`);
  try {
    await writeFile(markerPath, "", { flag: "wx" });
  } catch (error) {
    throw new Error(`Нет прав на запись в выбранную папку: ${error.message}`);
  }

  try {
    await rm(markerPath);
  } catch (error) {
    throw new Error(`Не удалось завершить проверку доступа к папке: ${error.message}`);
  }
}

async function getExistingManagedRunDirectory(segmentsPath) {
  const runDirectory = getRunDirectory(segmentsPath);
  const dataDirectory = await getResultsDataDirectory();
  const relativePath = path.relative(dataDirectory, runDirectory);
  if (
    !relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.dirname(relativePath) !== "."
    || path.isAbsolute(relativePath)
  ) {
    throw new Error("Управление папкой доступно только для прогонов из выбранной папки результатов.");
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

function getRunListMetadata(runId, modifiedAt) {
  const match = /^(\d{10})-(.+)-([0-9a-f]{8})$/i.exec(runId);
  if (match) {
    const timestamp = Number(match[1]) * 1000;
    if (Number.isSafeInteger(timestamp) && !Number.isNaN(new Date(timestamp).getTime())) {
      return { sourceName: match[2], date: new Date(timestamp).toISOString(), sortTime: timestamp };
    }
  }

  return { sourceName: runId, date: new Date(modifiedAt).toISOString(), sortTime: modifiedAt };
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

ipcMain.handle("results:get-directory", () => getResultsDataDirectory());

ipcMain.handle("results:select-directory", async () => {
  let defaultPath;
  try {
    defaultPath = await getResultsDataDirectory();
  } catch {
    defaultPath = undefined;
  }
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Выберите папку для результатов распознавания",
    defaultPath,
    properties: ["openDirectory"],
  });
  if (canceled || !filePaths[0]) {
    return null;
  }

  const dataDirectory = path.resolve(filePaths[0]);
  await validateWritableDataDirectory(dataDirectory);
  await saveUserDataDirectory(dataDirectory);
  return dataDirectory;
});

ipcMain.handle("results:reveal-directory", async () => {
  const dataDirectory = await getResultsDataDirectory();
  const errorMessage = await shell.openPath(dataDirectory);
  if (errorMessage) {
    throw new Error(`Не удалось открыть папку результатов: ${errorMessage}`);
  }
});

ipcMain.handle("runs:list", async () => {
  const dataDirectory = await getResultsDataDirectory();
  let entries;
  try {
    entries = await readdir(dataDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw new Error(`Не удалось прочитать папку результатов: ${error.message}`);
  }

  const runs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const segmentsPath = path.join(dataDirectory, entry.name, "segments_asr.json");
      try {
        const runDirectory = await getExistingManagedRunDirectory(segmentsPath);
        const runInfo = await stat(runDirectory);
        const metadata = getRunListMetadata(entry.name, runInfo.mtimeMs);
        return { segmentsPath, sourceName: metadata.sourceName, date: metadata.date, sortTime: metadata.sortTime };
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }
        return null;
      }
    }));

  return runs
    .filter(Boolean)
    .sort((left, right) => right.sortTime - left.sortTime)
    .map(({ segmentsPath, sourceName, date }) => ({ segmentsPath, sourceName, date }));
});

ipcMain.handle("runs:open", async (_event, segmentsPath) => {
  await getExistingManagedRunDirectory(segmentsPath);
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

  const dataDirectory = await getResultsDataDirectory();
  return runRecognition(inputPath, {
    dataDirectory,
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
