const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, shell } = require("electron");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MEDIA_FILE_EXTENSIONS, isSupportedMediaPath } = require("./mediaSelection");
const {
  createSourceMediaMetadata,
  isSourceMediaMetadata,
  validateAuthorizedSource,
  validateRelinkedSource,
  validateSourceMedia,
} = require("./mediaSource");
const { MEDIA_PROTOCOL_SCHEME, createMediaProtocolHandler } = require("./mediaProtocol");
const { probeRecognitionRuntime, readSavedSegments, runRecognition } = require("./recognition/runRecognition");
const { getCurrentRuntime, validateRuntime } = require("./runtime/resolveRuntime");
const {
  buildSupportReport,
  getSupportReportDirectory,
  isSupportReportPath,
  writeSupportReport,
} = require("./diagnostics/supportReport");
const { SUPPORT_EMAIL } = require("./diagnostics/supportConfig");
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
const { showTranscriptContextMenu } = require("./transcriptContextMenu");

const installationStateMode = process.argv.find((argument) => argument.startsWith("--asr-installation-state="));
const ipcSpikeClientBehavior = process.argv.find((argument) => argument.startsWith("--asr-ipc-spike-client-behavior="));
const updateValidationMode = process.argv.filter((argument) => argument === "--asr-update-validation");
const updateE2eMarkerArgument = process.argv.find((argument) => argument.startsWith("--asr-update-e2e-marker="));
const updateE2eReadyDelayArgument = process.argv.find((argument) => argument.startsWith("--asr-update-e2e-ready-delay="));
const updateE2eFailReady = process.argv.includes("--asr-update-e2e-fail-ready");
let availableOnlineUpdate = null;
let downloadedOnlineUpdateDirectory = null;
const mediaAuthorizations = new Map();

protocol.registerSchemesAsPrivileged([{
  scheme: MEDIA_PROTOCOL_SCHEME,
  privileges: { secure: true, standard: true, stream: true },
}]);

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
  installMediaProtocol();
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
  let activationResolved = false;
  process.once("message", (message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)
      || message.protocolVersion !== 1) {
      return;
    }
    if (message.type === "asr-update-committed") {
      activationResolved = true;
      window.webContents.send("update:committed");
      return;
    }
    if (message.type === "asr-update-aborted") {
      app.quit();
    }
  });
  process.once("disconnect", () => {
    if (!activationResolved) {
      app.quit();
    }
  });
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

function getSupportReportDirectories() {
  return {
    localAppData: process.env.LOCALAPPDATA,
    fallbackDirectory: app.getPath("userData"),
  };
}

function classifyRecognitionError(error) {
  const details = `${error?.message || ""}\n${error?.stack || ""}`;
  if (/torchaudio|torch\.ops\.load_library|libtorch/i.test(details)) {
    return "ASR-RUNTIME-NATIVE-LOAD";
  }
  if (/access is denied|eacces|eperm/i.test(details)) {
    return "ASR-ACCESS-DENIED";
  }
  if (/ffmpeg/i.test(details)) {
    return "ASR-FFMPEG-FAILED";
  }
  return "ASR-RECOGNITION-FAILED";
}

async function inspectRecognitionRuntime({ runImportProbes = false } = {}) {
  try {
    const runtime = await validateRuntime(getCurrentRuntime());
    const pythonDirectory = path.dirname(runtime.pythonExecutable);
    const [pythonInfo, ffmpegInfo, torchaudioInfo, torchCpuInfo] = await Promise.all([
      stat(runtime.pythonExecutable),
      stat(runtime.ffmpegExecutable),
      inspectRegularFile(path.join(pythonDirectory, "Lib", "site-packages", "torchaudio", "lib", "libtorchaudio.pyd")),
      inspectRegularFile(path.join(pythonDirectory, "Lib", "site-packages", "torch", "lib", "torch_cpu.dll")),
    ]);
    return {
      runtime: {
        manifestVersion: runtime.manifest.manifestFormatVersion,
        runtimeId: runtime.manifest.runtimeId,
        runtimeVersion: runtime.manifest.runtimeVersion,
        runtimeApiVersion: runtime.manifest.runtimeApiVersion,
        pythonPresent: pythonInfo.isFile(),
        ffmpegPresent: ffmpegInfo.isFile(),
        torchaudioNativeLibraryPresent: torchaudioInfo,
        torchCpuLibraryPresent: torchCpuInfo,
      },
      runtimeChecks: runImportProbes ? await probeRecognitionRuntime(runtime) : [],
    };
  } catch (error) {
    return {
      runtime: null,
      runtimeChecks: [{ name: "runtime_inspection", ok: false, detail: error.message }],
    };
  }
}

async function inspectRegularFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function createRecognitionSupportReport(error, inputPath, options) {
  const inspection = await inspectRecognitionRuntime(options);
  const report = buildSupportReport({
    kind: "recognition",
    errorCode: classifyRecognitionError(error),
    error,
    appVersion: app.getVersion(),
    supportEmail: SUPPORT_EMAIL,
    operation: {
      name: "recognition",
      inputExtension: typeof inputPath === "string" ? path.extname(inputPath).toLowerCase() || "none" : "not-collected",
    },
    ...inspection,
  });
  const written = await writeSupportReport(report, getSupportReportDirectories());
  return { ...written, errorCode: classifyRecognitionError(error) };
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

  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

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

function getSourceMediaMetadataPath(segmentsPath) {
  return path.join(getRunDirectory(segmentsPath), "source_media.json");
}

async function readSourceMediaMetadata(segmentsPath) {
  const metadataPath = getSourceMediaMetadataPath(segmentsPath);
  let rawMetadata;
  try {
    rawMetadata = await readFile(metadataPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  try {
    const metadata = JSON.parse(rawMetadata);
    return isSourceMediaMetadata(metadata) ? metadata : null;
  } catch {
    return null;
  }
}

async function writeSourceMediaMetadata(segmentsPath, metadata) {
  if (!isSourceMediaMetadata(metadata)) {
    throw new Error("Не удалось сохранить reference исходного media-файла.");
  }

  const metadataPath = getSourceMediaMetadataPath(segmentsPath);
  const temporaryMetadataPath = `${metadataPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await rename(temporaryMetadataPath, metadataPath);
  } finally {
    await rm(temporaryMetadataPath, { force: true }).catch(() => {});
  }
}

async function authorizeMediaSource(segmentsPath, metadata) {
  const validation = await validateSourceMedia(metadata);
  if (validation.status !== "available") {
    return { status: validation.status, sourceKind: metadata?.sourceKind || "unknown" };
  }

  const resolvedSegmentsPath = path.resolve(segmentsPath);
  for (const [token, authorization] of mediaAuthorizations) {
    if (authorization.segmentsPath === resolvedSegmentsPath) {
      mediaAuthorizations.delete(token);
    }
  }
  const token = randomUUID();
  mediaAuthorizations.set(token, {
    segmentsPath: resolvedSegmentsPath,
    metadata,
    fileState: validation.fileState,
  });
  return {
    status: "available",
    sourceKind: validation.sourceKind,
    mimeType: metadata.sourceMimeType,
    url: `${MEDIA_PROTOCOL_SCHEME}://${token}/source`,
  };
}

async function getAuthorizedRunMediaSource(segmentsPath) {
  const metadata = await readSourceMediaMetadata(segmentsPath);
  if (!metadata) {
    return { status: "unavailable", sourceKind: "unknown" };
  }
  return authorizeMediaSource(segmentsPath, metadata);
}

function installMediaProtocol() {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, createMediaProtocolHandler({
    resolveAuthorization: async (token) => {
      const authorization = mediaAuthorizations.get(token);
      if (!authorization) {
        return null;
      }
      const validation = await validateAuthorizedSource(authorization.metadata, authorization.fileState);
      if (validation.status !== "available") {
        return null;
      }
      authorization.fileState = validation.fileState;
      return validation;
    },
  }));
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

async function validateSelectedMediaPath(inputPath) {
  if (!isSupportedMediaPath(inputPath)) {
    throw new Error("Поддерживаются аудио и видео: MP3, WAV, M4A, OGG, FLAC, MP4, MKV, AVI, MOV и WebM.");
  }
  const fileInfo = await stat(inputPath);
  if (!fileInfo.isFile()) {
    throw new Error("Выбранный путь не является файлом.");
  }
  return inputPath;
}

ipcMain.handle("dialog:select-media", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Выберите аудио или видео",
    properties: ["openFile"],
    filters: [{
      name: "Аудио и видео",
      extensions: MEDIA_FILE_EXTENSIONS,
    }],
  });

  return canceled ? null : validateSelectedMediaPath(filePaths[0]);
});

ipcMain.handle("media:select-dropped-file", async (_event, inputPath) => validateSelectedMediaPath(inputPath));

function getDocumentActionConfirmation(action, details) {
  switch (action) {
    case "restore-recognized":
      return {
        type: "warning",
        message: "Восстановить исходный текст? Текущие правки будут заменены. В этой сессии их можно вернуть сочетанием Ctrl+Z.",
        buttons: ["Восстановить текст", "Отмена"],
        defaultId: 1,
        cancelId: 1,
      };
    case "select-new-media":
      return {
        type: "warning",
        message: "Открыть другой файл? Текущая расшифровка сохранена и останется в Моих расшифровках.",
        buttons: ["Открыть файл", "Отмена"],
        defaultId: 1,
        cancelId: 1,
      };
    case "discard-unsaved-edits":
      return {
        type: "warning",
        message: "Не удалось сохранить последние правки. Продолжить без них?",
        buttons: ["Продолжить", "Отмена"],
        defaultId: 1,
        cancelId: 1,
      };
    case "activate-update":
      return {
        type: "warning",
        message: "Приложение перезапустится и будет временно недоступно, пока запускается новая версия. Продолжить?",
        buttons: ["Перезапустить", "Отмена"],
        defaultId: 1,
        cancelId: 1,
      };
    case "delete-speaker": {
      if (!details || typeof details !== "object" || Array.isArray(details)
        || typeof details.name !== "string" || !details.name.trim() || details.name.length > 200
        || !Number.isSafeInteger(details.usageCount) || details.usageCount < 0) {
        throw new Error("Некорректные данные для подтверждения удаления говорящего.");
      }
      const usageWarning = details.usageCount
        ? `\n\nГоворящий назначен в ${details.usageCount} реплик${details.usageCount === 1 ? "е" : "ах"}. Эти назначения будут сняты, но текст и границы реплик останутся.`
        : "";
      return {
        type: "warning",
        message: `Удалить говорящего «${details.name}»?${usageWarning}`,
        buttons: ["Удалить", "Отмена"],
        defaultId: 1,
        cancelId: 1,
      };
    }
    default:
      throw new Error("Неподдерживаемое действие подтверждения.");
  }
}

ipcMain.handle("dialog:confirm-document-action", async (event, action, details = null) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.isDestroyed()) {
    throw new Error("Окно подтверждения недоступно.");
  }
  const { response } = await dialog.showMessageBox(owner, getDocumentActionConfirmation(action, details));
  return response === 0;
});

ipcMain.handle("editor:show-transcript-context-menu", async (event, includeMediaAction) => {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  if (!browserWindow) {
    return null;
  }
  return showTranscriptContextMenu({
    Menu,
    browserWindow,
    includeMediaAction: Boolean(includeMediaAction),
  });
});

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("app:get-identity", () => ({
  version: app.getVersion(),
  mode: app.isPackaged ? "packaged" : "dev",
  appPath: app.getAppPath(),
}));

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
  const runDirectory = await getExistingManagedRunDirectory(segmentsPath);
  const runInfo = await stat(runDirectory);
  const metadata = getRunListMetadata(path.basename(runDirectory), runInfo.mtimeMs);
  return {
    sourcePath: segmentsPath,
    sourceName: metadata.sourceName,
    date: metadata.date,
    segments: await readSavedSegments(segmentsPath),
    project: await readProjectEdits(segmentsPath),
    mediaSource: await getAuthorizedRunMediaSource(segmentsPath),
  };
});

ipcMain.handle("media:relink-source", async (_event, segmentsPath, inputPath) => {
  await getExistingManagedRunDirectory(segmentsPath);
  const metadata = await readSourceMediaMetadata(segmentsPath);
  if (!metadata) {
    return { status: "unavailable", sourceKind: "unknown" };
  }

  const validation = await validateRelinkedSource(metadata, inputPath);
  if (validation.status !== "available") {
    return { status: validation.status, sourceKind: metadata.sourceKind };
  }

  const relinkedMetadata = {
    ...metadata,
    sourcePath: validation.filePath,
    sourceName: path.basename(validation.filePath),
  };
  await writeSourceMediaMetadata(segmentsPath, relinkedMetadata);
  return authorizeMediaSource(segmentsPath, relinkedMetadata);
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
  const temporaryEditsPath = `${editsPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryEditsPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    await rename(temporaryEditsPath, editsPath);
  } finally {
    await rm(temporaryEditsPath, { force: true }).catch(() => {});
  }
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
    title: "Удалить расшифровку?",
    message: "Сохранённая расшифровка будет удалена без возможности восстановления.",
    detail: "Будут удалены подготовленное аудио, результаты распознавания и сохранённые правки, если они есть.",
    buttons: ["Удалить расшифровку", "Отмена"],
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

  for (const [token, authorization] of mediaAuthorizations) {
    if (authorization.segmentsPath === path.resolve(segmentsPath)) {
      mediaAuthorizations.delete(token);
    }
  }

  return true;
});

ipcMain.handle("recognition:run", async (event, inputPath) => {
  let recognitionStarted = false;
  try {
    if (typeof inputPath !== "string") {
      throw new Error("Не выбран файл для распознавания.");
    }
    const sourceMetadata = await createSourceMediaMetadata(inputPath);
    const dataDirectory = await getResultsDataDirectory();
    recognitionStarted = true;
    const result = await runRecognition(inputPath, {
      dataDirectory,
      onProgress(status) {
        event.sender.send("recognition:progress", status);
      },
    });
    const sourceValidation = await validateSourceMedia(sourceMetadata);
    if (sourceValidation.status !== "available") {
      throw new Error("Исходный media-файл изменился во время распознавания.");
    }
    await writeSourceMediaMetadata(result.segmentsPath, sourceMetadata);
    return {
      ok: true,
      result,
      mediaSource: await getAuthorizedRunMediaSource(result.segmentsPath),
    };
  } catch (error) {
    let supportReport = null;
    try {
      supportReport = await createRecognitionSupportReport(error, inputPath, { runImportProbes: recognitionStarted });
    } catch (reportError) {
      console.error(`Unable to create ASR support report: ${reportError.message}`);
    }
    return {
      ok: false,
      error: {
        code: supportReport?.errorCode || classifyRecognitionError(error),
        message: "Не удалось завершить распознавание.",
        reportPath: supportReport?.filePath || null,
        supportEmail: SUPPORT_EMAIL,
      },
    };
  }
});

ipcMain.handle("support:reveal-report", async (_event, reportPath) => {
  const reportDirectory = getSupportReportDirectory(getSupportReportDirectories());
  if (!isSupportReportPath(reportPath, reportDirectory)) {
    throw new Error("Файл технического отчёта недоступен.");
  }
  const reportInfo = await stat(reportPath);
  if (!reportInfo.isFile()) {
    throw new Error("Файл технического отчёта не найден.");
  }
  shell.showItemInFolder(reportPath);
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
  return result.selected.updateTransaction?.phase === "prepared"
    ? result.selected.updateTransaction
    : null;
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
    if (downloadedOnlineUpdateDirectory) {
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
    installMediaProtocol();
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
