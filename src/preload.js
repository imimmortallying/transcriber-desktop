const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("asr", {
  getClientVersion: () => ipcRenderer.invoke("app:get-version"),
  getClientIdentity: () => ipcRenderer.invoke("app:get-identity"),
  confirmDocumentAction: (action, details) => ipcRenderer.invoke("dialog:confirm-document-action", action, details),
  selectMedia: () => ipcRenderer.invoke("dialog:select-media"),
  selectDroppedMedia: (file) => ipcRenderer.invoke("media:select-dropped-file", webUtils.getPathForFile(file)),
  getResultsDirectory: () => ipcRenderer.invoke("results:get-directory"),
  selectResultsDirectory: () => ipcRenderer.invoke("results:select-directory"),
  revealResultsDirectory: () => ipcRenderer.invoke("results:reveal-directory"),
  listRuns: () => ipcRenderer.invoke("runs:list"),
  openRun: (segmentsPath) => ipcRenderer.invoke("runs:open", segmentsPath),
  relinkMediaSource: (segmentsPath, filePath) => ipcRenderer.invoke("media:relink-source", segmentsPath, filePath),
  transcribe: (inputPath) => ipcRenderer.invoke("recognition:run", inputPath),
  revealSupportReport: (reportPath) => ipcRenderer.invoke("support:reveal-report", reportPath),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  saveTranscript: (transcript) => ipcRenderer.invoke("dialog:save-transcript", transcript),
  saveProject: (segmentsPath, project) => ipcRenderer.invoke("project:save", segmentsPath, project),
  reloadSegments: (segmentsPath) => ipcRenderer.invoke("segments:reload", segmentsPath),
  revealRunInFolder: (segmentsPath) => ipcRenderer.invoke("run:reveal-in-folder", segmentsPath),
  confirmDeleteRun: (segmentsPath) => ipcRenderer.invoke("run:confirm-delete", segmentsPath),
  deleteRun: (segmentsPath) => ipcRenderer.invoke("run:delete", segmentsPath),
  selectUpdatePackage: () => ipcRenderer.invoke("update:select-package"),
  getUpdateStatus: () => ipcRenderer.invoke("update:status"),
  checkOnlineUpdate: () => ipcRenderer.invoke("update:check-online"),
  downloadOnlineUpdate: () => ipcRenderer.invoke("update:download-online"),
  prepareUpdate: (packagePath) => ipcRenderer.invoke("update:prepare", packagePath),
  cancelUpdate: () => ipcRenderer.invoke("update:cancel"),
  activateUpdate: () => ipcRenderer.invoke("update:activate"),
  onUpdateCommitted: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("update:committed", listener);
    return () => ipcRenderer.removeListener("update:committed", listener);
  },
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("editor:request-close", listener);
    return () => ipcRenderer.removeListener("editor:request-close", listener);
  },
  reportProjectDirty: (isProjectDirty) => ipcRenderer.send("editor:close-state", Boolean(isProjectDirty)),
  onProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("recognition:progress", listener);
    return () => ipcRenderer.removeListener("recognition:progress", listener);
  },
});
