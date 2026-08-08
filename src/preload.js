const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("asr", {
  selectMedia: () => ipcRenderer.invoke("dialog:select-media"),
  transcribe: (inputPath) => ipcRenderer.invoke("recognition:run", inputPath),
  diarize: (runId) => ipcRenderer.invoke("diarization:run", runId),
  saveTranscript: (transcript) => ipcRenderer.invoke("dialog:save-transcript", transcript),
  onProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("recognition:progress", listener);
    return () => ipcRenderer.removeListener("recognition:progress", listener);
  },
});
