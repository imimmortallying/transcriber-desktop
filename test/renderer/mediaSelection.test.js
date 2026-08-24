"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { MEDIA_FILE_EXTENSIONS, isSupportedMediaPath } = require("../../src/mediaSelection");

test("media selection accepts the shared audio and video extension set", () => {
  assert.deepEqual(MEDIA_FILE_EXTENSIONS, ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "mkv", "avi", "mov", "webm"]);
  assert.equal(isSupportedMediaPath("C:\\recordings\\meeting.MP4"), true);
  assert.equal(isSupportedMediaPath("C:\\recordings\\notes.txt"), false);
  assert.equal(isSupportedMediaPath(null), false);
});
