"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createHighlightPolicy,
  createMediaReviewSession,
  createSeekResolver,
} = require("../../src/renderer/mediaReviewSession.js");

function createFakeMediaController() {
  let snapshot = { currentTime: 0, duration: 20, state: "idle", sourceKind: "unknown" };
  const listeners = new Set();
  const calls = [];
  const emit = () => listeners.forEach((listener) => listener({ ...snapshot }));
  return {
    calls,
    getElement: () => null,
    getSnapshot: () => ({ ...snapshot }),
    load(source) {
      calls.push(["load", source?.url || null]);
      snapshot = source
        ? { ...snapshot, state: "paused", sourceKind: source.sourceKind }
        : { ...snapshot, state: "idle", sourceKind: "unknown" };
      emit();
    },
    pause() {
      calls.push(["pause"]);
      snapshot = { ...snapshot, state: "paused" };
      emit();
    },
    play: async () => {
      calls.push(["play"]);
      snapshot = { ...snapshot, state: "playing" };
      emit();
    },
    probe: (source) => source.playbackCapability || "probably",
    seek(seconds) {
      calls.push(["seek", seconds]);
      snapshot = { ...snapshot, currentTime: seconds };
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...snapshot });
      return () => listeners.delete(listener);
    },
  };
}

const source = { status: "available", url: "asr-media://token/source", sourceKind: "audio", mimeType: "audio/wav" };
const first = { id: 1, text: "первая часть" };
const second = { id: 2, text: "вторая часть" };

test("Media Review is opt-in and resolves text-to-media through a replaceable seek intent", () => {
  const mediaController = createFakeMediaController();
  const transcriptSync = {
    activeAt: () => [],
    seekTarget: (paragraph) => paragraph.id === 1 ? 4 : null,
  };
  const session = createMediaReviewSession({ mediaController, transcriptSync });

  assert.equal(session.getSnapshot().enabled, false);
  assert.equal(session.canSeek(first), false);
  assert.equal(session.requestSeek(first), null);

  session.setSource(source);
  assert.equal(session.enable(), true);
  assert.deepEqual(session.requestSeek(first), { kind: "first-referenced-segment", target: 4 });
  assert.deepEqual(mediaController.calls.at(-1), ["seek", 4]);
  assert.equal(session.requestSeek(second), null);
});

test("seek keeps the existing loaded source and playback state", async () => {
  const mediaController = createFakeMediaController();
  const session = createMediaReviewSession({
    mediaController,
    transcriptSync: { activeAt: () => [], seekTarget: () => null },
  });

  session.setSource(source);
  session.enable();
  await session.play();
  session.seek(11);

  assert.deepEqual(mediaController.calls, [["load", source.url], ["play"], ["seek", 11]]);
  assert.equal(session.getSnapshot().media.currentTime, 11);
  assert.equal(session.getSnapshot().media.state, "playing");
});

test("Media Review keeps simultaneous active transcript parts as transient derived state", () => {
  const mediaController = createFakeMediaController();
  const transcriptSync = {
    activeAt: (time) => time === 8 ? [
      { paragraph: first, timedRanges: [{ start: 7, end: 10, sourceSegmentRef: { kind: "baseline-segment", index: 0 } }] },
      { paragraph: second, timedRanges: [{ start: 7, end: 10, sourceSegmentRef: { kind: "baseline-segment", index: 0 } }] },
    ] : [],
    seekTarget: () => null,
  };
  const session = createMediaReviewSession({ mediaController, transcriptSync });

  session.setSource(source);
  session.enable();
  session.seek(8);

  const snapshot = session.getSnapshot();
  assert.deepEqual(snapshot.activeStates.map(({ paragraph }) => paragraph.id), [1, 2]);
  assert.deepEqual([...snapshot.activeParagraphIds], [1, 2]);
  assert.deepEqual(snapshot.activeIndications, [
    { paragraphId: 1, start: 7, end: 10 },
    { paragraphId: 2, start: 7, end: 10 },
  ]);
  session.disable();
  assert.deepEqual(session.getSnapshot().activeStates, []);
});

test("disposing a document-scoped session stops playback and releases its source", () => {
  const firstController = createFakeMediaController();
  const firstSession = createMediaReviewSession({
    mediaController: firstController,
    transcriptSync: { activeAt: () => [], seekTarget: () => null },
  });
  firstSession.setSource(source);
  firstSession.enable();
  firstSession.dispose();

  assert.deepEqual(firstController.calls.slice(-2), [["pause"], ["load", null]]);

  const secondController = createFakeMediaController();
  const secondSession = createMediaReviewSession({
    mediaController: secondController,
    transcriptSync: { activeAt: () => [], seekTarget: () => null },
  });
  assert.equal(secondSession.getSnapshot().enabled, false);
  assert.deepEqual(secondController.calls, []);
});

test("unsupported playback remains distinct from source availability and does not load media", () => {
  const mediaController = createFakeMediaController();
  const session = createMediaReviewSession({
    mediaController,
    transcriptSync: { activeAt: () => [], seekTarget: () => null },
  });

  session.setSource({ ...source, playbackCapability: "unsupported" });
  assert.equal(session.enable(), false);
  assert.equal(session.getSnapshot().enabled, false);
  assert.equal(session.getSnapshot().playbackCapability, "unsupported");
  assert.deepEqual(mediaController.calls, []);
});

test("missing source stays inactive until an explicit re-link supplies an available capability", () => {
  const mediaController = createFakeMediaController();
  const session = createMediaReviewSession({
    mediaController,
    transcriptSync: { activeAt: () => [], seekTarget: () => null },
  });

  session.setSource({ status: "missing", sourceKind: "audio" });
  assert.equal(session.enable(), false);
  assert.deepEqual(mediaController.calls, []);

  session.setSource(source);
  assert.equal(session.enable(), true);
  assert.deepEqual(mediaController.calls, [["load", source.url]]);
});

test("video uses the same session contract and only adds transient visibility", () => {
  const mediaController = createFakeMediaController();
  const session = createMediaReviewSession({
    mediaController,
    transcriptSync: { activeAt: () => [], seekTarget: () => null },
  });

  session.setSource({ ...source, sourceKind: "video", mimeType: "video/mp4" });
  assert.equal(session.enable(), true);
  assert.equal(session.getSnapshot().media.sourceKind, "video");
  assert.equal(session.getSnapshot().videoVisible, true);
  session.setVideoVisible(false);
  assert.equal(session.getSnapshot().videoVisible, false);
});

test("resolver and highlight policy remain independent from UI and playback implementation", () => {
  const resolver = createSeekResolver({ resolve: ({ paragraph }) => ({ kind: "future-word-anchor", target: paragraph.anchor }) });
  const intent = resolver.resolve({ paragraph: { anchor: 12 } });
  assert.deepEqual(intent, { kind: "future-word-anchor", target: 12 });
  assert.equal(resolver.resolve({ paragraph: { anchor: null } }), null);

  const policy = createHighlightPolicy();
  const activeStates = [
    { paragraph: first, timedRanges: [{ start: 1, end: 2 }] },
    { paragraph: first, timedRanges: [{ start: 1, end: 2 }] },
    { paragraph: second, timedRanges: [{ start: 1, end: 2 }] },
  ];
  assert.deepEqual([...policy.activeParagraphIds(activeStates, 1.5)], [1, 2]);
});
