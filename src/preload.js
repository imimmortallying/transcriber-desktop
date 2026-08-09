const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("asr", {
  selectMedia: () => ipcRenderer.invoke("dialog:select-media"),
  openSavedSegments: () => ipcRenderer.invoke("dialog:open-saved-segments"),
  transcribe: (inputPath) => ipcRenderer.invoke("recognition:run", inputPath),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  saveTranscript: (transcript) => ipcRenderer.invoke("dialog:save-transcript", transcript),
  saveProject: (segmentsPath, project) => ipcRenderer.invoke("project:save", segmentsPath, project),
  reloadSegments: (segmentsPath) => ipcRenderer.invoke("segments:reload", segmentsPath),
  onProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("recognition:progress", listener);
    return () => ipcRenderer.removeListener("recognition:progress", listener);
  },
});
