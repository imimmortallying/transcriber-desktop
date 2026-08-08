const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("asr", {
  selectMedia: () => ipcRenderer.invoke("dialog:select-media"),
  openSavedSegments: () => ipcRenderer.invoke("dialog:open-saved-segments"),
  transcribe: (inputPath) => ipcRenderer.invoke("recognition:run", inputPath),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  saveTranscript: (transcript) => ipcRenderer.invoke("dialog:save-transcript", transcript),
  onProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("recognition:progress", listener);
    return () => ipcRenderer.removeListener("recognition:progress", listener);
  },
});
