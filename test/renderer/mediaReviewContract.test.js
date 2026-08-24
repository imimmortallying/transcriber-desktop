"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

test("Media Review UI uses the transient session boundary without changing document persistence", async () => {
  const [index, renderer, session, preload, styles] = await Promise.all([
    fs.readFile(path.join(projectRoot, "src", "renderer", "index.html"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "mediaReviewSession.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "preload.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "src", "renderer", "styles.css"), "utf8"),
  ]);

  assert.match(index, /id="toggle-media-review"/);
  assert.match(index, /id="media-review"[^>]*hidden/);
  assert.match(index, /mediaReviewSession\.js/);
  assert.match(renderer, /let mediaReviewSession = null/);
  assert.match(renderer, /function ensureMediaReviewSession\(\)/);
  assert.match(renderer, /function resetMediaReviewForDocument\(\)/);
  assert.match(renderer, /mediaReviewSession\.dispose\(\)/);
  assert.match(renderer, /const session = ensureMediaReviewSession\(\)/);
  assert.match(renderer, /function applyOpenedSavedRun\(result\) \{[\s\S]*resetMediaReviewForDocument\(\)[\s\S]*setMediaReviewSource\(result\.mediaSource\)/);
  assert.match(renderer, /transcribeButton\.addEventListener\("click", async \(\) => \{[\s\S]*resetMediaReviewForDocument\(\)[\s\S]*setMediaReviewSource\(response\.mediaSource\)/);
  assert.doesNotMatch(renderer, /const mediaController = window\.MediaController\.createMediaController/);
  assert.match(renderer, /mediaReviewSession\?\.requestSeek\(paragraph\)/);
  assert.doesNotMatch(renderer, /mediaController\.seek\(/);
  assert.match(renderer, /let mediaReviewScrubbing = false/);
  assert.match(renderer, /mediaReviewSeek\.addEventListener\("input", \(\) => \{[\s\S]*mediaReviewScrubbing = true;[\s\S]*mediaReviewSession\?\.seek\(target\)/);
  assert.match(renderer, /mediaReviewSeek\.addEventListener\("change", \(\) => \{[\s\S]*mediaReviewScrubbing = false;[\s\S]*mediaReviewPendingSeekTarget = target/);
  assert.match(renderer, /if \(heldSeekTarget === null\) \{[\s\S]*mediaReviewSeek\.value/);
  assert.match(session, /function createSeekResolver/);
  assert.match(session, /function createHighlightPolicy/);
  assert.match(session, /activeIndications\(activeStates, media\.currentTime\)/);
  assert.match(session, /transcriptSync\.activeAt\(media\.currentTime\)/);
  assert.doesNotMatch(session, /saveProject|editorHistory|autosave|currentTime.*schemaVersion/);
  assert.match(preload, /relinkMediaSource: \(segmentsPath, filePath\) => ipcRenderer\.invoke\("media:relink-source", segmentsPath, filePath\)/);
  assert.match(styles, /\.media-review\[hidden\],[\s\S]*display: none !important/);
});
