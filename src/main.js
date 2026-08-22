const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { readSavedSegments, runRecognition } = require("./recognition/runRecognition");
const { getCurrentRuntime } = require("./runtime/resolveRuntime");
const {
  InstallationStateError,
  derivePackagedInstallation,
  inspectInstallationStateForSetup,
  reconcileInstallationState,
  removeProvisioningStateArtifacts,
  readLaunchInstallationState,
} = require("./update/installationState");
const { ONLINE_RELEASE_METADATA_URL } = require("./update/onlineReleaseConfig");
const { checkForOnlineUpdate, downloadOnlineUpdate } = require("./update/onlineRelease");

const installationStateMode = process.argv.find((argument) => argument.startsWith("--asr-installation-state="));
const ipcSpikeClientBehavior = process.argv.find((argument) => argument.startsWith("--asr-ipc-spike-client-behavior="));
const updateValidationMode = process.argv.filter((argument) => argument === "--asr-update-validation");
const updateE2eMarkerArgument = process.argv.find((argument) => argument.startsWith("--asr-update-e2e-marker="));
const updateE2eReadyDelayArgument = process.argv.find((argument) => argument.startsWith("--asr-update-e2e-ready-delay="));
const updateE2eFailReady = process.argv.includes("--asr-update-e2e-fail-ready");
let availableOnlineUpdate = null;
let downloadedOnlineUpdateDirectory = null;

async function runInstallationStateMode(argument) {
  const mode = argument.slice("--asr-installation-state=".length);
  if (!app.isPackaged || !["inspect", "reconcile", "provision", "cleanup"].includes(mode)) {
    throw new InstallationStateError("INVALID_PROVISIONING_MODE", "Invalid internal installation-state mode.");
  }

  const { installationRoot, version } = derivePackagedInstallation();
  if (mode === "cleanup") {
    await removeProvisioningStateArtifacts(installationRoot);
    return;
  }
  if (mode === "inspect") {
    const result = await inspectInstallationStateForSetup(installationRoot, process.argv);
    if (result.kind === "unsupported") {
      throw new InstallationStateError("UNSUPPORTED_SCHEMA", "Installation state was created by a newer incompatible version.");
    }
    if (result.kind === "uninspectable") {
      throw new InstallationStateError("UNINSPECTABLE_STATE", "Installation state cannot be safely inspected.");
    }
    if (result.kind === "setup-schema-capability-insufficient") {
      throw new InstallationStateError("SETUP_SCHEMA_CAPABILITY_INSUFFICIENT", "The Full Setup infrastructure cannot safely consume the existing installation state schema.");
    }
    if (result.kind === "v2-state-requires-full-setup-mutation-authority") {
      throw new InstallationStateError("V2_STATE_REQUIRES_FULL_SETUP_MUTATION_AUTHORITY", "The existing schema v2 installation state requires a Full Setup with schema v2 mutation authority.");
    }
    return;
  }

  await reconcileInstallationState(installationRoot, version, { mode: mode === "provision" ? "provision" : "repair" });
}

function currentPackagedInstallation() {
  if (!app.isPackaged) {
    throw new Error("Client Update is available only from the packaged ASR Client.");
  }
  return derivePackagedInstallation();
}

function coordinatorPathForInstallation(installationRoot) {
  return path.join(installationRoot, "Coordinator", "asr-coordinator.exe");
}

function runCoordinatorUpdate(command, packagePath, { waitForExit = true } = {}) {
  const { installationRoot } = currentPackagedInstallation();
  const argumentsList = [`--asr-client-update=${command}`];
  if (packagePath) {
    argumentsList.push(`--asr-update-package=${packagePath}`);
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(coordinatorPathForInstallation(installationRoot), argumentsList, {
        cwd: installationRoot,
        detached: !waitForExit,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      if (!waitForExit) {
        child.unref();
        resolve(0);
      }
    });
    if (waitForExit) {
      child.once("exit", (code) => resolve(code === null ? 19 : code));
    }
  });
}

function waitForUpdateInitialization() {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== "function") {
      reject(new Error("Update validation requires a private parent IPC channel."));
      return;
    }
    process.once("message", (message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)
        || Object.keys(message).length !== 4
        || message.type !== "asr-update-init"
        || message.protocolVersion !== 1
        || typeof message.attemptId !== "string"
        || typeof message.token !== "string") {
        reject(new Error("Update validation initialization is invalid."));
        return;
      }
      resolve(message);
    });
  });
}

async function runUpdateValidationMode() {
  if (!app.isPackaged || updateValidationMode.length !== 1) {
    throw new Error("Update validation invocation is invalid.");
  }
  const initialization = await waitForUpdateInitialization();
  await app.whenReady();
  Menu.setApplicationMenu(null);
  await require("./runtime/resolveRuntime").validateRuntime(getCurrentRuntime());
  const window = createWindow();
  await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
  if (updateE2eFailReady && process.env.ASR_CLIENT_UPDATE_E2E === "1") {
    app.exit(73);
    return;
  }
  const readyDelay = updateE2eReadyDelay();
  if (readyDelay) {
    await new Promise((resolve) => setTimeout(resolve, readyDelay));
  }
  process.send({
    type: "asr-update-ready",
    protocolVersion: 1,
    attemptId: initialization.attemptId,
    token: initialization.token,
  });
  const markerPath = updateE2eMarkerPath();
  if (markerPath) {
    process.once("disconnect", () => {
      setTimeout(async () => {
        const temporaryMarkerPath = `${markerPath}.tmp`;
        await writeFile(temporaryMarkerPath, "Client remained alive after update Coordinator exit\r\n", "utf8");
        await rename(temporaryMarkerPath, markerPath);
        setTimeout(() => app.exit(0), 300);
      }, 150);
    });
  }
}

function updateE2eMarkerPath() {
  if (process.env.ASR_CLIENT_UPDATE_E2E !== "1" || !updateE2eMarkerArgument) {
    return undefined;
  }
  const markerPath = path.resolve(updateE2eMarkerArgument.slice("--asr-update-e2e-marker=".length));
  const expectedDirectory = path.dirname(process.execPath);
  return path.dirname(markerPath) === expectedDirectory
    && path.basename(markerPath) === "CLIENT_UPDATE_READY_AFTER_COORDINATOR_EXIT.txt"
    ? markerPath
    : undefined;
}

function updateE2eReadyDelay() {
  if (process.env.ASR_CLIENT_UPDATE_E2E !== "1" || !updateE2eReadyDelayArgument) {
    return 0;
  }
  const milliseconds = Number(updateE2eReadyDelayArgument.slice("--asr-update-e2e-ready-delay=".length));
  return Number.isSafeInteger(milliseconds) && milliseconds >= 1 && milliseconds <= 5_000
    ? milliseconds
    : 0;
}

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
  return window;
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
  const runtime = getCurrentRuntime();
  try {
    config = JSON.parse(await readFile(runtime.pipelineConfigPath, "utf8"));
  } catch (error) {
    throw new Error(`Не удалось прочитать настройки папки результатов: ${error.message}`);
  }

  const dataDir = typeof config.data_dir === "string" ? config.data_dir : "../data/pipeline";
  return path.resolve(path.dirname(runtime.pipelineConfigPath), dataDir);
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

ipcMain.handle("app:get-version", () => app.getVersion());

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

ipcMain.handle("update:select-package", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Выберите подписанный пакет обновления ASR",
    properties: ["openFile"],
    filters: [{ name: "ASR update", extensions: ["asrupdate"] }],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle("update:status", async () => {
  const { installationRoot } = currentPackagedInstallation();
  const result = await readLaunchInstallationState(installationRoot);
  if (result.kind !== "selected") {
    throw new Error("Installation state is unavailable for Client Update.");
  }
  return result.selected.updateTransaction || null;
});

ipcMain.handle("update:check-online", async () => {
  if (!ONLINE_RELEASE_METADATA_URL) {
    throw new Error("Online updates are not configured for this Client release.");
  }
  const { version } = currentPackagedInstallation();
  const result = await checkForOnlineUpdate({ installedVersion: version, metadataUrl: ONLINE_RELEASE_METADATA_URL });
  availableOnlineUpdate = result.available ? result : null;
  return result.available
    ? { available: true, version: result.metadata.client.version }
    : { available: false };
});

ipcMain.handle("update:download-online", async () => {
  if (!availableOnlineUpdate) {
    throw new Error("No newer online Client Update is available to download.");
  }
  if (downloadedOnlineUpdateDirectory) {
    await rm(downloadedOnlineUpdateDirectory, { recursive: true, force: true });
    downloadedOnlineUpdateDirectory = null;
  }
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "asr-online-update-"));
  try {
    const packagePath = await downloadOnlineUpdate(
      availableOnlineUpdate.metadata,
      availableOnlineUpdate.metadataSignature,
      temporaryDirectory,
    );
    downloadedOnlineUpdateDirectory = temporaryDirectory;
    return packagePath;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
});

ipcMain.handle("update:prepare", async (_event, packagePath) => {
  if (typeof packagePath !== "string" || !packagePath) {
    throw new Error("Не выбран пакет обновления.");
  }
  try {
    const exitCode = await runCoordinatorUpdate("prepare", packagePath);
    if (exitCode !== 0) {
      throw new Error(`Пакет обновления не подготовлен (Coordinator exit ${exitCode}).`);
    }
    const { installationRoot } = currentPackagedInstallation();
    const result = await readLaunchInstallationState(installationRoot);
    return result.kind === "selected" ? result.selected.updateTransaction : null;
  } finally {
    if (downloadedOnlineUpdateDirectory && packagePath.startsWith(`${downloadedOnlineUpdateDirectory}${path.sep}`)) {
      await rm(downloadedOnlineUpdateDirectory, { recursive: true, force: true }).catch(() => {});
      downloadedOnlineUpdateDirectory = null;
    }
  }
});

ipcMain.handle("update:cancel", async () => {
  const exitCode = await runCoordinatorUpdate("cancel");
  if (exitCode !== 0) {
    throw new Error(`Подготовленное обновление не отменено (Coordinator exit ${exitCode}).`);
  }
  return null;
});

ipcMain.handle("update:activate", async () => {
  await runCoordinatorUpdate("activate", undefined, { waitForExit: false });
  app.quit();
  return true;
});

if (ipcSpikeClientBehavior) {
  require("./ipcSpikeClient").runIpcSpikeClient({ app });
} else if (updateValidationMode.length > 0) {
  runUpdateValidationMode().catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
} else if (installationStateMode) {
  runInstallationStateMode(installationStateMode)
    .then(() => app.exit(0))
    .catch((error) => {
      console.error(error.message);
      if (error instanceof InstallationStateError && error.code === "UNSUPPORTED_SCHEMA") {
        app.exit(21);
        return;
      }
      if (error instanceof InstallationStateError && error.code === "UNINSPECTABLE_STATE") {
        app.exit(23);
        return;
      }
      if (error instanceof InstallationStateError && error.code === "SETUP_SCHEMA_CAPABILITY_INSUFFICIENT") {
        app.exit(24);
        return;
      }
      app.exit(error instanceof InstallationStateError && error.code === "V2_STATE_REQUIRES_FULL_SETUP_MUTATION_AUTHORITY" ? 25 : 22);
    });
} else {
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
}
