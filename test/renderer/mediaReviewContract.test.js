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
  assert.match(index, /<main class="app-content">/);
  assert.match(index, /class="document-actions document-toolbar"/);
  assert.match(index, /id="media-transport-slot"[^>]*hidden/);
  assert.match(index, /id="media-review-workspace"[^>]*data-review-layout="inactive"/);
  assert.match(index, /id="editor" class="editor transcript-pane"[\s\S]*id="media-review" class="media-review media-pane"/);
  assert.match(index, /id="media-pane-header-slot"[\s\S]*id="media-review-presentation"[\s\S]*id="media-pane-transport-slot"/);
  assert.match(index, /id="media-review"[^>]*hidden/);
  assert.match(index, /mediaReviewSession\.js/);
  assert.match(renderer, /let mediaReviewSession = null/);
  assert.match(renderer, /const mediaReviewWorkspace = document\.querySelector\("#media-review-workspace"\)/);
  assert.match(renderer, /const mediaTransportSlot = document\.querySelector\("#media-transport-slot"\)/);
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
  assert.match(renderer, /const reviewLayout = mediaReviewOpen[\s\S]*useVideoLayout \? "video" : "compact"/);
  assert.match(renderer, /mediaReviewWorkspace\.dataset\.reviewLayout = reviewLayout;[\s\S]*documentView\.dataset\.reviewLayout = reviewLayout/);
  assert.match(renderer, /mediaPaneHeaderSlot\.append\(mediaReviewHeader, mediaReviewStatus\);[\s\S]*mediaPaneTransportSlot\.append\(mediaReviewControls, relinkMediaSourceButton\)/);
  assert.doesNotMatch(renderer, /addEventListener\("resize"/);
  assert.match(session, /function createSeekResolver/);
  assert.match(session, /function createHighlightPolicy/);
  assert.match(session, /activeIndications\(activeStates, media\.currentTime\)/);
  assert.match(session, /transcriptSync\.activeAt\(media\.currentTime\)/);
  assert.doesNotMatch(session, /saveProject|editorHistory|autosave|currentTime.*schemaVersion/);
  assert.match(preload, /relinkMediaSource: \(segmentsPath, filePath\) => ipcRenderer\.invoke\("media:relink-source", segmentsPath, filePath\)/);
  assert.match(styles, /\.media-review\[hidden\],[\s\S]*display: none !important/);
  assert.match(styles, /main\.app-content:has\(#document-view\[data-review-layout="video"\]\)[\s\S]*max-width: 1440px/);
  assert.match(styles, /\.media-review-workspace\[data-review-layout="video"\] \{[\s\S]*grid-template-columns: 1fr[\s\S]*"media"[\s\S]*"transcript"/);
  assert.match(styles, /@media \(min-width: 1360px\) \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(360px, 440px\)/);
  assert.match(styles, /\.media-review-workspace\[data-review-layout="video"\] \.media-review \{[\s\S]*grid-area: media/);
  assert.match(styles, /@media \(min-width: 1360px\) \{[\s\S]*\.media-review-workspace\[data-review-layout="video"\] \.media-review \{[\s\S]*position: sticky[\s\S]*align-self: start/);
  assert.doesNotMatch(styles, /media-review-workspace\[data-review-layout="video"\][\s\S]*overflow: auto/);
  assert.match(styles, /\.media-review-presentation video \{[\s\S]*object-fit: contain/);
});
