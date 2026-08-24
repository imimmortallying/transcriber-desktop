const path = require("node:path");

const MEDIA_FILE_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "mkv", "avi", "mov", "webm"];
const AUDIO_MEDIA_FILE_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "flac"];
const VIDEO_MEDIA_FILE_EXTENSIONS = ["mp4", "mkv", "avi", "mov", "webm"];

function isSupportedMediaPath(filePath) {
  if (typeof filePath !== "string") {
    return false;
  }
  return MEDIA_FILE_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase());
}

function getMediaKind(filePath) {
  if (typeof filePath !== "string") {
    return "unknown";
  }
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (AUDIO_MEDIA_FILE_EXTENSIONS.includes(extension)) {
    return "audio";
  }
  if (VIDEO_MEDIA_FILE_EXTENSIONS.includes(extension)) {
    return "video";
  }
  return "unknown";
}

function getPlaybackMimeType(filePath) {
  if (typeof filePath !== "string") {
    return "";
  }
  switch (path.extname(filePath).slice(1).toLowerCase()) {
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "m4a": return "audio/mp4";
    case "ogg": return "audio/ogg";
    case "flac": return "audio/flac";
    case "mp4": return "video/mp4";
    case "mkv": return "video/x-matroska";
    case "avi": return "video/x-msvideo";
    case "mov": return "video/quicktime";
    case "webm": return "video/webm";
    default: return "";
  }
}

module.exports = {
  AUDIO_MEDIA_FILE_EXTENSIONS,
  MEDIA_FILE_EXTENSIONS,
  VIDEO_MEDIA_FILE_EXTENSIONS,
  getMediaKind,
  getPlaybackMimeType,
  isSupportedMediaPath,
};
