const path = require("node:path");

const MEDIA_FILE_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "mkv", "avi", "mov", "webm"];

function isSupportedMediaPath(filePath) {
  if (typeof filePath !== "string") {
    return false;
  }
  return MEDIA_FILE_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase());
}

module.exports = {
  MEDIA_FILE_EXTENSIONS,
  isSupportedMediaPath,
};
